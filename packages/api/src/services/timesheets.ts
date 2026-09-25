import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  activityWindows,
  approvalActions,
  billingEntries,
  billingRates,
  manualTimeRequests,
  memberships,
  projects,
  tasks,
  timeEntries,
  timeEntryRevisions,
  timesheetEntries,
  timesheets,
  users,
  workerProfiles,
  type Tx,
} from '@tallywork/db';
import {
  addDaysToDate,
  amountForSeconds,
  businessRule,
  can,
  eachDate,
  forbidden,
  isTimesheetEditable,
  newId,
  notFound,
  periodFor,
  resolveRate,
  splitAtLocalMidnight,
  timesheetTransition,
  validation,
  localDate,
  type Rate,
  type TimesheetAction,
  type TimesheetStatus,
} from '@tallywork/domain';
import type {
  ApprovalQueueItemDto,
  TimesheetDueDto,
  ManualTimeDto,
  TimeEntryDto,
  TimesheetDto,
  manualTimeInput,
  timeEntryUpdateInput,
} from '@tallywork/contracts';
import { actorRef, type Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { effectivePolicy } from './policies';
import { narrowMemberships } from './scope';
import { lockWorker, markTimeChanged, validateTrackTarget, workerTimezone, type ActorRef } from './tracking';
import { memberNames } from './timer';
import { accrueForTimesheet } from './operations';

function ref(x: Ctx): ActorRef {
  const a = actorRef(x);
  return { type: a.actorType, id: a.actorId };
}

// ─── Time entries ────────────────────────────────────────────────────────────
export async function listTimeEntries(x: Ctx, q: { from: string; to: string; membershipIds?: string[]; projectId?: string }, permission: 'time:read' | 'timesheets:read' = 'time:read'): Promise<TimeEntryDto[]> {
  const visible = narrowMemberships(x.actor, permission, q.membershipIds);
  const rows = await x.tx
    .select({ e: timeEntries, projectName: projects.name, taskTitle: tasks.title, workerName: users.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        isNull(timeEntries.deletedAt),
        sql`${timeEntries.localDate} between ${q.from} and ${q.to}`,
        visible === 'all' ? undefined : inArray(timeEntries.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
        q.projectId ? eq(timeEntries.projectId, q.projectId) : undefined,
      ),
    )
    .orderBy(asc(timeEntries.startedAt))
    .limit(5000);
  const acts = rows.length
    ? await x.tx
        .select()
        .from(activityWindows)
        .where(
          and(
            inArray(activityWindows.membershipId, [...new Set(rows.map((r) => r.e.membershipId))]),
            sql`${activityWindows.localDate} between ${q.from} and ${q.to}`,
          ),
        )
    : [];
  return rows.map(({ e, projectName, taskTitle, workerName }) => {
    const ws = acts.filter((a) => a.membershipId === e.membershipId && a.windowStart >= new Date(e.startedAt.getTime() - 600_000) && a.windowStart < e.endedAt);
    const tracked = ws.reduce((s, a) => s + a.trackedSeconds, 0);
    const active = ws.reduce((s, a) => s + a.activeSeconds, 0);
    return {
      id: e.id,
      membership_id: e.membershipId,
      worker_name: workerName,
      project_id: e.projectId,
      project_name: projectName,
      task_id: e.taskId,
      task_title: taskTitle,
      session_id: e.sessionId,
      source: e.source,
      tracking_source: e.trackingSource,
      started_at: e.startedAt.toISOString(),
      ended_at: e.endedAt.toISOString(),
      duration_seconds: e.durationSeconds,
      local_date: e.localDate,
      billable: e.billable,
      note: e.note,
      edited: e.edited,
      locked: !!e.lockedAt,
      activity_pct: tracked > 0 ? Math.round((active / tracked) * 100) : null,
    };
  });
}

async function loadEntryForEdit(x: Ctx, entryId: string) {
  const [e] = await x.tx.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), isNull(timeEntries.deletedAt)));
  if (!e || !can(x.actor, 'time:read', { ownerMembershipId: e.membershipId })) throw notFound('time_entry');
  if (!can(x.actor, 'time:edit', { ownerMembershipId: e.membershipId })) throw forbidden();
  const policy = await effectivePolicy(x.tx, x.org.id, e.membershipId, x.policyCache);
  const isSelf = e.membershipId === x.actor.membershipId;
  const isManager = x.actor.grants['time:edit'] === 'org' || (x.actor.grants['time:edit'] === 'team' && !isSelf);
  if (isSelf && !isManager && !policy.timeEdits.workerCanEdit) throw forbidden('Your organization does not allow editing your own time');
  if (e.lockedAt) throw businessRule('time_locked', 'This entry is part of a submitted or approved timesheet');
  await lockWorker(x.tx, e.membershipId);
  return { e, policy, isSelf, isManager };
}

async function assertNoOverlap(tx: Tx, membershipId: string, start: Date, end: Date, excludeIds: string[]) {
  const [clash] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.membershipId, membershipId),
        isNull(timeEntries.deletedAt),
        lt(timeEntries.startedAt, end),
        gt(timeEntries.endedAt, start),
        excludeIds.length ? sql`${timeEntries.id} not in ${sql.raw(`(${excludeIds.map((i) => `'${i.replace(/[^0-9a-f-]/gi, '')}'`).join(',')})`)}` : undefined,
      ),
    )
    .limit(1);
  if (clash) throw businessRule('time_overlap', 'This time overlaps another time entry');
}

/** New or moved time may not land in a period whose timesheet is submitted or approved. */
async function assertPeriodsOpen(x: Ctx, membershipId: string, dates: string[]) {
  const starts = [...new Set(dates.map((d) => periodOf(x, d).start))];
  if (!starts.length) return;
  const [closed] = await x.tx
    .select({ status: timesheets.status, periodStart: timesheets.periodStart })
    .from(timesheets)
    .where(and(eq(timesheets.membershipId, membershipId), inArray(timesheets.periodStart, starts), inArray(timesheets.status, ['SUBMITTED', 'APPROVED'])))
    .limit(1);
  if (closed) throw businessRule('timesheet_locked', `The timesheet for this period is ${closed.status.toLowerCase()}; reopen it before changing its time`, { period_start: closed.periodStart });
}

export async function updateTimeEntry(x: Ctx, entryId: string, input: z.infer<typeof timeEntryUpdateInput>) {
  const { e, policy, isSelf, isManager } = await loadEntryForEdit(x, entryId);
  if (policy.timeEdits.reasonRequired && !isManager && isSelf && !input.reason) throw validation('A reason is required to edit time');
  const start = input.started_at ? new Date(input.started_at) : e.startedAt;
  const end = input.ended_at ? new Date(input.ended_at) : e.endedAt;
  if (end <= start) throw validation('End must be after start');
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw validation('A single entry cannot exceed 24 hours');
  if (end > x.deps.now()) throw validation('Time entries cannot end in the future');
  const projectId = input.project_id ?? e.projectId;
  const taskId = input.task_id !== undefined ? input.task_id : e.taskId;
  if (input.project_id || input.task_id !== undefined) await validateTrackTarget(x.tx, e.membershipId, projectId, taskId);
  await assertNoOverlap(x.tx, e.membershipId, start, end, [e.id]);

  const pieces = splitAtLocalMidnight({ start, end }, e.timezone);
  if (pieces.length > 1) throw validation('An entry cannot cross midnight; split it into two entries');
  await assertPeriodsOpen(x, e.membershipId, [pieces[0]!.localDate]);
  const before = { started_at: e.startedAt, ended_at: e.endedAt, project_id: e.projectId, task_id: e.taskId, billable: e.billable, note: e.note };
  const after = { started_at: start, ended_at: end, project_id: projectId, task_id: taskId, billable: input.billable ?? e.billable, note: input.note !== undefined ? input.note : e.note };
  await x.tx
    .update(timeEntries)
    .set({
      startedAt: start,
      endedAt: end,
      durationSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
      localDate: pieces[0]!.localDate,
      projectId,
      taskId,
      billable: after.billable,
      note: after.note,
      edited: true,
      revision: e.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(timeEntries.id, e.id));
  await x.tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: x.org.id, timeEntryId: e.id, revision: e.revision + 1, action: 'UPDATE', before, after, reason: input.reason ?? null, ...actorRef(x) });
  await markTimeChanged(x.tx, x.org.id, e.membershipId, [e.localDate, pieces[0]!.localDate], ref(x));
  await audit(x, { action: 'time_entry.updated', targetType: 'time_entry', targetId: e.id, before, after, metadata: { reason: input.reason ?? null } });
  return (await listTimeEntries(x, { from: pieces[0]!.localDate, to: pieces[0]!.localDate, membershipIds: [e.membershipId] })).find((t) => t.id === e.id)!;
}

export async function splitTimeEntry(x: Ctx, entryId: string, at: Date, reason: string | null) {
  const { e, policy, isSelf, isManager } = await loadEntryForEdit(x, entryId);
  if (policy.timeEdits.reasonRequired && isSelf && !isManager && !reason) throw validation('A reason is required to split time');
  if (at <= e.startedAt || at >= e.endedAt) throw validation('Split point must be inside the entry');
  const d1 = Math.round((at.getTime() - e.startedAt.getTime()) / 1000);
  const d2 = Math.round((e.endedAt.getTime() - at.getTime()) / 1000);
  await x.tx.update(timeEntries).set({ endedAt: at, durationSeconds: d1, edited: true, revision: e.revision + 1, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
  await x.tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: x.org.id, timeEntryId: e.id, revision: e.revision + 1, action: 'SPLIT', before: { ended_at: e.endedAt }, after: { ended_at: at }, reason, ...actorRef(x) });
  const nid = newId();
  await x.tx.insert(timeEntries).values({ ...e, id: nid, startedAt: at, durationSeconds: d2, revision: 1, edited: true, createdAt: new Date(), updatedAt: new Date() });
  await x.tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: x.org.id, timeEntryId: nid, revision: 1, action: 'SPLIT', after: { started_at: at, ended_at: e.endedAt, split_from: e.id }, reason, ...actorRef(x) });
  await markTimeChanged(x.tx, x.org.id, e.membershipId, [e.localDate], ref(x));
  await audit(x, { action: 'time_entry.split', targetType: 'time_entry', targetId: e.id, metadata: { at, new_entry_id: nid, reason } });
  return { ids: [e.id, nid] };
}

export async function deleteTimeEntry(x: Ctx, entryId: string, reason: string | null) {
  const { e, policy, isSelf, isManager } = await loadEntryForEdit(x, entryId);
  if (policy.timeEdits.reasonRequired && isSelf && !isManager && !reason) throw validation('A reason is required to delete time');
  await x.tx.update(timeEntries).set({ deletedAt: new Date(), revision: e.revision + 1, edited: true, updatedAt: new Date() }).where(eq(timeEntries.id, e.id));
  await x.tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: x.org.id, timeEntryId: e.id, revision: e.revision + 1, action: 'DELETE', before: { started_at: e.startedAt, ended_at: e.endedAt }, after: { deleted: true }, reason, ...actorRef(x) });
  await markTimeChanged(x.tx, x.org.id, e.membershipId, [e.localDate], ref(x));
  await audit(x, { action: 'time_entry.deleted', targetType: 'time_entry', targetId: e.id, before: e, metadata: { reason } });
}

export async function entryRevisions(x: Ctx, entryId: string) {
  const [e] = await x.tx.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!e || !can(x.actor, 'time:read', { ownerMembershipId: e.membershipId })) throw notFound('time_entry');
  const rows = await x.tx.select().from(timeEntryRevisions).where(eq(timeEntryRevisions.timeEntryId, entryId)).orderBy(asc(timeEntryRevisions.revision));
  const names = await memberNames(x, [...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!))]);
  return rows.map((r) => ({ revision: r.revision, action: r.action, before: r.before, after: r.after, reason: r.reason, actor_type: r.actorType, actor_id: r.actorId, actor_name: r.actorType === 'user' && r.actorId ? (names.get(r.actorId) ?? null) : r.actorType === 'agent' ? 'Desktop app' : r.actorType === 'system' ? 'System' : null, created_at: r.createdAt.toISOString() }));
}

// ─── Manual time ─────────────────────────────────────────────────────────────
async function insertManualEntry(x: Ctx, req: typeof manualTimeRequests.$inferSelect): Promise<string[]> {
  const tz = await workerTimezone(x.tx, req.membershipId, x.org.timezone);
  const dates: string[] = [];
  let firstId: string | null = null;
  for (const pc of splitAtLocalMidnight({ start: req.startedAt, end: req.endedAt }, tz)) {
    const id = newId();
    firstId ??= id;
    await x.tx.insert(timeEntries).values({
      id,
      organizationId: x.org.id,
      membershipId: req.membershipId,
      projectId: req.projectId,
      taskId: req.taskId,
      source: 'MANUAL',
      startedAt: pc.start,
      endedAt: pc.end,
      durationSeconds: Math.round((pc.end.getTime() - pc.start.getTime()) / 1000),
      localDate: pc.localDate,
      timezone: tz,
      billable: req.billable,
      note: req.note,
    });
    await x.tx.insert(timeEntryRevisions).values({ id: newId(), organizationId: x.org.id, timeEntryId: id, revision: 1, action: 'CREATE', after: { manual_request_id: req.id }, reason: req.reason, ...actorRef(x) });
    dates.push(pc.localDate);
  }
  await x.tx.update(manualTimeRequests).set({ timeEntryId: firstId }).where(eq(manualTimeRequests.id, req.id));
  await markTimeChanged(x.tx, x.org.id, req.membershipId, dates, ref(x));
  return dates;
}

export async function requestManualTime(x: Ctx, input: z.infer<typeof manualTimeInput>, opts: { id?: string } = {}) {
  const membershipId = input.membership_id ?? x.actor.membershipId;
  const forSelf = membershipId === x.actor.membershipId;
  if (forSelf && !x.actor.grants['manual_time:request']) throw forbidden();
  if (!forSelf && !can(x.actor, 'manual_time:approve', { ownerMembershipId: membershipId })) throw forbidden();
  const start = new Date(input.started_at);
  const end = new Date(input.ended_at);
  if (end <= start) throw validation('End must be after start');
  if (end > x.deps.now()) throw validation('Manual time cannot be in the future');
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw validation('Manual time is limited to 24 hours per entry');
  const policy = await effectivePolicy(x.tx, x.org.id, membershipId, x.policyCache);
  if (forSelf && !policy.manualTime.allowed) throw businessRule('manual_time_disabled', 'Manual time is disabled by your organization');
  if (forSelf && policy.manualTime.reasonRequired && !input.reason) throw validation('A reason is required for manual time');
  await validateTrackTarget(x.tx, membershipId, input.project_id, input.task_id ?? null);
  await lockWorker(x.tx, membershipId);
  await assertNoOverlap(x.tx, membershipId, start, end, []);
  const tz = await workerTimezone(x.tx, membershipId, x.org.timezone);
  await assertPeriodsOpen(x, membershipId, splitAtLocalMidnight({ start, end }, tz).map((pc) => pc.localDate));
  const [p] = await x.tx.select({ billable: projects.billableDefault }).from(projects).where(eq(projects.id, input.project_id));
  const autoApprove = !policy.manualTime.requiresApproval || !forSelf || x.actor.grants['manual_time:approve'] === 'org';
  const id = opts.id ?? newId();
  const [req] = await x.tx
    .insert(manualTimeRequests)
    .values({
      id,
      organizationId: x.org.id,
      membershipId,
      projectId: input.project_id,
      taskId: input.task_id ?? null,
      startedAt: start,
      endedAt: end,
      reason: input.reason ?? null,
      note: input.note ?? null,
      billable: input.billable ?? p?.billable ?? true,
      status: autoApprove ? 'APPROVED' : 'PENDING',
      createdBy: x.actor.membershipId,
      decidedBy: autoApprove ? x.actor.membershipId : null,
      decidedAt: autoApprove ? new Date() : null,
    })
    .returning();
  if (autoApprove) await insertManualEntry(x, req!);
  else await emitFrom(x, 'manual_time.requested', { request_id: id, membership_id: membershipId }, { workerId: membershipId });
  await audit(x, { action: 'manual_time.requested', targetType: 'manual_time', targetId: id, after: { ...input, status: req!.status } });
  return (await listManualTime(x, {})).find((r) => r.id === id)!;
}

export async function listManualTime(x: Ctx, q: { status?: string; membershipIds?: string[] }): Promise<ManualTimeDto[]> {
  const visible = narrowMemberships(x.actor, 'time:read', q.membershipIds);
  const rows = await x.tx
    .select({ r: manualTimeRequests, projectName: projects.name, taskTitle: tasks.title })
    .from(manualTimeRequests)
    .innerJoin(projects, eq(projects.id, manualTimeRequests.projectId))
    .leftJoin(tasks, eq(tasks.id, manualTimeRequests.taskId))
    .where(
      and(
        q.status ? eq(manualTimeRequests.status, q.status as 'PENDING') : undefined,
        visible === 'all' ? undefined : inArray(manualTimeRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    )
    .orderBy(desc(manualTimeRequests.createdAt))
    .limit(500);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.r.membershipId))]);
  return rows.map(({ r, projectName, taskTitle }) => ({
    id: r.id,
    task_title: taskTitle,
    membership_id: r.membershipId,
    worker_name: names.get(r.membershipId) ?? '',
    project_id: r.projectId,
    project_name: projectName,
    task_id: r.taskId,
    started_at: r.startedAt.toISOString(),
    ended_at: r.endedAt.toISOString(),
    duration_seconds: Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000),
    reason: r.reason,
    note: r.note,
    status: r.status,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function decideManualTime(x: Ctx, id: string, approve: boolean, comment: string | null) {
  const [r] = await x.tx.select().from(manualTimeRequests).where(eq(manualTimeRequests.id, id));
  if (!r) throw notFound('manual_time');
  if (!can(x.actor, 'manual_time:approve', { ownerMembershipId: r.membershipId }) || r.membershipId === x.actor.membershipId) throw forbidden();
  if (r.status !== 'PENDING') throw businessRule('already_decided', 'This request has already been decided');
  await lockWorker(x.tx, r.membershipId);
  const status = approve ? 'APPROVED' : 'REJECTED';
  const [updated] = await x.tx.update(manualTimeRequests).set({ status, decidedBy: x.actor.membershipId, decidedAt: new Date(), decisionComment: comment }).where(eq(manualTimeRequests.id, id)).returning();
  if (approve) {
    await assertNoOverlap(x.tx, r.membershipId, r.startedAt, r.endedAt, []);
    const tz = await workerTimezone(x.tx, r.membershipId, x.org.timezone);
    await assertPeriodsOpen(x, r.membershipId, splitAtLocalMidnight({ start: r.startedAt, end: r.endedAt }, tz).map((pc) => pc.localDate));
    await insertManualEntry(x, updated!);
  }
  await x.tx.insert(approvalActions).values({ id: newId(), organizationId: x.org.id, subjectType: 'MANUAL_TIME', subjectId: id, action: approve ? 'APPROVE' : 'REJECT', fromStatus: 'PENDING', toStatus: status, comment, actorId: x.actor.membershipId });
  await emitFrom(x, approve ? 'manual_time.approved' : 'manual_time.rejected', { request_id: id, membership_id: r.membershipId }, { workerId: r.membershipId });
  await audit(x, { action: `manual_time.${approve ? 'approved' : 'rejected'}`, targetType: 'manual_time', targetId: id, metadata: { comment } });
}

// ─── Timesheets ──────────────────────────────────────────────────────────────
/** The timesheet a worker should submit now: last period if still open (overdue), else the current one on its last day. */
export async function timesheetDue(x: Ctx, membershipId: string, today: string): Promise<TimesheetDueDto | null> {
  if (membershipId !== x.actor.membershipId || !x.actor.grants['timesheets:submit']) return null;
  const current = periodOf(x, today);
  const previous = periodOf(x, addDaysToDate(current.start, -1));
  const candidates = [{ p: previous, overdue: true }, ...(today === current.end ? [{ p: current, overdue: false }] : [])];
  for (const { p, overdue } of candidates) {
    const [row] = await x.tx.select({ status: timesheets.status }).from(timesheets).where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.periodStart, p.start)));
    const status = row?.status ?? 'DRAFT';
    if (status !== 'DRAFT' && status !== 'REJECTED') continue;
    const [sum] = await x.tx
      .select({ s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}),0)::int` })
      .from(timeEntries)
      .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), sql`${timeEntries.localDate} between ${p.start} and ${p.end}`));
    if ((sum?.s ?? 0) > 0) return { period_start: p.start, period_end: p.end, status, total_seconds: sum!.s, overdue };
  }
  return null;
}

function periodOf(x: Ctx, date: string) {
  return periodFor(date, x.org.payPeriod, x.org.weekStart);
}

/**
 * Seconds of time in the period that are not in the current snapshot: time added (or changed)
 * after the timesheet was submitted, e.g. a desktop app that synced late. 0 while DRAFT/REJECTED.
 */
async function lateSeconds(tx: Tx, ts: { id: string; membershipId: string; status: string; periodStart: string; periodEnd: string }): Promise<number> {
  if (ts.status !== 'SUBMITTED' && ts.status !== 'APPROVED') return 0;
  const [r] = await tx
    .select({ s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}),0)::int` })
    .from(timeEntries)
    .leftJoin(timesheetEntries, and(eq(timesheetEntries.timesheetId, ts.id), eq(timesheetEntries.timeEntryId, timeEntries.id), eq(timesheetEntries.revision, timeEntries.revision), isNull(timesheetEntries.supersededAt)))
    .where(and(eq(timeEntries.membershipId, ts.membershipId), isNull(timeEntries.deletedAt), sql`${timeEntries.localDate} between ${ts.periodStart} and ${ts.periodEnd}`, isNull(timesheetEntries.id)));
  return r?.s ?? 0;
}

export async function getTimesheet(x: Ctx, membershipId: string, date: string): Promise<TimesheetDto> {
  if (!can(x.actor, 'timesheets:read', { ownerMembershipId: membershipId })) throw notFound('timesheet');
  const period = periodOf(x, date);
  const [row] = await x.tx.select().from(timesheets).where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.periodStart, period.start)));
  // A timesheet shows its own entries: reading it needs timesheets:read, not time:read.
  const entries = await listTimeEntries(x, { from: period.start, to: period.end, membershipIds: [membershipId] }, 'timesheets:read');
  const days = eachDate(period.start, period.end).map((d) => ({ date: d, seconds: entries.filter((e) => e.local_date === d).reduce((s, e) => s + e.duration_seconds, 0) }));
  const byKey = new Map<string, TimesheetDto['projects'][number]>();
  for (const e of entries) {
    const key = `${e.project_id}:${e.task_id ?? ''}`;
    let p = byKey.get(key);
    if (!p) {
      p = { project_id: e.project_id, project_name: e.project_name ?? '', task_id: e.task_id, task_title: e.task_title ?? null, days: {}, total: 0 };
      byKey.set(key, p);
    }
    p.days[e.local_date] = (p.days[e.local_date] ?? 0) + e.duration_seconds;
    p.total += e.duration_seconds;
  }
  const pids = [...new Set([...byKey.values()].map((p) => p.project_id))];
  if (pids.length) {
    const colors = await x.tx.select({ id: projects.id, color: projects.color }).from(projects).where(inArray(projects.id, pids));
    for (const p of byKey.values()) p.color = colors.find((c) => c.id === p.project_id)?.color;
  }
  const [prof] = await x.tx.select().from(workerProfiles).where(eq(workerProfiles.membershipId, membershipId));
  const names = await memberNames(x, [membershipId, ...(row?.decidedBy ? [row.decidedBy] : [])]);
  const withAct = entries.filter((e) => e.activity_pct !== null);
  const total = entries.reduce((s, e) => s + e.duration_seconds, 0);
  const periodDays = days.length;
  return {
    id: row?.id ?? null,
    membership_id: membershipId,
    worker_name: names.get(membershipId) ?? '',
    period_start: period.start,
    period_end: period.end,
    status: row?.status ?? 'DRAFT',
    submitted_at: row?.submittedAt?.toISOString() ?? null,
    decided_at: row?.decidedAt?.toISOString() ?? null,
    decided_by_name: row?.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
    comment: row?.comment ?? null,
    total_seconds: total,
    billable_seconds: entries.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0),
    manual_seconds: entries.filter((e) => e.source === 'MANUAL').reduce((s, e) => s + e.duration_seconds, 0),
    days,
    projects: [...byKey.values()].sort((a, b) => b.total - a.total),
    expected_seconds: prof?.weeklyExpectedSeconds != null ? Math.round((prof.weeklyExpectedSeconds * periodDays) / 7) : null,
    avg_activity_pct: withAct.length ? Math.round(withAct.reduce((s, e) => s + (e.activity_pct ?? 0) * e.duration_seconds, 0) / Math.max(1, withAct.reduce((s, e) => s + e.duration_seconds, 0))) : null,
    version: row?.version ?? 0,
    late_seconds: row ? await lateSeconds(x.tx, row) : 0,
  };
}

async function ensureTimesheet(x: Ctx, membershipId: string, date: string) {
  const period = periodOf(x, date);
  await x.tx.insert(timesheets).values({ id: newId(), organizationId: x.org.id, membershipId, periodStart: period.start, periodEnd: period.end }).onConflictDoNothing();
  const [row] = await x.tx.select().from(timesheets).where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.periodStart, period.start)));
  return row!;
}

async function setEntriesLocked(tx: Tx, membershipId: string, from: string, to: string, locked: boolean) {
  await tx
    .update(timeEntries)
    .set({ lockedAt: locked ? new Date() : null })
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), sql`${timeEntries.localDate} between ${from} and ${to}`));
}

async function recordAction(x: Ctx, ts: typeof timesheets.$inferSelect, action: TimesheetAction, to: TimesheetStatus, comment: string | null) {
  await x.tx.insert(approvalActions).values({ id: newId(), organizationId: x.org.id, subjectType: 'TIMESHEET', subjectId: ts.id, action, fromStatus: ts.status, toStatus: to, comment, actorId: x.actor.membershipId });
}

export async function submitTimesheet(x: Ctx, membershipId: string, date: string, expectedVersion?: number) {
  if (membershipId !== x.actor.membershipId && !can(x.actor, 'timesheets:approve', { ownerMembershipId: membershipId })) throw forbidden();
  if (membershipId === x.actor.membershipId && !x.actor.grants['timesheets:submit']) throw forbidden();
  await lockWorker(x.tx, membershipId);
  const ts = await ensureTimesheet(x, membershipId, date);
  // A brand-new (virtual) timesheet is reported to clients as version 0.
  const currentVersion = ts.status === 'DRAFT' && ts.version === 1 && !ts.submittedAt ? 0 : ts.version;
  if (expectedVersion !== undefined && expectedVersion !== currentVersion && expectedVersion !== ts.version) throw businessRule('stale_version', 'This timesheet changed; reload and try again');
  const to = timesheetTransition(ts.status, 'SUBMIT');
  // Snapshot exactly what is being submitted.
  const entries = await x.tx.select().from(timeEntries).where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), sql`${timeEntries.localDate} between ${ts.periodStart} and ${ts.periodEnd}`));
  // Earlier snapshots (e.g. one that was approved, then reopened) are kept as history.
  await x.tx.update(timesheetEntries).set({ supersededAt: new Date() }).where(and(eq(timesheetEntries.timesheetId, ts.id), isNull(timesheetEntries.supersededAt)));
  if (entries.length) {
    await x.tx.insert(timesheetEntries).values(
      entries.map((e) => ({ id: newId(), organizationId: x.org.id, timesheetId: ts.id, timeEntryId: e.id, revision: e.revision, projectId: e.projectId, taskId: e.taskId, localDate: e.localDate, durationSeconds: e.durationSeconds, billable: e.billable, source: e.source })),
    );
  }
  const total = entries.reduce((s, e) => s + e.durationSeconds, 0);
  await x.tx
    .update(timesheets)
    .set({
      status: to,
      submittedAt: new Date(),
      totalSeconds: total,
      billableSeconds: entries.filter((e) => e.billable).reduce((s, e) => s + e.durationSeconds, 0),
      manualSeconds: entries.filter((e) => e.source === 'MANUAL').reduce((s, e) => s + e.durationSeconds, 0),
      comment: null,
      version: ts.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(timesheets.id, ts.id));
  await setEntriesLocked(x.tx, membershipId, ts.periodStart, ts.periodEnd, true);
  await recordAction(x, ts, 'SUBMIT', to, null);
  await emitFrom(x, 'timesheet.submitted', { timesheet_id: ts.id, membership_id: membershipId, period_start: ts.periodStart, period_end: ts.periodEnd, total_seconds: total }, { workerId: membershipId });
  await audit(x, { action: 'timesheet.submitted', targetType: 'timesheet', targetId: ts.id });
  return getTimesheet(x, membershipId, date);
}

async function loadTimesheetForDecision(x: Ctx, timesheetId: string) {
  const [ts] = await x.tx.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  if (!ts || !can(x.actor, 'timesheets:read', { ownerMembershipId: ts.membershipId })) throw notFound('timesheet');
  if (!can(x.actor, 'timesheets:approve', { ownerMembershipId: ts.membershipId })) throw forbidden();
  // Nobody approves their own timesheet unless they are the org owner.
  if (ts.membershipId === x.actor.membershipId && !x.actor.isOwner) throw forbidden('You cannot approve your own timesheet');
  await lockWorker(x.tx, ts.membershipId);
  return ts;
}

/** Price approved time: one billing entry per time entry, snapshotting the rates. */
async function createBillingEntries(x: Ctx, ts: typeof timesheets.$inferSelect) {
  const snap = await x.tx.select().from(timesheetEntries).where(and(eq(timesheetEntries.timesheetId, ts.id), isNull(timesheetEntries.supersededAt)));
  if (!snap.length) return;
  const rateRows = await x.tx.select().from(billingRates);
  const rates: Rate[] = rateRows.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, scopeId: r.scopeId, amountMinor: r.amountMinor, currency: r.currency, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
  const pids = [...new Set(snap.map((s) => s.projectId))];
  const ps = await x.tx.select({ id: projects.id, clientId: projects.clientId }).from(projects).where(inArray(projects.id, pids));
  const clientOf = new Map(ps.map((p) => [p.id, p.clientId]));
  for (const s of snap) {
    const rc = { date: s.localDate, membershipId: ts.membershipId, projectId: s.projectId, clientId: clientOf.get(s.projectId) ?? null };
    const bill = s.billable ? resolveRate(rates, 'BILL', rc) : null;
    const pay = resolveRate(rates, 'PAY', rc);
    await x.tx
      .insert(billingEntries)
      .values({
        id: newId(),
        organizationId: x.org.id,
        timeEntryId: s.timeEntryId,
        revision: s.revision,
        timesheetId: ts.id,
        membershipId: ts.membershipId,
        projectId: s.projectId,
        clientId: clientOf.get(s.projectId) ?? null,
        taskId: s.taskId,
        localDate: s.localDate,
        seconds: s.durationSeconds,
        billable: s.billable,
        billRateId: bill?.id ?? null,
        payRateId: pay?.id ?? null,
        billAmountMinor: bill ? amountForSeconds(s.durationSeconds, bill.amountMinor) : 0,
        payAmountMinor: pay ? amountForSeconds(s.durationSeconds, pay.amountMinor) : 0,
        currency: bill?.currency ?? pay?.currency ?? x.org.currency,
      })
      .onConflictDoNothing();
  }
}

export async function decideTimesheet(x: Ctx, timesheetId: string, action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'REOPEN', comment: string | null) {
  const ts = await loadTimesheetForDecision(x, timesheetId);
  const to = timesheetTransition(ts.status, action);
  if ((action === 'REJECT' || action === 'REQUEST_CHANGES') && !comment) throw validation('Please add a comment for the worker');
  if (action === 'APPROVE' && (await lateSeconds(x.tx, ts)) > 0) {
    throw businessRule('timesheet_changed_since_submit', 'Time was added after this timesheet was submitted. Request changes so the worker can review and resubmit it.');
  }
  if (action === 'REOPEN') {
    const [invoiced] = await x.tx.select({ id: billingEntries.id }).from(billingEntries).where(and(eq(billingEntries.timesheetId, ts.id), isNull(billingEntries.voidedAt), sql`${billingEntries.invoiceLineId} is not null`)).limit(1);
    if (invoiced) throw businessRule('timesheet_invoiced', 'This timesheet is on an invoice; void the invoice first');
    await x.tx.update(billingEntries).set({ voidedAt: new Date() }).where(and(eq(billingEntries.timesheetId, ts.id), isNull(billingEntries.voidedAt)));
  }
  if (action === 'APPROVE') await createBillingEntries(x, ts);
  if (action === 'APPROVE' || action === 'REOPEN') await accrueForTimesheet(x.tx, x.org.id, ts, action);
  await x.tx.update(timesheets).set({ status: to, decidedAt: new Date(), decidedBy: x.actor.membershipId, comment, version: ts.version + 1, updatedAt: new Date() }).where(eq(timesheets.id, ts.id));
  if (to === 'DRAFT' || to === 'REJECTED') await setEntriesLocked(x.tx, ts.membershipId, ts.periodStart, ts.periodEnd, false);
  await recordAction(x, ts, action, to, comment);
  const evt = { APPROVE: 'timesheet.approved', REJECT: 'timesheet.rejected', REQUEST_CHANGES: 'timesheet.changes_requested', REOPEN: 'timesheet.reopened' }[action];
  await emitFrom(x, evt, { timesheet_id: ts.id, membership_id: ts.membershipId, period_start: ts.periodStart, period_end: ts.periodEnd, comment }, { workerId: ts.membershipId });
  await audit(x, { action: evt, targetType: 'timesheet', targetId: ts.id, metadata: { comment } });
  return getTimesheet(x, ts.membershipId, ts.periodStart);
}

export async function bulkApprove(x: Ctx, ids: string[]) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await x.tx.transaction(async (sp) => decideTimesheet({ ...x, tx: sp }, id, 'APPROVE', null));
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }
  return results;
}

export async function approvalQueue(x: Ctx, q: { status?: string }): Promise<ApprovalQueueItemDto[]> {
  if (!x.actor.grants['timesheets:approve']) throw forbidden();
  const visible = narrowMemberships(x.actor, 'timesheets:approve');
  const rows = await x.tx
    .select()
    .from(timesheets)
    .where(
      and(
        eq(timesheets.status, (q.status ?? 'SUBMITTED') as TimesheetStatus),
        visible === 'all' ? undefined : inArray(timesheets.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
        x.actor.isOwner ? undefined : ne(timesheets.membershipId, x.actor.membershipId),
      ),
    )
    .orderBy(desc(timesheets.periodStart), asc(timesheets.submittedAt))
    .limit(500);
  if (!rows.length) return [];
  const names = await memberNames(x, rows.map((r) => r.membershipId));
  const profs = await x.tx.select().from(workerProfiles).where(inArray(workerProfiles.membershipId, rows.map((r) => r.membershipId)));
  const out: ApprovalQueueItemDto[] = [];
  for (const r of rows) {
    const acts = await x.tx
      .select({ a: sql<number>`coalesce(sum(${activityWindows.activeSeconds}),0)::int`, t: sql<number>`coalesce(sum(${activityWindows.trackedSeconds}),0)::int` })
      .from(activityWindows)
      .where(and(eq(activityWindows.membershipId, r.membershipId), sql`${activityWindows.localDate} between ${r.periodStart} and ${r.periodEnd}`));
    const prof = profs.find((p) => p.membershipId === r.membershipId);
    const days = eachDate(r.periodStart, r.periodEnd).length;
    const expected = prof?.weeklyExpectedSeconds != null ? Math.round((prof.weeklyExpectedSeconds * days) / 7) : null;
    const avg = acts[0] && acts[0].t > 0 ? Math.round((acts[0].a / acts[0].t) * 100) : null;
    const flags: string[] = [];
    if (r.totalSeconds > 0 && r.manualSeconds / r.totalSeconds > 0.25) flags.push('high_manual');
    if (expected && r.totalSeconds < expected * 0.8) flags.push('under_expected');
    if (expected && r.totalSeconds > expected * 1.2) flags.push('over_expected');
    if (avg !== null && avg < 20) flags.push('low_activity');
    const late = await lateSeconds(x.tx, r);
    if (late > 0) flags.push('late_time');
    out.push({
      timesheet_id: r.id,
      membership_id: r.membershipId,
      worker_name: names.get(r.membershipId) ?? '',
      period_start: r.periodStart,
      period_end: r.periodEnd,
      status: r.status,
      submitted_at: r.submittedAt?.toISOString() ?? null,
      total_seconds: r.totalSeconds,
      manual_seconds: r.manualSeconds,
      expected_seconds: expected,
      avg_activity_pct: avg,
      late_seconds: late,
      flags,
    });
  }
  return out;
}

export async function timesheetHistory(x: Ctx, timesheetId: string) {
  const [ts] = await x.tx.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  if (!ts || !can(x.actor, 'timesheets:read', { ownerMembershipId: ts.membershipId })) throw notFound('timesheet');
  const rows = await x.tx.select().from(approvalActions).where(and(eq(approvalActions.subjectType, 'TIMESHEET'), eq(approvalActions.subjectId, timesheetId))).orderBy(asc(approvalActions.createdAt));
  const names = await memberNames(x, rows.map((r) => r.actorId));
  return rows.map((r) => ({ action: r.action, from: r.fromStatus, to: r.toStatus, comment: r.comment, actor_name: names.get(r.actorId) ?? '', created_at: r.createdAt.toISOString() }));
}

