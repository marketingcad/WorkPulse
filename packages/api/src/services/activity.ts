import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  activityMinutes,
  activityWindows,
  appSpans,
  idleEvents,
  projects,
  rollupAppDay,
  screenshots,
  tasks,
  timeEntries,
  timeSegments,
  trackingSessions,
  urlSpans,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, businessRule, can, forbidden, notFound, startOfLocalDay, windowStartOf } from '@tallywork/domain';
import type { ActivityBlockDto, ActivityDayDto, UsageRowDto } from '@tallywork/contracts';
import { actorRef, type Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { effectivePolicy } from './policies';
import { narrowMemberships } from './scope';
import { removeInterval, resolveIdle, workerTimezone } from './tracking';
import { signToken } from '../lib/crypto';
import { memberNames } from './timer';

const MEDIA_TTL_SECONDS = 15 * 60;

export function mediaUrl(x: Pick<Ctx, 'deps' | 'org'>, storageKey: string, variant: 'full' | 'thumb' = 'full'): string {
  const token = signToken(x.deps.config.appSecret, 'media', { k: storageKey, o: x.org.id, v: variant }, MEDIA_TTL_SECONDS);
  return `/api/v1/media/${token}`;
}

export async function activityDay(x: Ctx, membershipId: string, date: string): Promise<ActivityDayDto> {
  if (!can(x.actor, 'activity:read', { ownerMembershipId: membershipId })) throw notFound('worker');
  const tz = await workerTimezone(x.tx, membershipId, x.org.timezone);
  const dayStart = startOfLocalDay(date, tz);
  const dayEnd = startOfLocalDay(addDaysToDate(date, 1), tz);
  const canSeeShots = can(x.actor, 'screenshots:read', { ownerMembershipId: membershipId });
  const canSeeApps = can(x.actor, 'apps:read', { ownerMembershipId: membershipId });

  const windows = await x.tx.select().from(activityWindows).where(and(eq(activityWindows.membershipId, membershipId), gte(activityWindows.windowStart, dayStart), lt(activityWindows.windowStart, dayEnd))).orderBy(asc(activityWindows.windowStart));
  const entries = await x.tx.select().from(timeEntries).where(and(eq(timeEntries.membershipId, membershipId), eq(timeEntries.localDate, date), isNull(timeEntries.deletedAt))).orderBy(asc(timeEntries.startedAt));
  const shots = canSeeShots
    ? await x.tx.select().from(screenshots).where(and(eq(screenshots.membershipId, membershipId), gte(screenshots.capturedAt, dayStart), lt(screenshots.capturedAt, dayEnd), isNull(screenshots.deletedAt), eq(screenshots.status, 'READY'))).orderBy(asc(screenshots.capturedAt))
    : [];
  const idleSegs = await x.tx.select().from(timeSegments).where(and(eq(timeSegments.membershipId, membershipId), eq(timeSegments.kind, 'IDLE'), lt(timeSegments.startedAt, dayEnd), sql`coalesce(${timeSegments.endedAt}, now()) > ${dayStart}`));
  const pids = [...new Set([...windows.map((w) => w.projectId), ...entries.map((e) => e.projectId)])];
  const ps = pids.length ? await x.tx.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(inArray(projects.id, pids)) : [];
  const tids = [...new Set([...windows.map((w) => w.taskId), ...entries.map((e) => e.taskId)].filter((t): t is string => !!t))];
  const ts = tids.length ? await x.tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, tids)) : [];
  const pmap = new Map(ps.map((p) => [p.id, p]));
  const tmap = new Map(ts.map((t) => [t.id, t.title]));

  // Blocks: every 10-minute window that has tracked time (activity window or entry coverage).
  const blockStarts = new Map<number, ActivityBlockDto>();
  for (const w of windows) {
    blockStarts.set(w.windowStart.getTime(), {
      window_start: w.windowStart.toISOString(),
      session_id: w.sessionId,
      project_id: w.projectId,
      project_name: pmap.get(w.projectId)?.name ?? '',
      task_title: w.taskId ? (tmap.get(w.taskId) ?? null) : null,
      activity_pct: w.activityPct,
      keyboard_pct: w.keyboardPct,
      mouse_pct: w.mousePct,
      tracked_seconds: w.trackedSeconds,
      screenshots: [],
      idle: false,
      manual: false,
    });
  }
  for (const e of entries) {
    for (let t = windowStartOf(e.startedAt).getTime(); t < e.endedAt.getTime(); t += 600_000) {
      if (blockStarts.has(t)) continue;
      const overlap = Math.max(0, Math.min(e.endedAt.getTime(), t + 600_000) - Math.max(e.startedAt.getTime(), t)) / 1000;
      if (overlap < 1) continue;
      blockStarts.set(t, {
        window_start: new Date(t).toISOString(),
        session_id: e.sessionId,
        project_id: e.projectId,
        project_name: pmap.get(e.projectId)?.name ?? '',
        task_title: e.taskId ? (tmap.get(e.taskId) ?? null) : null,
        activity_pct: 0,
        keyboard_pct: 0,
        mouse_pct: 0,
        tracked_seconds: Math.round(overlap),
        screenshots: [],
        idle: false,
        manual: e.source === 'MANUAL',
      });
    }
  }
  for (const s of shots) {
    const key = s.windowStart.getTime();
    const b = blockStarts.get(key);
    const item = { id: s.id, captured_at: s.capturedAt.toISOString(), display_index: s.displayIndex, blurred: s.blurred, thumb_url: mediaUrl(x, s.storageKey, 'thumb'), full_url: mediaUrl(x, s.storageKey) };
    if (b) b.screenshots.push(item);
    else {
      // A screenshot whose time was later removed or not yet derived still gets a block.
      const w = windows.find((x2) => x2.sessionId === s.sessionId);
      blockStarts.set(key, { window_start: s.windowStart.toISOString(), session_id: s.sessionId, project_id: w?.projectId ?? '', project_name: w ? (pmap.get(w.projectId)?.name ?? '') : '', task_title: null, activity_pct: 0, keyboard_pct: 0, mouse_pct: 0, tracked_seconds: 0, screenshots: [item], idle: false, manual: false });
    }
  }
  for (const g of idleSegs) {
    for (const b of blockStarts.values()) {
      const t = Date.parse(b.window_start);
      if (g.startedAt.getTime() < t + 600_000 && (g.endedAt?.getTime() ?? Date.now()) > t) b.idle = true;
    }
  }
  const blocks = [...blockStarts.values()].sort((a, b) => a.window_start.localeCompare(b.window_start));

  const timeline: ActivityDayDto['timeline'] = [
    ...entries.map((e) => ({ start: e.startedAt.toISOString(), end: e.endedAt.toISOString(), kind: (e.source === 'MANUAL' ? 'MANUAL' : 'WORK') as 'WORK' | 'MANUAL', project_id: e.projectId, color: pmap.get(e.projectId)?.color ?? null })),
    ...idleSegs.filter((g) => g.endedAt).map((g) => ({ start: g.startedAt.toISOString(), end: g.endedAt!.toISOString(), kind: 'IDLE' as const, project_id: null, color: null })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const usage = canSeeApps
    ? await x.tx.select({ kind: rollupAppDay.kind, name: rollupAppDay.name, s: sql<number>`sum(${rollupAppDay.seconds})::int` }).from(rollupAppDay).where(and(eq(rollupAppDay.membershipId, membershipId), eq(rollupAppDay.localDate, date))).groupBy(rollupAppDay.kind, rollupAppDay.name)
    : [];
  const total = entries.reduce((s, e) => s + e.durationSeconds, 0);
  const trackedW = windows.reduce((s, w) => s + w.trackedSeconds, 0);
  const activeW = windows.reduce((s, w) => s + w.activeSeconds, 0);

  if (membershipId !== x.actor.membershipId) {
    await audit(x, { action: 'activity.viewed', targetType: 'membership', targetId: membershipId, metadata: { date, screenshots: shots.length } });
  }
  return {
    membership_id: membershipId,
    date,
    timezone: tz,
    total_seconds: total,
    avg_activity_pct: trackedW > 0 ? Math.round((activeW / trackedW) * 100) : 0,
    blocks,
    timeline,
    apps: usage.filter((u) => u.kind === 'APP').sort((a, b) => b.s - a.s).map((u) => ({ name: u.name, seconds: u.s })),
    urls: usage.filter((u) => u.kind === 'URL').sort((a, b) => b.s - a.s).map((u) => ({ name: u.name, seconds: u.s })),
  };
}

export async function listScreenshots(x: Ctx, q: { from: string; to: string; membershipIds?: string[]; limit?: number }) {
  const visible = narrowMemberships(x.actor, 'screenshots:read', q.membershipIds);
  const from = startOfLocalDay(q.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(q.to, 1), x.org.timezone);
  const rows = await x.tx
    .select({ s: screenshots, pct: activityWindows.activityPct, projectId: activityWindows.projectId })
    .from(screenshots)
    .leftJoin(activityWindows, and(eq(activityWindows.membershipId, screenshots.membershipId), eq(activityWindows.windowStart, screenshots.windowStart)))
    .where(
      and(
        isNull(screenshots.deletedAt),
        eq(screenshots.status, 'READY'),
        gte(screenshots.capturedAt, from),
        lt(screenshots.capturedAt, to),
        visible === 'all' ? undefined : inArray(screenshots.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    )
    .orderBy(desc(screenshots.capturedAt))
    .limit(Math.min(q.limit ?? 60, 200));
  const names = await memberNames(x, [...new Set(rows.map((r) => r.s.membershipId))]);
  // Access log: viewing other people's screenshots is recorded (one entry per list, with whose and how many).
  const others = rows.filter((r) => r.s.membershipId !== x.actor.membershipId);
  if (others.length) {
    await audit(x, { action: 'screenshot.list_viewed', targetType: 'screenshot', metadata: { count: others.length, members: [...new Set(others.map((r) => r.s.membershipId))], from: q.from, to: q.to } });
  }
  return rows.map(({ s, pct, projectId }) => ({
    id: s.id,
    membership_id: s.membershipId,
    worker_name: names.get(s.membershipId) ?? '',
    captured_at: s.capturedAt.toISOString(),
    activity_pct: pct,
    project_id: projectId,
    blurred: s.blurred,
    thumb_url: mediaUrl(x, s.storageKey, 'thumb'),
    full_url: mediaUrl(x, s.storageKey),
  }));
}

export async function getScreenshot(x: Ctx, id: string) {
  const [s] = await x.tx.select().from(screenshots).where(and(eq(screenshots.id, id), isNull(screenshots.deletedAt)));
  if (!s || !can(x.actor, 'screenshots:read', { ownerMembershipId: s.membershipId })) throw notFound('screenshot');
  if (s.membershipId !== x.actor.membershipId) await audit(x, { action: 'screenshot.viewed', targetType: 'screenshot', targetId: id });
  return { id: s.id, membership_id: s.membershipId, session_id: s.sessionId, captured_at: s.capturedAt.toISOString(), width: s.width, height: s.height, blurred: s.blurred, full_url: mediaUrl(x, s.storageKey) };
}

export async function deleteScreenshot(x: Ctx, id: string, removeTime: boolean) {
  const [s] = await x.tx.select().from(screenshots).where(and(eq(screenshots.id, id), isNull(screenshots.deletedAt)));
  if (!s || !can(x.actor, 'screenshots:read', { ownerMembershipId: s.membershipId })) throw notFound('screenshot');
  if (!can(x.actor, 'screenshots:delete', { ownerMembershipId: s.membershipId })) throw forbidden();
  const policy = await effectivePolicy(x.tx, x.org.id, s.membershipId, x.policyCache);
  const own = s.membershipId === x.actor.membershipId;
  if (own && x.actor.grants['screenshots:delete'] === 'own' && !policy.screenshots.workerCanDelete) throw forbidden('Your organization does not allow deleting screenshots');
  // Workers deleting their own screenshot lose that time block when the policy says so.
  const mustRemoveTime = own && x.actor.grants['screenshots:delete'] === 'own' ? policy.screenshots.deleteRemovesTime : removeTime;
  await x.tx.update(screenshots).set({ deletedAt: new Date(), deletedBy: x.actor.membershipId }).where(eq(screenshots.id, id));
  if (mustRemoveTime) {
    const a = actorRef(x);
    await removeInterval(x.tx, { organizationId: x.org.id, membershipId: s.membershipId, start: s.windowStart, end: new Date(s.windowStart.getTime() + 600_000), action: 'SCREENSHOT_DELETE', reason: 'Screenshot deleted', actor: { type: a.actorType, id: a.actorId } });
  }
  await x.deps.storage.delete([s.storageKey, `${s.storageKey}.thumb`]).catch(() => undefined);
  await emitFrom(x, 'screenshot.deleted', { screenshot_id: id, removed_time: mustRemoveTime }, { workerId: s.membershipId });
  await audit(x, { action: 'screenshot.deleted', targetType: 'screenshot', targetId: id, metadata: { removed_time: mustRemoveTime } });
}

export async function usage(x: Ctx, kind: 'APP' | 'URL', q: { from: string; to: string; membershipIds?: string[]; projectId?: string; groupBy: 'name' | 'worker' | 'project' }): Promise<UsageRowDto[] | Array<{ key: string; label: string; seconds: number; top: string[] }>> {
  const visible = narrowMemberships(x.actor, 'apps:read', q.membershipIds);
  const rows = await x.tx
    .select()
    .from(rollupAppDay)
    .where(
      and(
        eq(rollupAppDay.kind, kind),
        gte(rollupAppDay.localDate, q.from),
        sql`${rollupAppDay.localDate} <= ${q.to}`,
        q.projectId ? eq(rollupAppDay.projectId, q.projectId) : undefined,
        visible === 'all' ? undefined : inArray(rollupAppDay.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    );
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  if (q.groupBy === 'name') {
    const by = new Map<string, { seconds: number; workers: Set<string> }>();
    for (const r of rows) {
      const g = by.get(r.name) ?? { seconds: 0, workers: new Set() };
      g.seconds += r.seconds;
      g.workers.add(r.membershipId);
      by.set(r.name, g);
    }
    return [...by.entries()]
      .map(([name, g]) => ({ name, seconds: g.seconds, pct: total ? Math.round((g.seconds / total) * 1000) / 10 : 0, workers: g.workers.size }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 500);
  }
  const keyOf = (r: (typeof rows)[number]) => (q.groupBy === 'worker' ? r.membershipId : r.projectId);
  const by = new Map<string, { seconds: number; names: Map<string, number> }>();
  for (const r of rows) {
    const g = by.get(keyOf(r)) ?? { seconds: 0, names: new Map() };
    g.seconds += r.seconds;
    g.names.set(r.name, (g.names.get(r.name) ?? 0) + r.seconds);
    by.set(keyOf(r), g);
  }
  const labels =
    q.groupBy === 'worker'
      ? await memberNames(x, [...by.keys()])
      : new Map((by.size ? await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, [...by.keys()])) : []).map((p) => [p.id, p.name]));
  return [...by.entries()]
    .map(([key, g]) => ({ key, label: labels.get(key) ?? '', seconds: g.seconds, top: [...g.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n) }))
    .sort((a, b) => b.seconds - a.seconds);
}

export async function rawSpans(x: Ctx, kind: 'APP' | 'URL', membershipId: string, date: string) {
  if (!can(x.actor, 'apps:read', { ownerMembershipId: membershipId })) throw notFound('worker');
  const tz = await workerTimezone(x.tx, membershipId, x.org.timezone);
  const from = startOfLocalDay(date, tz);
  const to = startOfLocalDay(addDaysToDate(date, 1), tz);
  if (kind === 'APP') {
    const rows = await x.tx.select().from(appSpans).where(and(eq(appSpans.membershipId, membershipId), gte(appSpans.startedAt, from), lt(appSpans.startedAt, to))).orderBy(asc(appSpans.startedAt)).limit(2000);
    return rows.map((r) => ({ name: r.appName, detail: r.appId, started_at: r.startedAt.toISOString(), ended_at: r.endedAt.toISOString(), seconds: r.durationSeconds }));
  }
  const rows = await x.tx.select().from(urlSpans).where(and(eq(urlSpans.membershipId, membershipId), gte(urlSpans.startedAt, from), lt(urlSpans.startedAt, to))).orderBy(asc(urlSpans.startedAt)).limit(2000);
  return rows.map((r) => ({ name: r.domain, detail: r.url, started_at: r.startedAt.toISOString(), ended_at: r.endedAt.toISOString(), seconds: r.durationSeconds }));
}

export async function listIdleEvents(x: Ctx, q: { from: string; to: string; membershipIds?: string[]; status?: string }) {
  const visible = narrowMemberships(x.actor, 'activity:read', q.membershipIds);
  const from = startOfLocalDay(q.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(q.to, 1), x.org.timezone);
  const rows = await x.tx
    .select()
    .from(idleEvents)
    .where(
      and(
        gte(idleEvents.startedAt, from),
        lt(idleEvents.startedAt, to),
        q.status ? eq(idleEvents.resolution, q.status as 'PENDING') : undefined,
        visible === 'all' ? undefined : inArray(idleEvents.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    )
    .orderBy(desc(idleEvents.startedAt))
    .limit(500);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.membershipId))]);
  return rows.map((r) => ({
    id: r.id,
    membership_id: r.membershipId,
    worker_name: names.get(r.membershipId) ?? '',
    session_id: r.sessionId,
    started_at: r.startedAt.toISOString(),
    ended_at: r.endedAt?.toISOString() ?? null,
    seconds: r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : null,
    resolution: r.resolution,
  }));
}

/**
 * When an unanswered idle period ended. The device reports the end only with the worker's answer, so
 * use the first minute with keyboard or mouse input after it started; with none, the session's end
 * (or now while it still runs). Never "now" by default: that would treat later work as idle.
 */
export async function idleEndFromActivity(tx: Tx, ev: { sessionId: string; startedAt: Date }, now: Date): Promise<Date> {
  const [back] = await tx
    .select({ at: activityMinutes.minuteStart })
    .from(activityMinutes)
    .where(and(eq(activityMinutes.sessionId, ev.sessionId), sql`${activityMinutes.minuteStart} > ${ev.startedAt}`, sql`${activityMinutes.activeSeconds} > 0`))
    .orderBy(asc(activityMinutes.minuteStart))
    .limit(1);
  if (back) return back.at;
  const [s] = await tx.select({ endedAt: trackingSessions.endedAt }).from(trackingSessions).where(eq(trackingSessions.id, ev.sessionId));
  return s?.endedAt ?? now;
}

/** Manager/worker resolution of a pending idle event (e.g. worker never answered the prompt). */
export async function resolveIdleByUser(x: Ctx, id: string, input: { resolution: 'KEPT' | 'DISCARDED' | 'REASSIGNED'; projectId?: string; taskId?: string }) {
  const [ev] = await x.tx.select().from(idleEvents).where(eq(idleEvents.id, id));
  if (!ev || !can(x.actor, 'activity:read', { ownerMembershipId: ev.membershipId })) throw notFound('idle_event');
  const own = ev.membershipId === x.actor.membershipId;
  if (!own && !can(x.actor, 'time:edit', { ownerMembershipId: ev.membershipId })) throw forbidden();
  if (ev.resolution !== 'PENDING') throw businessRule('already_resolved', 'This idle time was already resolved');
  const a = actorRef(x);
  await resolveIdle(x.tx, {
    organizationId: x.org.id,
    idleId: id,
    sessionId: ev.sessionId,
    startedAt: ev.startedAt,
    endedAt: ev.endedAt ?? (await idleEndFromActivity(x.tx, ev, x.deps.now())),
    resolution: input.resolution,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    actor: { type: a.actorType, id: a.actorId },
    resolvedBy: x.actor.membershipId,
  });
  await audit(x, { action: 'idle.resolved', targetType: 'idle_event', targetId: id, metadata: input });
}
