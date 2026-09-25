import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  idleEvents,
  memberships,
  projects,
  sessionTransitions,
  tasks,
  timeEntries,
  timeEntryRevisions,
  timeSegments,
  trackingSessions,
  workerProfiles,
  type TrackingSource,
  type Tx,
} from '@tallywork/db';
import {
  LIVE_STATES,
  addDaysToDate,
  businessRule,
  conflict,
  forbidden,
  localDate,
  newId,
  notFound,
  splitAtLocalMidnight,
  startOfLocalDay,
  startOfWeek,
  transition,
  type SegmentKind,
  type SessionState,
  type SessionTrigger,
  type TrackingPolicy,
} from '@tallywork/domain';
import type { SessionDto } from '@tallywork/contracts';
import { emit } from './events';
import { workerCanTrackProject } from './work';

export type ActorRef = { type: 'user' | 'agent' | 'system' | 'api_key'; id: string | null };
type Session = typeof trackingSessions.$inferSelect;

/** Serialize all time mutations for one worker (prevents races between devices/tabs). */
export async function lockWorker(tx: Tx, membershipId: string): Promise<void> {
  await tx.execute(sql`select 1 from ${memberships} where ${memberships.id} = ${membershipId} for update`);
}

export async function liveSession(tx: Tx, membershipId: string): Promise<Session | null> {
  const [s] = await tx
    .select()
    .from(trackingSessions)
    .where(and(eq(trackingSessions.membershipId, membershipId), inArray(trackingSessions.state, LIVE_STATES as SessionState[])))
    .limit(1);
  return s ?? null;
}

export async function workerTimezone(tx: Tx, membershipId: string, fallback: string): Promise<string> {
  const [p] = await tx.select({ tz: workerProfiles.timezone }).from(workerProfiles).where(eq(workerProfiles.membershipId, membershipId));
  return p?.tz ?? fallback;
}

async function openSegment(tx: Tx, s: Session, kind: SegmentKind, at: Date, breakTypeId: string | null = null): Promise<void> {
  await tx.insert(timeSegments).values({ id: newId(), organizationId: s.organizationId, sessionId: s.id, membershipId: s.membershipId, kind, startedAt: at, breakTypeId: kind === 'BREAK' ? breakTypeId : null });
}

/** Close the open segment (if any) at `at`; WORK segments are converted into time entries. */
async function closeOpenSegment(tx: Tx, s: Session, at: Date): Promise<string[]> {
  const [open] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt))).limit(1);
  if (!open) return [];
  const end = at < open.startedAt ? open.startedAt : at;
  await tx.update(timeSegments).set({ endedAt: end }).where(eq(timeSegments.id, open.id));
  if (open.kind !== 'WORK') return [];
  return deriveEntries(tx, s, { id: open.id, startedAt: open.startedAt, endedAt: end });
}

/** Turn a closed WORK interval into per-local-day time entries. Returns affected local dates. */
async function deriveEntries(tx: Tx, s: Session, seg: { id: string | null; startedAt: Date; endedAt: Date }, opts: { projectId?: string; taskId?: string | null } = {}): Promise<string[]> {
  const projectId = opts.projectId ?? s.projectId;
  const taskId = opts.taskId === undefined ? s.taskId : opts.taskId;
  const [p] = await tx.select({ billable: projects.billableDefault }).from(projects).where(eq(projects.id, projectId));
  const pieces = splitAtLocalMidnight({ start: seg.startedAt, end: seg.endedAt }, s.timezone).filter((pc) => pc.end.getTime() - pc.start.getTime() >= 1000);
  for (const pc of pieces) {
    const id = newId();
    const duration = Math.round((pc.end.getTime() - pc.start.getTime()) / 1000);
    await tx.insert(timeEntries).values({
      id,
      organizationId: s.organizationId,
      membershipId: s.membershipId,
      projectId,
      taskId,
      sessionId: s.id,
      segmentId: seg.id,
      source: 'TRACKED',
      trackingSource: s.source,
      startedAt: pc.start,
      endedAt: pc.end,
      durationSeconds: duration,
      localDate: pc.localDate,
      timezone: s.timezone,
      billable: p?.billable ?? true,
      note: s.note,
    });
    await tx.insert(timeEntryRevisions).values({
      id: newId(),
      organizationId: s.organizationId,
      timeEntryId: id,
      revision: 1,
      action: 'CREATE',
      after: { started_at: pc.start, ended_at: pc.end, project_id: projectId, task_id: taskId },
      actorType: 'system',
    });
  }
  if (seg.id) await tx.update(timeSegments).set({ derivedAt: new Date() }).where(eq(timeSegments.id, seg.id));
  return [...new Set(pieces.map((p) => p.localDate))];
}

export async function markTimeChanged(tx: Tx, organizationId: string, membershipId: string, dates: string[], actor: ActorRef): Promise<void> {
  if (!dates.length) return;
  await emit(tx, organizationId, 'time.changed', { membership_id: membershipId, dates: [...new Set(dates)].sort() }, { workerId: membershipId, actor });
}

const EVENT_FOR: Partial<Record<SessionState, string>> = { ACTIVE: 'session.resumed', PAUSED: 'session.paused', STOPPED: 'session.stopped', INTERRUPTED: 'session.interrupted' };

/** Apply a state-machine trigger to a session and persist all side effects. */
export async function applyTrigger(
  tx: Tx,
  s: Session,
  trigger: SessionTrigger,
  opts: { at: Date; actor: ActorRef; cause?: string; pauseKind?: 'IDLE' | 'BREAK'; breakTypeId?: string | null; seq?: number; openAt?: Date },
): Promise<Session> {
  const r = transition(s.state, trigger, { pauseKind: opts.pauseKind });
  if (r.noop) return s;
  // Never apply an event earlier than the session start.
  const at = opts.at < s.startedAt ? s.startedAt : opts.at;
  let dates: string[] = [];
  switch (r.segment.type) {
    case 'close':
      dates = await closeOpenSegment(tx, s, at);
      break;
    case 'open':
      await openSegment(tx, s, r.segment.kind, opts.openAt ?? at, opts.breakTypeId);
      break;
    case 'close_and_open':
      dates = await closeOpenSegment(tx, s, at);
      await openSegment(tx, s, r.segment.kind, at, opts.breakTypeId);
      break;
    case 'none':
      break;
  }
  const patch: Partial<Session> = { state: r.to, updatedAt: new Date() };
  if (r.to === 'STOPPED') {
    patch.endedAt = at;
    patch.endReason = r.endReason ?? 'USER';
  }
  if (opts.seq !== undefined && opts.seq > s.lastSeq) patch.lastSeq = opts.seq;
  const [updated] = await tx.update(trackingSessions).set(patch).where(eq(trackingSessions.id, s.id)).returning();
  await tx.insert(sessionTransitions).values({
    id: newId(),
    organizationId: s.organizationId,
    sessionId: s.id,
    fromState: r.from,
    toState: r.to,
    trigger,
    cause: opts.cause ?? null,
    actorType: opts.actor.type,
    actorId: opts.actor.id,
    occurredAt: at,
  });
  const evt = trigger === 'RECOVER' ? 'session.recovered' : EVENT_FOR[r.to];
  if (evt) {
    await emit(tx, s.organizationId, evt, { session_id: s.id, membership_id: s.membershipId, project_id: s.projectId, task_id: s.taskId, trigger, end_reason: patch.endReason ?? null }, { workerId: s.membershipId, sessionId: s.id, occurredAt: at, actor: opts.actor });
  }
  await markTimeChanged(tx, s.organizationId, s.membershipId, dates, opts.actor);
  return updated!;
}

export interface StartInput {
  organizationId: string;
  orgTimezone: string;
  membershipId: string;
  projectId: string;
  taskId: string | null;
  source: TrackingSource;
  deviceId: string | null;
  sessionId?: string;
  at: Date;
  note?: string | null;
  seq?: number;
  actor: ActorRef;
  policy: TrackingPolicy;
  now: Date;
}

export async function validateTrackTarget(tx: Tx, membershipId: string, projectId: string, taskId: string | null): Promise<void> {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
  if (!p || p.archivedAt) throw notFound('project');
  if (p.status !== 'ACTIVE') throw businessRule('project_inactive', 'This project is not active');
  if (!(await workerCanTrackProject({ tx }, membershipId, projectId))) throw forbidden('You are not a member of this project');
  if (taskId) {
    const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!t || t.projectId !== projectId || t.archivedAt) throw notFound('task');
  }
}

export async function startSession(tx: Tx, input: StartInput): Promise<{ session: Session; duplicate: boolean }> {
  const { policy } = input;
  if (input.source === 'WEB' && !policy.tracking.allowWeb) throw businessRule('web_tracking_disabled', 'Web tracking is disabled by your organization');
  if (input.source === 'DESKTOP' && !policy.tracking.allowDesktop) throw businessRule('desktop_tracking_disabled', 'Desktop tracking is disabled by your organization');

  await lockWorker(tx, input.membershipId);

  if (input.sessionId) {
    const [dup] = await tx.select().from(trackingSessions).where(eq(trackingSessions.id, input.sessionId)).limit(1);
    if (dup) {
      if (dup.membershipId !== input.membershipId) throw conflict('session_id_conflict', 'Session id already used');
      return { session: dup, duplicate: true };
    }
  }

  const [profile] = await tx.select().from(workerProfiles).where(eq(workerProfiles.membershipId, input.membershipId));
  if (profile && !profile.trackingEnabled) throw businessRule('tracking_disabled', 'Time tracking is disabled for your account');
  await validateTrackTarget(tx, input.membershipId, input.projectId, input.taskId);
  const timezone = profile?.timezone ?? input.orgTimezone;

  const limitHit = await limitReached(tx, input.membershipId, timezone, policy, input.now);
  if (limitHit) throw businessRule('limit_reached', limitHit === 'daily' ? 'You have reached your daily time limit' : 'You have reached your weekly time limit');

  const existing = await liveSession(tx, input.membershipId);
  if (existing) {
    if (policy.tracking.singleTimer === 'reject') throw conflict('session_already_running', 'A timer is already running. Stop it first.');
    await applyTrigger(tx, existing, 'SUPERSEDE', { at: input.at < existing.startedAt ? existing.startedAt : input.at, actor: input.actor, cause: `superseded_by_${input.source.toLowerCase()}` });
  }

  const id = input.sessionId ?? newId();
  const [session] = await tx
    .insert(trackingSessions)
    .values({
      id,
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      deviceId: input.deviceId,
      source: input.source,
      projectId: input.projectId,
      taskId: input.taskId,
      state: 'ACTIVE',
      startedAt: input.at,
      timezone,
      note: input.note ?? null,
      lastSeq: input.seq ?? 0,
      lastHeartbeatAt: input.now,
      lastEvidenceAt: input.at,
    })
    .returning();
  await openSegment(tx, session!, 'WORK', input.at);
  await tx.insert(sessionTransitions).values({
    id: newId(),
    organizationId: input.organizationId,
    sessionId: id,
    fromState: null,
    toState: 'ACTIVE',
    trigger: 'START',
    actorType: input.actor.type,
    actorId: input.actor.id,
    occurredAt: input.at,
  });
  await emit(tx, input.organizationId, 'session.started', { session_id: id, membership_id: input.membershipId, project_id: input.projectId, task_id: input.taskId, source: input.source }, { workerId: input.membershipId, sessionId: id, occurredAt: input.at, actor: input.actor });
  return { session: session!, duplicate: false };
}

/** Seconds worked in a session (closed WORK segments + open one up to `now`). */
export async function sessionWorkedSeconds(tx: Tx, sessionIds: string[], now: Date): Promise<Map<string, { worked: number; openStart: Date | null }>> {
  const out = new Map<string, { worked: number; openStart: Date | null }>();
  if (!sessionIds.length) return out;
  const segs = await tx.select().from(timeSegments).where(and(inArray(timeSegments.sessionId, sessionIds), eq(timeSegments.kind, 'WORK')));
  for (const id of sessionIds) out.set(id, { worked: 0, openStart: null });
  for (const g of segs) {
    const o = out.get(g.sessionId)!;
    const end = g.endedAt ?? now;
    o.worked += Math.max(0, Math.round((end.getTime() - g.startedAt.getTime()) / 1000));
    if (!g.endedAt) o.openStart = g.startedAt;
  }
  return out;
}

/** Tracked seconds for a worker on local dates [from..to], including the running segment. */
export async function trackedSecondsBetween(tx: Tx, membershipId: string, timezone: string, from: string, to: string, now: Date): Promise<number> {
  const [r] = await tx
    .select({ s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}),0)::int` })
    .from(timeEntries)
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), sql`${timeEntries.localDate} between ${from} and ${to}`));
  let total = r?.s ?? 0;
  const live = await liveSession(tx, membershipId);
  if (live && live.state === 'ACTIVE') {
    const [open] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, live.id), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'WORK')));
    if (open) {
      const windowStart = startOfLocalDay(from, timezone);
      const windowEnd = startOfLocalDay(addDaysToDate(to, 1), timezone);
      const s = open.startedAt > windowStart ? open.startedAt : windowStart;
      const e = now < windowEnd ? now : windowEnd;
      total += Math.max(0, Math.round((e.getTime() - s.getTime()) / 1000));
    }
  }
  return total;
}

export async function todayAndWeek(tx: Tx, membershipId: string, timezone: string, weekStart: number, now: Date) {
  const today = localDate(now, timezone);
  const wk = startOfWeek(today, weekStart);
  return {
    today: await trackedSecondsBetween(tx, membershipId, timezone, today, today, now),
    week: await trackedSecondsBetween(tx, membershipId, timezone, wk, addDaysToDate(wk, 6), now),
  };
}

export async function limitReached(tx: Tx, membershipId: string, timezone: string, policy: TrackingPolicy, now: Date, weekStart = 1): Promise<'daily' | 'weekly' | null> {
  return (await limitExceeded(tx, membershipId, timezone, policy, now, weekStart))?.kind ?? null;
}

/** The limit that has been reached and by how many seconds it was overshot (so a stop can be placed exactly at the limit). */
export async function limitExceeded(tx: Tx, membershipId: string, timezone: string, policy: TrackingPolicy, now: Date, weekStart = 1): Promise<{ kind: 'daily' | 'weekly'; overBySeconds: number } | null> {
  const { dailySeconds, weeklySeconds } = policy.limits;
  if (dailySeconds == null && weeklySeconds == null) return null;
  const t = await todayAndWeek(tx, membershipId, timezone, weekStart, now);
  const hits: Array<{ kind: 'daily' | 'weekly'; overBySeconds: number }> = [];
  if (dailySeconds != null && t.today >= dailySeconds) hits.push({ kind: 'daily', overBySeconds: t.today - dailySeconds });
  if (weeklySeconds != null && t.week >= weeklySeconds) hits.push({ kind: 'weekly', overBySeconds: t.week - weeklySeconds });
  // The limit reached first is the one overshot the most.
  return hits.sort((a, b) => b.overBySeconds - a.overBySeconds)[0] ?? null;
}

// ─── Interval removal (idle discard, screenshot delete) ──────────────────────
/**
 * Remove [start, end) from a worker's tracked time by trimming/splitting/deleting
 * time entries. Every change is a revision; nothing is rewritten silently.
 */
export async function removeInterval(
  tx: Tx,
  params: { organizationId: string; membershipId: string; start: Date; end: Date; action: 'IDLE_DISCARD' | 'SCREENSHOT_DELETE' | 'UPDATE'; reason: string | null; actor: ActorRef; allowLocked?: boolean },
): Promise<string[]> {
  const { start, end } = params;
  if (end <= start) return [];
  const rows = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.membershipId, params.membershipId), isNull(timeEntries.deletedAt), lt(timeEntries.startedAt, end), gt(timeEntries.endedAt, start)))
    .orderBy(asc(timeEntries.startedAt));
  const dates: string[] = [];
  for (const e of rows) {
    if (e.lockedAt && !params.allowLocked) throw businessRule('time_locked', 'This time is part of a submitted or approved timesheet');
    dates.push(e.localDate);
    const before = { started_at: e.startedAt, ended_at: e.endedAt, duration_seconds: e.durationSeconds };
    const rev = async (id: string, revision: number, after: unknown, action: typeof params.action | 'DELETE' | 'SPLIT') =>
      tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: params.organizationId, timeEntryId: id, revision, action: action as 'UPDATE', before, after: after as object, reason: params.reason, actorType: params.actor.type, actorId: params.actor.id });
    const insideStart = e.startedAt >= start;
    const insideEnd = e.endedAt <= end;
    if (insideStart && insideEnd) {
      await tx.update(timeEntries).set({ deletedAt: new Date(), edited: true, revision: e.revision + 1, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
      await rev(e.id, e.revision + 1, { deleted: true }, params.action);
    } else if (insideStart) {
      // overlaps the end of the removed interval → trim start
      const dur = Math.round((e.endedAt.getTime() - end.getTime()) / 1000);
      await tx.update(timeEntries).set({ startedAt: end, durationSeconds: dur, edited: true, revision: e.revision + 1, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
      await rev(e.id, e.revision + 1, { started_at: end, ended_at: e.endedAt, duration_seconds: dur }, params.action);
    } else if (insideEnd) {
      const dur = Math.round((start.getTime() - e.startedAt.getTime()) / 1000);
      await tx.update(timeEntries).set({ endedAt: start, durationSeconds: dur, edited: true, revision: e.revision + 1, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
      await rev(e.id, e.revision + 1, { started_at: e.startedAt, ended_at: start, duration_seconds: dur }, params.action);
    } else {
      // removed interval is strictly inside the entry → split in two
      const d1 = Math.round((start.getTime() - e.startedAt.getTime()) / 1000);
      const d2 = Math.round((e.endedAt.getTime() - end.getTime()) / 1000);
      await tx.update(timeEntries).set({ endedAt: start, durationSeconds: d1, edited: true, revision: e.revision + 1, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
      await rev(e.id, e.revision + 1, { started_at: e.startedAt, ended_at: start, duration_seconds: d1 }, params.action);
      const newIdValue = newId();
      await tx.insert(timeEntries).values({ ...e, id: newIdValue, startedAt: end, durationSeconds: d2, revision: 1, edited: true, createdAt: new Date(), updatedAt: new Date() });
      await tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: params.organizationId, timeEntryId: newIdValue, revision: 1, action: 'SPLIT', before, after: { started_at: end, ended_at: e.endedAt, split_from: e.id }, reason: params.reason, actorType: params.actor.type, actorId: params.actor.id });
    }
  }
  await markTimeChanged(tx, params.organizationId, params.membershipId, dates, params.actor);
  return dates;
}

// ─── Idle ────────────────────────────────────────────────────────────────────
export async function recordIdleStarted(tx: Tx, s: Session, input: { idleId: string; startedAt: Date; policy: TrackingPolicy; actor: ActorRef }): Promise<void> {
  const inserted = await tx
    .insert(idleEvents)
    .values({ id: input.idleId, organizationId: s.organizationId, sessionId: s.id, membershipId: s.membershipId, startedAt: input.startedAt, clientEventId: input.idleId })
    .onConflictDoNothing()
    .returning({ id: idleEvents.id });
  if (!inserted.length) return; // duplicate
  if (input.policy.idle.behavior === 'pause' && s.state === 'ACTIVE') {
    await applyTrigger(tx, s, 'PAUSE', { at: input.startedAt, actor: input.actor, pauseKind: 'IDLE', cause: 'idle' });
  }
  await emit(tx, s.organizationId, 'idle.started', { session_id: s.id, idle_id: input.idleId, started_at: input.startedAt.toISOString() }, { workerId: s.membershipId, sessionId: s.id, actor: input.actor });
}

export async function resolveIdle(
  tx: Tx,
  params: {
    organizationId: string;
    idleId: string;
    sessionId: string;
    startedAt: Date;
    endedAt: Date;
    resolution: 'KEPT' | 'DISCARDED' | 'REASSIGNED';
    projectId?: string | null;
    taskId?: string | null;
    actor: ActorRef;
    resolvedBy: string | null;
  },
): Promise<void> {
  const [s] = await tx.select().from(trackingSessions).where(eq(trackingSessions.id, params.sessionId));
  if (!s) throw notFound('session');
  await lockWorker(tx, s.membershipId);
  let [ev] = await tx.select().from(idleEvents).where(eq(idleEvents.id, params.idleId));
  if (!ev) {
    await tx.insert(idleEvents).values({ id: params.idleId, organizationId: s.organizationId, sessionId: s.id, membershipId: s.membershipId, startedAt: params.startedAt, clientEventId: params.idleId });
    [ev] = await tx.select().from(idleEvents).where(eq(idleEvents.id, params.idleId));
  }
  if (ev!.resolution !== 'PENDING') return; // idempotent
  const start = ev!.startedAt;
  const end = params.endedAt > start ? params.endedAt : start;
  let current = s;

  // Paused on idle (policy = pause): the IDLE segment is open.
  const [openIdle] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'IDLE')));
  if (openIdle && current.state === 'PAUSED') {
    current = await applyTrigger(tx, current, 'RESUME', { at: end, actor: params.actor, cause: `idle_${params.resolution.toLowerCase()}` });
    if (params.resolution === 'KEPT') {
      const dates = await deriveEntries(tx, current, { id: null, startedAt: start, endedAt: end });
      await markTimeChanged(tx, s.organizationId, s.membershipId, dates, params.actor);
    }
  } else if (params.resolution !== 'KEPT') {
    // Tracking continued during idle: close the running segment so the idle span is derived, then carve it out.
    if (current.state === 'ACTIVE') {
      const [open] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt)));
      if (open && open.startedAt < end) {
        const dates = await closeOpenSegment(tx, current, end);
        await markTimeChanged(tx, s.organizationId, s.membershipId, dates, params.actor);
        await openSegment(tx, current, 'WORK', end);
      }
    }
    await removeInterval(tx, { organizationId: s.organizationId, membershipId: s.membershipId, start, end, action: 'IDLE_DISCARD', reason: 'Idle time discarded', actor: params.actor, allowLocked: params.actor.type === 'system' });
    await tx.insert(timeSegments).values({ id: newId(), organizationId: s.organizationId, sessionId: s.id, membershipId: s.membershipId, kind: 'IDLE', startedAt: start, endedAt: end, derivedAt: new Date() });
  }

  if (params.resolution === 'REASSIGNED' && params.projectId) {
    await validateTrackTarget(tx, s.membershipId, params.projectId, params.taskId ?? null);
    const dates = await deriveEntries(tx, current, { id: null, startedAt: start, endedAt: end }, { projectId: params.projectId, taskId: params.taskId ?? null });
    await markTimeChanged(tx, s.organizationId, s.membershipId, dates, params.actor);
  }

  await tx
    .update(idleEvents)
    .set({ endedAt: end, resolution: params.resolution, resolvedAt: new Date(), resolvedBy: params.resolvedBy, reassignedTaskId: params.taskId ?? null })
    .where(eq(idleEvents.id, ev!.id));
  await emit(tx, s.organizationId, 'idle.resolved', { session_id: s.id, idle_id: ev!.id, resolution: params.resolution, seconds: Math.round((end.getTime() - start.getTime()) / 1000) }, { workerId: s.membershipId, sessionId: s.id, actor: params.actor });
}

// ─── Read models ─────────────────────────────────────────────────────────────
export async function toSessionDtos(tx: Tx, rows: Session[], now: Date): Promise<SessionDto[]> {
  if (!rows.length) return [];
  const worked = await sessionWorkedSeconds(tx, rows.map((r) => r.id), now);
  const pids = [...new Set(rows.map((r) => r.projectId))];
  const tids = [...new Set(rows.map((r) => r.taskId).filter((t): t is string => !!t))];
  const ps = await tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pids));
  const ts = tids.length ? await tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, tids)) : [];
  const pm = new Map(ps.map((p) => [p.id, p.name]));
  const tm = new Map(ts.map((t) => [t.id, t.title]));
  return rows.map((r) => {
    const w = worked.get(r.id);
    return {
      id: r.id,
      membership_id: r.membershipId,
      device_id: r.deviceId,
      source: r.source,
      project_id: r.projectId,
      project_name: pm.get(r.projectId),
      task_id: r.taskId,
      task_title: r.taskId ? (tm.get(r.taskId) ?? null) : null,
      state: r.state,
      started_at: r.startedAt.toISOString(),
      ended_at: r.endedAt?.toISOString() ?? null,
      end_reason: r.endReason,
      note: r.note,
      worked_seconds: w?.worked ?? 0,
      current_segment_started_at: r.state === 'ACTIVE' && w?.openStart ? w.openStart.toISOString() : null,
    };
  });
}

export async function recentSessions(tx: Tx, membershipIds: string[] | 'all', from: Date, to: Date, limit = 200): Promise<Session[]> {
  return tx
    .select()
    .from(trackingSessions)
    .where(
      and(
        membershipIds === 'all' ? undefined : inArray(trackingSessions.membershipId, membershipIds.length ? membershipIds : ['00000000-0000-7000-8000-000000000000']),
        lt(trackingSessions.startedAt, to),
        sql`coalesce(${trackingSessions.endedAt}, now()) >= ${from}`,
      ),
    )
    .orderBy(desc(trackingSessions.startedAt))
    .limit(limit);
}
