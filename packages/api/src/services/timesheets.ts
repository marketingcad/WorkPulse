import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  activityWindows,
  approvalActions,
  billingEntries,
  billingRates,
  clients,
  manualTimeRequests,
  memberships,
  projects,
  tasks,
  timeEntries,
  timeEntryRevisions,
  timeSegments,
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
  DomainError,
  can,
  eachDate,
  forbidden,
  isTimesheetEditable,
  newId,
  notFound,
  periodFor,
  resolveRate,
  splitAtLocalMidnight,
  startOfLocalDay,
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
  OffsetPage,
  TimeEntryDto,
  TimeEntryPageSummary,
  TimeEntryTotalRow,
  TimesheetDto,
  manualTimeInput,
  timeEntryUpdateInput,
} from '@tallywork/contracts';
import { actorRef, type Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { effectivePolicy } from './policies';
import { narrowMemberships } from './scope';
import { likePattern } from '../lib/search';
import { lockWorker, markTimeChanged, validateTrackTarget, workerTimezone, type ActorRef } from './tracking';
import { memberNames } from './timer';
import { accrueForTimesheet } from './operations';
import { checkTimeType, isNotBillableType, timeTypeCoefficients } from './time-types';

function ref(x: Ctx): ActorRef {
  const a = actorRef(x);
  return { type: a.actorType, id: a.actorId };
}

// ─── Time entries ────────────────────────────────────────────────────────────
type TimeEntryQuery = { from: string; to: string; membershipIds?: string[]; projectId?: string; projectIds?: string[]; clientId?: string; taskId?: string; search?: string };
type TimePermission = 'time:read' | 'timesheets:read';

/** Entries the person may see that match the filters. `search` covers the note, project, task, client and member. */
function timeEntryWhere(x: Ctx, q: TimeEntryQuery, permission: TimePermission) {
  const visible = narrowMemberships(x.actor, permission, q.membershipIds);
  const term = q.search ? likePattern(q.search) : null;
  return and(
    isNull(timeEntries.deletedAt),
    sql`${timeEntries.localDate} between ${q.from} and ${q.to}`,
    visible === 'all' ? undefined : inArray(timeEntries.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    q.projectId ? eq(timeEntries.projectId, q.projectId) : undefined,
    q.projectIds?.length ? inArray(timeEntries.projectId, q.projectIds) : undefined,
    q.clientId ? eq(projects.clientId, q.clientId) : undefined,
    q.taskId ? eq(timeEntries.taskId, q.taskId) : undefined,
    term ? or(ilike(timeEntries.note, term), ilike(projects.name, term), ilike(tasks.title, term), ilike(clients.name, term), ilike(users.name, term)) : undefined,
  );
}

const entryFields = { e: timeEntries, projectName: projects.name, clientId: projects.clientId, clientName: clients.name, taskTitle: tasks.title, workerName: users.name };

/**
 * Time entries as a plain array, oldest first. Capped at 5000; use `pageTimeEntries` to reach
 * every entry in a busy range.
 */
export async function listTimeEntries(x: Ctx, q: TimeEntryQuery, permission: TimePermission = 'time:read'): Promise<TimeEntryDto[]> {
  const rows = await x.tx
    .select(entryFields)
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(timeEntryWhere(x, q, permission)).orderBy(asc(timeEntries.startedAt), asc(timeEntries.id)).limit(5000);
  return toTimeEntryDtos(x, rows);
}

/**
 * One numbered page of time entries (`page` is 1-based), newest day first unless `order` is
 * 'asc', plus totals for the whole range and for each day, so day headers stay right when a day
 * spans two pages.
 */
export async function pageTimeEntries(x: Ctx, q: TimeEntryQuery & { page: number; pageSize: number; order?: 'asc' | 'desc' }): Promise<OffsetPage<TimeEntryDto> & { summary: TimeEntryPageSummary }> {
  const where = timeEntryWhere(x, q, 'time:read');
  const billableSeconds = sql<number>`coalesce(sum(${timeEntries.durationSeconds}) filter (where ${timeEntries.billable}), 0)::int`;
  const byDay = await x.tx
    .select({ date: timeEntries.localDate, entries: sql<number>`count(*)::int`, seconds: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int`, billable: billableSeconds })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .groupBy(timeEntries.localDate)
    .orderBy(asc(timeEntries.localDate));
  const dir = q.order === 'asc' ? asc : desc;
  const rows = await x.tx
    .select(entryFields)
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(dir(timeEntries.localDate), dir(timeEntries.startedAt), dir(timeEntries.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const total = byDay.reduce((s, d) => s + d.entries, 0);
  return {
    data: await toTimeEntryDtos(x, rows),
    total,
    page: q.page,
    page_size: q.pageSize,
    summary: {
      entries: total,
      seconds: byDay.reduce((s, d) => s + d.seconds, 0),
      billable_seconds: byDay.reduce((s, d) => s + d.billable, 0),
      by_day: byDay.map((d) => ({ date: d.date, entries: d.entries, seconds: d.seconds, billable_seconds: d.billable })),
    },
  };
}

/** Hours per member and day (total, billable, manual), summed in the database: the team timesheet without loading entries. */
export async function timeEntryTotals(x: Ctx, q: TimeEntryQuery): Promise<TimeEntryTotalRow[]> {
  const rows = await x.tx
    .select({
    membershipId: timeEntries.membershipId,
    date: timeEntries.localDate,
    seconds: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int`,
    billable: sql<number>`coalesce(sum(${timeEntries.durationSeconds}) filter (where ${timeEntries.billable}), 0)::int`,
    manual: sql<number>`coalesce(sum(${timeEntries.durationSeconds}) filter (where ${timeEntries.source} = 'MANUAL'), 0)::int`,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, timeEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(timeEntryWhere(x, q, 'time:read'))
    .groupBy(timeEntries.membershipId, timeEntries.localDate);
  return rows.map((r) => ({ membership_id: r.membershipId, date: r.date, seconds: r.seconds, billable_seconds: r.billable, manual_seconds: r.manual }));
}

async function toTimeEntryDtos(x: Ctx, rows: Array<{ e: typeof timeEntries.$inferSelect; projectName: string; clientId: string | null; clientName: string | null; taskTitle: string | null; workerName: string }>): Promise<TimeEntryDto[]> {
  if (!rows.length) return [];
  const cutoff = await ownLockCutoff(x);
  // Activity only for the members and days on this page, not the whole range.
  const dates = rows.map((r) => r.e.localDate).sort();
  const acts = await x.tx
    .select()
    .from(activityWindows)
    .where(
      and(
        inArray(activityWindows.membershipId, [...new Set(rows.map((r) => r.e.membershipId))]),
        // A day either side: an entry can start just before midnight of the window's local day.
        sql`${activityWindows.localDate} between ${addDaysToDate(dates[0]!, -1)} and ${addDaysToDate(dates.at(-1)!, 1)}`,
      ),
    );
  return rows.map(({ e, projectName, clientId, clientName, taskTitle, workerName }) => {
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
      time_type_id: e.timeTypeId,
      duration_only: e.durationOnly,
      client_id: clientId,
      client_name: clientName,
      edited: e.edited,
      locked: !!e.lockedAt || isAgeLocked(x, cutoff, e.localDate, e.membershipId),
      activity_pct: tracked > 0 ? Math.round((active / tracked) * 100) : null,
    };
  });
}

/** The first date members may still change their own time on (org "lock time entries" setting), or null. */
/** `today` defaults to the organization's date; for a person's own time pass their local date (see ownLockCutoff). */
export function lockCutoff(x: Pick<Ctx, 'org' | 'deps'>, today = localDate(x.deps.now(), x.org.timezone)): string | null {
  const s = x.org.settings;
  const cutoffs: string[] = [];
  if (s.lockAfterDays != null) cutoffs.push(addDaysToDate(today, -s.lockAfterDays));
  if (s.lockBeforeDate) cutoffs.push(s.lockBeforeDate);
  return cutoffs.length ? cutoffs.sort().at(-1)! : null;
}

/**
 * The age lock only binds a person's own time, and that time is dated in their timezone, so "N days ago"
 * counts from their local today (not the organization's, which can be a day apart).
 */
async function ownLockCutoff(x: Ctx): Promise<string | null> {
  const s = x.org.settings;
  if (s.lockAfterDays == null && !s.lockBeforeDate) return null;
  return lockCutoff(x, localDate(x.deps.now(), await workerTimezone(x.tx, x.actor.membershipId, x.org.timezone)));
}

/** Whether the age lock stops this actor changing their own time on `date` (managers are not bound by it). */
function isAgeLocked(x: Ctx, cutoff: string | null, date: string, ownerMembershipId?: string): boolean {
  if (!cutoff || date >= cutoff) return false;
  if (ownerMembershipId && ownerMembershipId !== x.actor.membershipId) return false;
  return x.actor.grants['time:edit'] !== 'org';
}

export async function assertNotAgeLocked(x: Ctx, membershipId: string, dates: string[]) {
  if (membershipId !== x.actor.membershipId || x.actor.grants['time:edit'] === 'org') return;
  const cutoff = await ownLockCutoff(x);
  const old = cutoff ? dates.filter((d) => d < cutoff).sort()[0] : undefined;
  if (old) throw businessRule('time_entries_locked', `Time before ${cutoff} is locked. Ask a manager to change it.`, { locked_before: cutoff });
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
  await assertNotAgeLocked(x, e.membershipId, [e.localDate]);
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
  const running = await runningSince(tx, membershipId);
  if (running && running < end) throw businessRule('time_overlap', 'This time overlaps the timer that is running now');
}

/**
 * When the member's timer is running: the start of its open work (or idle) segment. That time
 * becomes an entry only when the segment closes, so it is checked separately; it runs until now.
 */
async function runningSince(tx: Tx, membershipId: string): Promise<Date | null> {
  const [open] = await tx
    .select({ startedAt: timeSegments.startedAt })
    .from(timeSegments)
    .where(and(eq(timeSegments.membershipId, membershipId), isNull(timeSegments.endedAt), inArray(timeSegments.kind, ['WORK', 'IDLE'])))
    .limit(1);
  return open?.startedAt ?? null;
}

/** New or moved time may not land in a period whose timesheet is submitted or approved. */
export async function assertPeriodsOpen(x: Ctx, membershipId: string, dates: string[]) {
  if (!dates.length) return;
  const sorted = [...dates].sort();
  // By date range, not by the current period boundaries: a timesheet approved before the pay period or
  // week start changed still covers its own dates.
  const candidates = await x.tx
    .select({ status: timesheets.status, periodStart: timesheets.periodStart, periodEnd: timesheets.periodEnd })
    .from(timesheets)
    .where(and(eq(timesheets.membershipId, membershipId), inArray(timesheets.status, ['SUBMITTED', 'APPROVED']), lte(timesheets.periodStart, sorted[sorted.length - 1]!), gte(timesheets.periodEnd, sorted[0]!)));
  const closed = candidates.find((t) => dates.some((d) => d >= t.periodStart && d <= t.periodEnd));
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
  await assertNotAgeLocked(x, e.membershipId, [pieces[0]!.localDate]);
  await assertPeriodsOpen(x, e.membershipId, [pieces[0]!.localDate]);
  const type = await checkTimeType(x.tx, input.time_type_id);
  const timeTypeId = type ? type.id : e.timeTypeId;
  // The entry's type decides, whether it was just chosen or already set (e.g. a bulk "billable" change).
  const notBillable = type ? type.notBillable : await isNotBillableType(x.tx, e.timeTypeId);
  const before ={ started_at: e.startedAt, ended_at: e.endedAt, project_id: e.projectId, task_id: e.taskId, billable: e.billable, note: e.note, time_type_id: e.timeTypeId };
  const after = {
    started_at: start,
    ended_at: end,
    project_id: projectId,
    task_id: taskId,
    billable: notBillable ? false : (input.billable ?? e.billable),
    note: input.note !== undefined ? input.note : e.note,
    time_type_id: timeTypeId,
  };
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
      timeTypeId,
      // Real clock times were entered: the entry is no longer duration-only.
      ...(input.started_at || input.ended_at ? { durationOnly: false } : {}),
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
/**
 * Where a duration-only entry goes: the first gap on that local day that fits, starting at 09:00
 * (or at midnight when the morning is full), never overlapping other time and never in the future.
 */
async function freeSlot(x: Ctx, membershipId: string, tz: string, date: string, seconds: number): Promise<{ start: Date; end: Date }> {
  const dayStart = startOfLocalDay(date, tz);
  const dayEnd = startOfLocalDay(addDaysToDate(date, 1), tz);
  const busy = await x.tx
    .select({ s: timeEntries.startedAt, e: timeEntries.endedAt })
    .from(timeEntries)
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), lt(timeEntries.startedAt, dayEnd), gt(timeEntries.endedAt, dayStart)))
    .orderBy(asc(timeEntries.startedAt));
  const running = await runningSince(x.tx, membershipId);
  if (running) busy.push({ s: running, e: x.deps.now() });
  busy.sort((a, b) => a.s.getTime() - b.s.getTime());
  const limit = Math.min(dayEnd.getTime(), x.deps.now().getTime());
  const fit = (from: number) => {
    let t = from;
    for (const b of busy) if (t < b.e.getTime() && t + seconds * 1000 > b.s.getTime()) t = Math.max(t, b.e.getTime());
    return t + seconds * 1000 <= limit ? t : null;
  };
  const t = fit(dayStart.getTime() + 9 * 3600_000) ?? fit(dayStart.getTime());
  if (t === null) throw businessRule('no_free_time', `There is no free ${Math.round(seconds / 60)}-minute slot on ${date}. Enter start and end times instead.`);
  return { start: new Date(t), end: new Date(t + seconds * 1000) };
}

/** Bulk changes from the timesheet list; each entry goes through the normal checks. */
export async function bulkTimeEntries(x: Ctx, input: { ids: string[]; action: 'delete' | 'set_billable' | 'set_non_billable'; reason?: string | null }) {
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      // A savepoint per entry: one locked entry must not undo the others.
      await x.tx.transaction(async (tx) => {
        const y = { ...x, tx: tx as unknown as Tx };
        if (input.action === 'delete') await deleteTimeEntry(y, id, input.reason ?? null);
        else await updateTimeEntry(y, id, { billable: input.action === 'set_billable', reason: input.reason ?? undefined });
      });
      out.push({ id, ok: true });
    } catch (e) {
      out.push({ id, ok: false, error: e instanceof Error ? e.message : 'Failed' });
    }
  }
  return out;
}
async function insertManualEntry(x: Ctx, req: typeof manualTimeRequests.$inferSelect): Promise<string[]> {
  const tz = await workerTimezone(x.tx, req.membershipId, x.org.timezone);
  const dates: string[] = [];
  let firstId: string | null = null;
  // Part-billable time: the first `billableSeconds` are billable, the rest is a separate non-billable entry,
  // so rollups, approval pricing and invoices need no special case.
  let billableLeft = req.billable ? (req.billableSeconds ?? Number.POSITIVE_INFINITY) : 0;
  const pieces: Array<{ start: Date; end: Date; localDate: string; billable: boolean }> = [];
  for (const pc of splitAtLocalMidnight({ start: req.startedAt, end: req.endedAt }, tz)) {
    const secs = (pc.end.getTime() - pc.start.getTime()) / 1000;
    if (!req.billable) pieces.push({ ...pc, billable: false });
    else if (billableLeft >= secs) pieces.push({ ...pc, billable: true });
    else if (billableLeft <= 0) pieces.push({ ...pc, billable: false });
    else {
      const cut = new Date(pc.start.getTime() + billableLeft * 1000);
      pieces.push({ start: pc.start, end: cut, localDate: pc.localDate, billable: true }, { start: cut, end: pc.end, localDate: pc.localDate, billable: false });
    }
    billableLeft -= secs;
  }
  for (const pc of pieces) {
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
      billable: pc.billable,
      note: req.note,
      timeTypeId: req.timeTypeId,
      durationOnly: req.durationOnly,
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
  const policy = await effectivePolicy(x.tx, x.org.id, membershipId, x.policyCache);
  if (forSelf && !policy.manualTime.allowed) throw businessRule('manual_time_disabled', 'Manual time is disabled by your organization');
  if (forSelf && policy.manualTime.reasonRequired && !input.reason) throw validation('A reason is required for manual time');
  await validateTrackTarget(x.tx, membershipId, input.project_id, input.task_id ?? null);
  await lockWorker(x.tx, membershipId);
  const tz = await workerTimezone(x.tx, membershipId, x.org.timezone);
  const durationOnly = !(input.started_at && input.ended_at);
  const { start, end } = durationOnly
    ? await freeSlot(x, membershipId, tz, input.local_date!, input.duration_seconds!)
    : { start: new Date(input.started_at!), end: new Date(input.ended_at!) };
  if (end <= start) throw validation('End must be after start');
  if (end > x.deps.now()) throw validation('Manual time cannot be in the future');
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw validation('Manual time is limited to 24 hours per entry');
  const totalSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (input.billable_seconds !== undefined && input.billable_seconds > totalSeconds) throw validation('Billable time cannot be more than the time logged', { errors: [{ field: 'billable_seconds', message: 'At most the time logged' }] });
  await assertNoOverlap(x.tx, membershipId, start, end, []);
  const dates = splitAtLocalMidnight({ start, end }, tz).map((pc) => pc.localDate);
  await assertNotAgeLocked(x, membershipId, dates);
  await assertPeriodsOpen(x, membershipId, dates);
  const type = await checkTimeType(x.tx, input.time_type_id);
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
      billable: type?.notBillable ? false : (input.billable ?? p?.billable ?? true),
      timeTypeId: type?.id ?? null,
      billableSeconds: input.billable_seconds !== undefined && input.billable_seconds < totalSeconds ? input.billable_seconds : null,
      durationOnly,
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

type ManualTimeQuery = { status?: string; membershipIds?: string[]; search?: string };

/** Manual time requests the person may see; `search` covers the reason, note, project, task and member. */
function manualTimeWhere(x: Ctx, q: ManualTimeQuery) {
  const visible = narrowMemberships(x.actor, 'time:read', q.membershipIds);
  const term = q.search ? likePattern(q.search) : null;
  return and(
    q.status ? eq(manualTimeRequests.status, q.status as 'PENDING') : undefined,
    visible === 'all' ? undefined : inArray(manualTimeRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    term
      ? or(
          ilike(manualTimeRequests.reason, term),
          ilike(manualTimeRequests.note, term),
          ilike(projects.name, term),
          ilike(tasks.title, term),
          inArray(manualTimeRequests.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))),
        )
      : undefined,
  );
}

const manualTimeOrder = [desc(manualTimeRequests.createdAt), desc(manualTimeRequests.id)];

/** Manual time requests as a plain array, newest first, capped at 500; use `pageManualTime` to reach every request. */
export async function listManualTime(x: Ctx, q: ManualTimeQuery): Promise<ManualTimeDto[]> {
  const rows = await x.tx
    .select({ r: manualTimeRequests, projectName: projects.name, taskTitle: tasks.title })
    .from(manualTimeRequests)
    .innerJoin(projects, eq(projects.id, manualTimeRequests.projectId))
    .leftJoin(tasks, eq(tasks.id, manualTimeRequests.taskId))
    .where(manualTimeWhere(x, q))
    .orderBy(...manualTimeOrder)
    .limit(500);
  return toManualTimeDtos(x, rows);
}

/** One numbered page of manual time requests (`page` is 1-based) and the total. */
export async function pageManualTime(x: Ctx, q: ManualTimeQuery & { page: number; pageSize: number }): Promise<OffsetPage<ManualTimeDto>> {
  const where = manualTimeWhere(x, q);
  const [count] = await x.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(manualTimeRequests)
    .innerJoin(projects, eq(projects.id, manualTimeRequests.projectId))
    .leftJoin(tasks, eq(tasks.id, manualTimeRequests.taskId))
    .where(where);
  const rows = await x.tx
    .select({ r: manualTimeRequests, projectName: projects.name, taskTitle: tasks.title })
    .from(manualTimeRequests)
    .innerJoin(projects, eq(projects.id, manualTimeRequests.projectId))
    .leftJoin(tasks, eq(tasks.id, manualTimeRequests.taskId))
    .where(where)
    .orderBy(...manualTimeOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: await toManualTimeDtos(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toManualTimeDtos(x: Ctx, rows: Array<{ r: typeof manualTimeRequests.$inferSelect; projectName: string; taskTitle: string | null }>): Promise<ManualTimeDto[]> {
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
  const [found] = await x.tx.select().from(manualTimeRequests).where(eq(manualTimeRequests.id, id));
  if (!found) throw notFound('manual_time');
  if (!can(x.actor, 'manual_time:approve', { ownerMembershipId: found.membershipId }) || found.membershipId === x.actor.membershipId) throw forbidden();
  await lockWorker(x.tx, found.membershipId);
  // Read again under the lock: another approver may have decided it while we waited.
  const [r] = (await x.tx.select().from(manualTimeRequests).where(eq(manualTimeRequests.id, id))) as [typeof found];
  if (r.status !== 'PENDING') throw businessRule('already_decided', 'This request has already been decided');
  const status = approve ? 'APPROVED' : 'REJECTED';
  const [updated] = await x.tx.update(manualTimeRequests).set({ status, decidedBy: x.actor.membershipId, decidedAt: new Date(), decisionComment: comment }).where(eq(manualTimeRequests.id, id)).returning();
  if (approve) {
    // Checked again now: since the request, the project or task may have been archived or put on
    // hold, or the person taken off the project. Rejecting the request is still possible.
    await validateTrackTarget(x.tx, r.membershipId, r.projectId, r.taskId).catch((e: unknown) => {
      if (!(e instanceof DomainError)) throw e;
      throw businessRule('manual_time_target_unavailable', 'This time can no longer be added: the project or task was archived or is not active, or the person is no longer on the project. Reject the request instead.');
    });
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
    .where(
      and(
        eq(timeEntries.membershipId, membershipId),
        isNull(timeEntries.deletedAt),
        sql`${timeEntries.localDate} between ${from} and ${to}`,
        // Unlocking never frees time that another submitted or approved timesheet still covers.
        locked
          ? undefined
          : sql`not exists (select 1 from ${timesheets} t where t.membership_id = ${membershipId} and t.status in ('SUBMITTED', 'APPROVED') and ${timeEntries.localDate} between t.period_start and t.period_end)`,
      ),
    );
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
      entries.map((e) => ({ id: newId(), organizationId: x.org.id, timesheetId: ts.id, timeEntryId: e.id, revision: e.revision, projectId: e.projectId, taskId: e.taskId, localDate: e.localDate, durationSeconds: e.durationSeconds, billable: e.billable, source: e.source, timeTypeId: e.timeTypeId })),
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
  const [found] = await x.tx.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  if (!found || !can(x.actor, 'timesheets:read', { ownerMembershipId: found.membershipId })) throw notFound('timesheet');
  if (!can(x.actor, 'timesheets:approve', { ownerMembershipId: found.membershipId })) throw forbidden();
  // Nobody approves their own timesheet unless they are the org owner.
  if (found.membershipId === x.actor.membershipId && !x.actor.isOwner) throw forbidden('You cannot approve your own timesheet');
  await lockWorker(x.tx, found.membershipId);
  // Read again under the lock: another approver may have decided it while we waited.
  const [ts] = await x.tx.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  return ts!;
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
  const coef = await timeTypeCoefficients(x.tx);
  for (const s of snap) {
    const rc = { date: s.localDate, membershipId: ts.membershipId, projectId: s.projectId, clientId: clientOf.get(s.projectId) ?? null };
    const bill = s.billable ? resolveRate(rates, 'BILL', rc) : null;
    const pay = resolveRate(rates, 'PAY', rc);
    const k = coef(s.timeTypeId);
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
        billAmountMinor: bill ? amountForSeconds(Math.round(s.durationSeconds * k.bill), bill.amountMinor) : 0,
        payAmountMinor: pay ? amountForSeconds(Math.round(s.durationSeconds * k.pay), pay.amountMinor) : 0,
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
    const [paid] = await x.tx.select({ id: billingEntries.id }).from(billingEntries).where(and(eq(billingEntries.timesheetId, ts.id), isNull(billingEntries.voidedAt), sql`${billingEntries.payrollLineId} is not null`)).limit(1);
    if (paid) throw businessRule('timesheet_paid', 'This time has been paid in a finalized payroll, so the timesheet can no longer be reopened. Correct it with an adjustment on the next payroll.');
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

type ApprovalQuery = { status?: string; search?: string };

/** Timesheets in the queue the person may decide on (never their own, unless they own the organization). */
function approvalWhere(x: Ctx, q: ApprovalQuery) {
  const visible = narrowMemberships(x.actor, 'timesheets:approve');
  const term = q.search ? likePattern(q.search) : null;
  return and(
    eq(timesheets.status, (q.status ?? 'SUBMITTED') as TimesheetStatus),
    visible === 'all' ? undefined : inArray(timesheets.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    x.actor.isOwner ? undefined : ne(timesheets.membershipId, x.actor.membershipId),
    term ? inArray(timesheets.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))) : undefined,
  );
}

const approvalOrder = [desc(timesheets.periodStart), asc(timesheets.submittedAt), asc(timesheets.id)];

/** The approval queue as a plain array, capped at 500; use `pageApprovalQueue` to reach every timesheet. */
export async function approvalQueue(x: Ctx, q: ApprovalQuery): Promise<ApprovalQueueItemDto[]> {
  if (!x.actor.grants['timesheets:approve']) throw forbidden();
  const rows = await x.tx.select().from(timesheets).where(approvalWhere(x, q)).orderBy(...approvalOrder).limit(500);
  return toApprovalItems(x, rows);
}

/** One numbered page of the approval queue (`page` is 1-based) and the total. */
export async function pageApprovalQueue(x: Ctx, q: ApprovalQuery & { page: number; pageSize: number }): Promise<OffsetPage<ApprovalQueueItemDto>> {
  if (!x.actor.grants['timesheets:approve']) throw forbidden();
  const where = approvalWhere(x, q);
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(timesheets).where(where);
  const rows = await x.tx.select().from(timesheets).where(where).orderBy(...approvalOrder).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  return { data: await toApprovalItems(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toApprovalItems(x: Ctx, rows: Array<typeof timesheets.$inferSelect>): Promise<ApprovalQueueItemDto[]> {
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

