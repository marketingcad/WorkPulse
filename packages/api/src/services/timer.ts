import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  activityWindows,
  devices,
  eodReports,
  timeEntries,
  memberships,
  projects,
  sessionTransitions,
  tasks,
  timeSegments,
  trackingSessions,
  users,
  workerProfiles,
} from '@tallywork/db';
import { can, forbidden, localDate, notFound, startOfLocalDay, addDaysToDate } from '@tallywork/domain';
import type { CurrentTrackingDto, EodReportDto, LiveWorkerDto, OffsetPage, SessionDto } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { actorRef } from './ctx';
import { audit } from './events';
import { effectivePolicy } from './policies';
import { narrowMemberships } from './scope';
import { likePattern } from '../lib/search';
import { applyTrigger, liveSession, lockWorker, recentSessions, startSession, toSessionDtos, todayAndWeek, workerTimezone, type ActorRef } from './tracking';
import { assertBreakType } from './operations';
import { assignmentsFor } from './work';

function ref(x: Ctx): ActorRef {
  const a = actorRef(x);
  return { type: a.actorType, id: a.actorId };
}

export async function currentTracking(x: Ctx, membershipId = x.actor.membershipId): Promise<CurrentTrackingDto> {
  const now = x.deps.now();
  const tz = await workerTimezone(x.tx, membershipId, x.org.timezone);
  const live = await liveSession(x.tx, membershipId);
  const [dto] = live ? await toSessionDtos(x.tx, [live], now) : [];
  const tw = await todayAndWeek(x.tx, membershipId, tz, x.org.weekStart, now);
  const policy = await effectivePolicy(x.tx, x.org.id, membershipId, x.policyCache);
  return {
    session: dto ?? null,
    today_seconds: tw.today,
    week_seconds: tw.week,
    limits: { daily_seconds: policy.limits.dailySeconds, weekly_seconds: policy.limits.weeklySeconds },
    server_time: now.toISOString(),
  };
}

export async function webStart(x: Ctx, input: { projectId: string; taskId: string | null; note?: string | null; source: 'WEB' | 'API' }) {
  if (!x.actor.grants['tracking:track']) throw forbidden();
  const policy = await effectivePolicy(x.tx, x.org.id, x.actor.membershipId, x.policyCache);
  const now = x.deps.now();
  await startSession(x.tx, {
    organizationId: x.org.id,
    orgTimezone: x.org.timezone,
    orgWeekStart: x.org.weekStart,
    membershipId: x.actor.membershipId,
    projectId: input.projectId,
    taskId: input.taskId,
    source: input.source,
    deviceId: null,
    at: now,
    note: input.note ?? null,
    actor: ref(x),
    policy,
    now,
  });
  return currentTracking(x);
}

async function myLive(x: Ctx) {
  await lockWorker(x.tx, x.actor.membershipId);
  const s = await liveSession(x.tx, x.actor.membershipId);
  if (!s) throw notFound('running_timer');
  return s;
}

export async function webStop(x: Ctx) {
  // Lock, then read (T10): a stop racing another stop or a switch sees the other's result.
  await lockWorker(x.tx, x.actor.membershipId);
  const s = await liveSession(x.tx, x.actor.membershipId);
  if (!s) return currentTracking(x); // idempotent
  await applyTrigger(x.tx, s, 'STOP', { at: x.deps.now(), actor: ref(x) });
  return currentTracking(x);
}

export async function webPause(x: Ctx, input: { breakTypeId?: string | null } = {}) {
  const s = await myLive(x);
  const breakTypeId = await assertBreakType(x.tx, input.breakTypeId);
  await applyTrigger(x.tx, s, 'PAUSE', { at: x.deps.now(), actor: ref(x), pauseKind: 'BREAK', breakTypeId, cause: 'user_pause' });
  return currentTracking(x);
}

export async function webResume(x: Ctx) {
  const s = await myLive(x);
  await applyTrigger(x.tx, s, 'RESUME', { at: x.deps.now(), actor: ref(x) });
  return currentTracking(x);
}

/** Switching task = stop the current session and start a new one (clean per-task sessions). */
export async function webSwitch(x: Ctx, input: { projectId: string; taskId: string | null }) {
  // Lock, then read (BE-4): two switches at once must not both stop the same session and start two.
  await lockWorker(x.tx, x.actor.membershipId);
  const s = await liveSession(x.tx, x.actor.membershipId);
  const source = s?.source === 'API' ? 'API' : 'WEB';
  if (s && s.source === 'DESKTOP') throw forbidden('Switch tasks in the desktop app while it is tracking');
  if (s) await applyTrigger(x.tx, s, 'STOP', { at: x.deps.now(), actor: ref(x), cause: 'task_switch' });
  return webStart(x, { projectId: input.projectId, taskId: input.taskId, source, note: s?.note ?? null });
}

export async function setSessionNote(x: Ctx, note: string) {
  const s = await myLive(x);
  await x.tx.update(trackingSessions).set({ note, updatedAt: new Date() }).where(eq(trackingSessions.id, s.id));
  return currentTracking(x);
}

export async function forceStop(x: Ctx, sessionId: string) {
  const [found] = await x.tx.select({ membershipId: trackingSessions.membershipId }).from(trackingSessions).where(eq(trackingSessions.id, sessionId));
  if (!found) throw notFound('session');
  if (!can(x.actor, 'tracking:force_stop', { ownerMembershipId: found.membershipId })) throw forbidden();
  // Lock, then read the session again (T10): a stop that landed meanwhile is seen, not repeated.
  await lockWorker(x.tx, found.membershipId);
  const [s] = (await x.tx.select().from(trackingSessions).where(eq(trackingSessions.id, sessionId))) as [typeof trackingSessions.$inferSelect];
  await applyTrigger(x.tx, s, 'FORCE_STOP', { at: x.deps.now(), actor: ref(x), cause: 'admin_force_stop' });
  await audit(x, { action: 'session.force_stopped', targetType: 'session', targetId: s.id });
  const [dto] = await toSessionDtos(x.tx, [(await x.tx.select().from(trackingSessions).where(eq(trackingSessions.id, sessionId)))[0]!], x.deps.now());
  return dto!;
}

export async function listSessions(x: Ctx, q: { from: string; to: string; membershipIds?: string[] }): Promise<SessionDto[]> {
  const visible = narrowMemberships(x.actor, 'tracking:read', q.membershipIds);
  const from = startOfLocalDay(q.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(q.to, 1), x.org.timezone);
  const rows = await recentSessions(x.tx, visible, from, to, 500);
  const dtos = await toSessionDtos(x.tx, rows, x.deps.now());
  const names = await memberNames(x, [...new Set(rows.map((r) => r.membershipId))]);
  return dtos.map((d) => ({ ...d, worker_name: names.get(d.membership_id) ?? '' }));
}

/** Sessions that overlap the local dates [from..to], that the person may see, optionally searched by member or project name. */
function sessionWhere(x: Ctx, q: { from: string; to: string; membershipIds?: string[]; search?: string }) {
  const visible = narrowMemberships(x.actor, 'tracking:read', q.membershipIds);
  const from = startOfLocalDay(q.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(q.to, 1), x.org.timezone);
  const term = q.search ? likePattern(q.search) : null;
  return and(
    visible === 'all' ? undefined : inArray(trackingSessions.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    lt(trackingSessions.startedAt, to),
    sql`coalesce(${trackingSessions.endedAt}, now()) >= ${from}`,
    term
      ? or(
          inArray(trackingSessions.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))),
          inArray(trackingSessions.projectId, x.tx.select({ id: projects.id }).from(projects).where(ilike(projects.name, term))),
        )
      : undefined,
  );
}

/**
 * One numbered page of sessions (`page` is 1-based), newest first, plus the time worked across
 * every matching session (open work segments count up to now).
 */
export async function pageSessions(
  x: Ctx,
  q: { from: string; to: string; membershipIds?: string[]; search?: string; page: number; pageSize: number },
): Promise<OffsetPage<SessionDto> & { summary: { worked_seconds: number } }> {
  const where = sessionWhere(x, q);
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(trackingSessions).where(where);
  const now = x.deps.now();
  const [worked] = await x.tx
    .select({ s: sql<number>`coalesce(sum(greatest(0, round(extract(epoch from (coalesce(${timeSegments.endedAt}, ${now}) - ${timeSegments.startedAt}))))), 0)::bigint` })
    .from(timeSegments)
    .innerJoin(trackingSessions, eq(trackingSessions.id, timeSegments.sessionId))
    .where(and(eq(timeSegments.kind, 'WORK'), where));
  const rows = await x.tx.select().from(trackingSessions).where(where).orderBy(desc(trackingSessions.startedAt), desc(trackingSessions.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const dtos = await toSessionDtos(x.tx, rows, now);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.membershipId))]);
  return { data: dtos.map((d) => ({ ...d, worker_name: names.get(d.membership_id) ?? '' })), total: count?.n ?? 0, page: q.page, page_size: q.pageSize, summary: { worked_seconds: Number(worked?.s ?? 0) } };
}

export async function getSession(x: Ctx, sessionId: string) {
  const [s] = await x.tx.select().from(trackingSessions).where(eq(trackingSessions.id, sessionId));
  if (!s || !can(x.actor, 'tracking:read', { ownerMembershipId: s.membershipId })) throw notFound('session');
  const [dto] = await toSessionDtos(x.tx, [s], x.deps.now());
  const transitions = await x.tx.select().from(sessionTransitions).where(eq(sessionTransitions.sessionId, s.id)).orderBy(sessionTransitions.occurredAt, sessionTransitions.createdAt);
  const segments = await x.tx.select().from(timeSegments).where(eq(timeSegments.sessionId, s.id)).orderBy(timeSegments.startedAt);
  const names = await memberNames(x, [s.membershipId]);
  return {
    ...dto!,
    worker_name: names.get(s.membershipId) ?? '',
    transitions: transitions.map((t) => ({ from: t.fromState, to: t.toState, trigger: t.trigger, cause: t.cause, actor_type: t.actorType, occurred_at: t.occurredAt.toISOString() })),
    segments: segments.map((g) => ({ kind: g.kind, break_type_id: g.breakTypeId, started_at: g.startedAt.toISOString(), ended_at: g.endedAt?.toISOString() ?? null })),
  };
}

export async function memberNames(x: Pick<Ctx, 'tx'>, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await x.tx.select({ id: memberships.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** End-of-day reports written on the local dates [from..to], for the people the actor may see, newest first. */
export async function listEodReports(x: Ctx, q: { from: string; to: string; membershipIds?: string[] }): Promise<EodReportDto[]> {
  const visible = narrowMemberships(x.actor, 'tracking:read', q.membershipIds);
  if (visible !== 'all' && !visible.length) return [];
  const rows = await x.tx
    .select({ r: eodReports, s: trackingSessions, color: projects.color })
    .from(eodReports)
    .innerJoin(trackingSessions, eq(trackingSessions.id, eodReports.sessionId))
    .leftJoin(projects, eq(projects.id, eodReports.projectId))
    .where(and(gte(eodReports.localDate, q.from), lte(eodReports.localDate, q.to), visible === 'all' ? undefined : inArray(eodReports.membershipId, visible)))
    .orderBy(desc(eodReports.createdAt))
    .limit(500);
  const sessions = new Map((await toSessionDtos(x.tx, rows.map((r) => r.s), x.deps.now())).map((d) => [d.id, d]));
  const names = await memberNames(x, [...new Set(rows.map((r) => r.r.membershipId))]);
  return rows.map(({ r, color }) => {
    const s = sessions.get(r.sessionId)!;
    return {
      id: r.id,
      membership_id: r.membershipId,
      worker_name: names.get(r.membershipId) ?? '',
      session_id: r.sessionId,
      project_id: r.projectId,
      project_name: s.project_name ?? '',
      project_color: color ?? '#4B4FC4',
      task_id: r.taskId,
      task_title: s.task_title ?? null,
      local_date: r.localDate,
      body: r.body,
      finished: r.finished,
      started_at: s.started_at,
      ended_at: s.ended_at,
      worked_seconds: s.worked_seconds,
      created_at: r.createdAt.toISOString(),
    };
  });
}

/** "Who is working right now" — scoped to what the actor may see. */
export async function liveWorkers(x: Ctx): Promise<LiveWorkerDto[]> {
  const visible = narrowMemberships(x.actor, 'tracking:read');
  const ms = await x.tx
    .select({ id: memberships.id, name: users.name, tz: workerProfiles.timezone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(and(eq(memberships.status, 'ACTIVE'), eq(workerProfiles.trackingEnabled, true), visible === 'all' ? undefined : inArray(memberships.id, visible.length ? visible : ['00000000-0000-7000-8000-000000000000'])))
    .orderBy(users.name);
  if (!ms.length) return [];
  const ids = ms.map((m) => m.id);
  const now = x.deps.now();
  const live = await x.tx.select().from(trackingSessions).where(and(inArray(trackingSessions.membershipId, ids), inArray(trackingSessions.state, ['ACTIVE', 'PAUSED', 'INTERRUPTED']), eq(trackingSessions.backfill, false)));
  const liveBy = new Map(live.map((s) => [s.membershipId, s]));
  const openIdle = live.length
    ? await x.tx.select({ sessionId: timeSegments.sessionId, kind: timeSegments.kind }).from(timeSegments).where(and(inArray(timeSegments.sessionId, live.map((s) => s.id)), isNull(timeSegments.endedAt)))
    : [];
  const pids = [...new Set(live.map((s) => s.projectId))];
  const tids = [...new Set(live.map((s) => s.taskId).filter((t): t is string => !!t))];
  const ps = pids.length ? await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pids)) : [];
  const ts = tids.length ? await x.tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, tids)) : [];
  const since = new Date(now.getTime() - 20 * 60_000);
  const recentAct = await x.tx
    .select({ membershipId: activityWindows.membershipId, pct: activityWindows.activityPct, ws: activityWindows.windowStart })
    .from(activityWindows)
    .where(and(inArray(activityWindows.membershipId, ids), sql`${activityWindows.windowStart} >= ${since}`))
    .orderBy(desc(activityWindows.windowStart));
  const lastSeen = await x.tx.select({ membershipId: devices.membershipId, seen: sql<Date | null>`max(${devices.lastSeenAt})` }).from(devices).where(inArray(devices.membershipId, ids)).groupBy(devices.membershipId);
  const seenBy = new Map(lastSeen.map((r) => [r.membershipId, r.seen]));

  // Today's totals for everyone in two queries (entries per local date + open segments).
  const todayOf = new Map(ms.map((m) => [m.id, localDate(now, m.tz)]));
  const dates = [...new Set(todayOf.values())];
  const totals = await x.tx
    .select({ m: timeEntries.membershipId, d: timeEntries.localDate, s: sql<number>`sum(${timeEntries.durationSeconds})::int` })
    .from(timeEntries)
    .where(and(inArray(timeEntries.membershipId, ids), inArray(timeEntries.localDate, dates), isNull(timeEntries.deletedAt)))
    .groupBy(timeEntries.membershipId, timeEntries.localDate);
  const openWork = live.length
    ? await x.tx.select({ sessionId: timeSegments.sessionId, startedAt: timeSegments.startedAt }).from(timeSegments).where(and(inArray(timeSegments.sessionId, live.map((s) => s.id)), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'WORK')))
    : [];

  const out: LiveWorkerDto[] = [];
  for (const m of ms) {
    const s = liveBy.get(m.id);
    const onIdle = s ? openIdle.some((g) => g.sessionId === s.id && g.kind === 'IDLE') : false;
    // WORKING = running; IDLE = paused (idle or break); INTERRUPTED devices count as offline and have no actionable session.
    const status: LiveWorkerDto['status'] = !s || s.state === 'INTERRUPTED' ? 'OFFLINE' : s.state === 'ACTIVE' ? 'WORKING' : 'IDLE';
    void onIdle;
    const ow = s ? openWork.find((w) => w.sessionId === s.id) : undefined;
    const dayStart = startOfLocalDay(todayOf.get(m.id)!, m.tz);
    const running = ow ? Math.max(0, Math.round((now.getTime() - Math.max(ow.startedAt.getTime(), dayStart.getTime())) / 1000)) : 0;
    const tw = { today: (totals.find((t) => t.m === m.id && t.d === todayOf.get(m.id))?.s ?? 0) + running };
    const act = recentAct.find((r) => r.membershipId === m.id);
    const seen = seenBy.get(m.id);
    out.push({
      membership_id: m.id,
      name: m.name,
      status,
      session_id: s && s.state !== 'INTERRUPTED' ? s.id : null,
      project_id: s?.projectId ?? null,
      project_name: s ? (ps.find((p) => p.id === s.projectId)?.name ?? null) : null,
      task_title: s?.taskId ? (ts.find((t) => t.id === s.taskId)?.title ?? null) : null,
      started_at: s?.startedAt.toISOString() ?? null,
      activity_pct: act?.pct ?? null,
      today_seconds: tw.today,
      last_seen_at: seen ? new Date(seen).toISOString() : null,
    });
  }
  const rank = { WORKING: 0, IDLE: 1, OFFLINE: 2 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}

export async function myAssignments(x: Ctx) {
  return assignmentsFor(x, x.org.id, x.actor.membershipId);
}

