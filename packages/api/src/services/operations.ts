import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  breakTypes,
  holidays,
  memberships,
  users,
  overtimeRuleSets,
  shiftAlerts,
  shifts,
  timeEntries,
  timeSegments,
  trackingSessions,
  timeOffLedger,
  timeOffPolicies,
  timeOffPolicyMembers,
  timeOffRequests,
  workSchedules,
  workerProfiles,
  type Tx,
} from '@tallywork/db';
import {
  DEFAULT_OVERTIME,
  accrualCredit,
  addDaysToDate,
  businessRule,
  carryOverExpiry,
  can,
  classifyAttendance,
  dayOfWeek,
  eachDate,
  forbidden,
  ledgerBalance,
  localDate,
  newId,
  notFound,
  proRataFactor,
  requestedHours,
  splitAtLocalMidnight,
  validation,
  zonedWallTimeToUtc,
  type AccrualPolicy,
  type AttendanceStatus,
  type OvertimeRules,
} from '@tallywork/domain';
import type { OffsetPage, breakTypeInput, holidayInput, overtimeRulesInput, scheduleInput, timeOffAdjustInput, timeOffPolicyInput, timeOffRequestInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { lockWorker } from './tracking';
import { approversFor, notify } from './notify';
import { narrowMemberships } from './scope';
import { likePattern } from '../lib/search';
import { memberNames } from './timer';

// ─── Schedules & shifts ──────────────────────────────────────────────────────
export async function listSchedules(x: Ctx, membershipIds?: string[]) {
  const visible = narrowMemberships(x.actor, 'schedules:read', membershipIds);
  const rows = await x.tx
    .select()
    .from(workSchedules)
    .where(visible === 'all' ? undefined : inArray(workSchedules.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']))
    .orderBy(asc(workSchedules.effectiveFrom));
  const names = await memberNames(x, [...new Set(rows.map((r) => r.membershipId))]);
  return rows.map((r) => ({
    id: r.id,
    membership_id: r.membershipId,
    worker_name: names.get(r.membershipId) ?? '',
    name: r.name,
    timezone: r.timezone,
    days: r.days,
    effective_from: r.effectiveFrom,
    effective_to: r.effectiveTo,
  }));
}

export async function upsertSchedule(x: Ctx, id: string | null, input: z.infer<typeof scheduleInput>) {
  if (!can(x.actor, 'schedules:manage', { ownerMembershipId: input.membership_id })) throw forbidden();
  for (const d of input.days) if (d.end <= d.start) throw validation('Each shift must end after it starts (overnight shifts: split across two days)');
  const values = { membershipId: input.membership_id, name: input.name, timezone: input.timezone, days: input.days, effectiveFrom: input.effective_from, effectiveTo: input.effective_to ?? null };
  let sid = id;
  if (sid) {
    const r = await x.tx.update(workSchedules).set({ ...values, updatedAt: new Date() }).where(eq(workSchedules.id, sid)).returning({ id: workSchedules.id });
    if (!r.length) throw notFound('schedule');
  } else {
    // A new schedule replaces a version starting the same day and ends the previous open-ended one.
    await x.tx.delete(workSchedules).where(and(eq(workSchedules.membershipId, input.membership_id), eq(workSchedules.effectiveFrom, input.effective_from)));
    await x.tx
      .update(workSchedules)
      .set({ effectiveTo: input.effective_from })
      .where(and(eq(workSchedules.membershipId, input.membership_id), isNull(workSchedules.effectiveTo), sql`${workSchedules.effectiveFrom} < ${input.effective_from}`));
    sid = newId();
    await x.tx.insert(workSchedules).values({ id: sid, organizationId: x.org.id, ...values });
  }
  await audit(x, { action: id ? 'schedule.updated' : 'schedule.created', targetType: 'schedule', targetId: sid, after: input });
  return (await listSchedules(x, [input.membership_id])).find((s) => s.id === sid)!;
}

export async function deleteSchedule(x: Ctx, id: string) {
  const [s] = await x.tx.select().from(workSchedules).where(eq(workSchedules.id, id));
  if (!s) throw notFound('schedule');
  if (!can(x.actor, 'schedules:manage', { ownerMembershipId: s.membershipId })) throw forbidden();
  await x.tx.delete(workSchedules).where(eq(workSchedules.id, id));
  await audit(x, { action: 'schedule.deleted', targetType: 'schedule', targetId: id, before: s });
}

export interface ShiftInstance {
  membership_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  kind: 'SCHEDULED' | 'ONE_OFF';
}

/** Expected shifts for workers in [from, to] (schedules + one-off shifts − cancellations). */
export async function computeShifts(tx: Tx, membershipIds: string[], from: string, to: string): Promise<ShiftInstance[]> {
  if (!membershipIds.length) return [];
  const scheds = await tx
    .select()
    .from(workSchedules)
    .where(and(inArray(workSchedules.membershipId, membershipIds), lte(workSchedules.effectiveFrom, to), or(isNull(workSchedules.effectiveTo), gte(workSchedules.effectiveTo, from))));
  const overrides = await tx.select().from(shifts).where(and(inArray(shifts.membershipId, membershipIds), gte(shifts.localDate, from), lte(shifts.localDate, to)));
  const out: ShiftInstance[] = [];
  for (const date of eachDate(from, to)) {
    const dow = dayOfWeek(date);
    for (const m of membershipIds) {
      const cancelled = overrides.some((o) => o.membershipId === m && o.localDate === date && o.kind === 'CANCELLED');
      if (!cancelled) {
        const s = scheds.find((sc) => sc.membershipId === m && sc.effectiveFrom <= date && (!sc.effectiveTo || date < sc.effectiveTo));
        for (const d of s?.days.filter((dd) => dd.dow === dow) ?? []) {
          const [sh, sm] = d.start.split(':').map(Number) as [number, number];
          const [eh, em] = d.end.split(':').map(Number) as [number, number];
          out.push({ membership_id: m, date, starts_at: zonedWallTimeToUtc(date, s!.timezone, sh, sm).toISOString(), ends_at: zonedWallTimeToUtc(date, s!.timezone, eh, em).toISOString(), kind: 'SCHEDULED' });
        }
      }
      for (const o of overrides.filter((oo) => oo.membershipId === m && oo.localDate === date && oo.kind === 'ONE_OFF')) {
        out.push({ membership_id: m, date, starts_at: o.startsAt.toISOString(), ends_at: o.endsAt.toISOString(), kind: 'ONE_OFF' });
      }
    }
  }
  return out;
}

export async function listShifts(x: Ctx, from: string, to: string, membershipIds?: string[]) {
  const visible = narrowMemberships(x.actor, 'schedules:read', membershipIds);
  const ids = visible === 'all' ? (await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.status, 'ACTIVE'))).map((r) => r.id) : visible;
  return computeShifts(x.tx, ids, from, to);
}

// ─── Attendance (derived, independent of activity) ───────────────────────────
export interface AttendanceRow {
  membership_id: string;
  worker_name: string;
  date: string;
  status: AttendanceStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  first_in: string | null;
  last_out: string | null;
  worked_seconds: number;
  scheduled_seconds: number;
  late_seconds: number;
  early_leave_seconds: number;
  overtime_seconds: number;
}

export async function computeAttendance(tx: Tx, orgId: string, lateGraceMinutes: number, membershipIds: string[], from: string, to: string, now: Date): Promise<Omit<AttendanceRow, 'worker_name'>[]> {
  if (!membershipIds.length) return [];
  const shiftList = await computeShifts(tx, membershipIds, from, to);
  const entries = await tx
    .select({ m: timeEntries.membershipId, d: timeEntries.localDate, s: timeEntries.startedAt, e: timeEntries.endedAt, dur: timeEntries.durationSeconds })
    .from(timeEntries)
    .where(and(inArray(timeEntries.membershipId, membershipIds), isNull(timeEntries.deletedAt), gte(timeEntries.localDate, from), lte(timeEntries.localDate, to)));
  const leave = await tx
    .select()
    .from(timeOffRequests)
    .where(and(inArray(timeOffRequests.membershipId, membershipIds), eq(timeOffRequests.status, 'APPROVED'), lte(timeOffRequests.startDate, to), gte(timeOffRequests.endDate, from)));
  const hols = new Set((await tx.select({ d: holidays.date }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to)))).map((h) => h.d));
  // Time entries only exist once a work segment closes, so a timer running right now counts too.
  const running = await tx
    .select({ m: timeSegments.membershipId, start: timeSegments.startedAt, tz: trackingSessions.timezone })
    .from(timeSegments)
    .innerJoin(trackingSessions, eq(trackingSessions.id, timeSegments.sessionId))
    .where(and(inArray(timeSegments.membershipId, membershipIds), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'WORK')));
  for (const r of running) {
    if (now <= r.start) continue;
    for (const pc of splitAtLocalMidnight({ start: r.start, end: now }, r.tz)) {
      if (pc.localDate >= from && pc.localDate <= to) entries.push({ m: r.m, d: pc.localDate, s: pc.start, e: pc.end, dur: Math.round((pc.end.getTime() - pc.start.getTime()) / 1000) });
    }
  }
  const out: Omit<AttendanceRow, 'worker_name'>[] = [];
  for (const m of membershipIds) {
    for (const date of eachDate(from, to)) {
      const dayShifts = shiftList.filter((s) => s.membership_id === m && s.date === date);
      const dayEntries = entries.filter((e) => e.m === m && e.d === date);
      const scheduledStart = dayShifts.length ? new Date(Math.min(...dayShifts.map((s) => Date.parse(s.starts_at)))) : null;
      const scheduledEnd = dayShifts.length ? new Date(Math.max(...dayShifts.map((s) => Date.parse(s.ends_at)))) : null;
      const firstIn = dayEntries.length ? new Date(Math.min(...dayEntries.map((e) => e.s.getTime()))) : null;
      const lastOut = dayEntries.length ? new Date(Math.max(...dayEntries.map((e) => e.e.getTime()))) : null;
      const worked = dayEntries.reduce((s, e) => s + e.dur, 0);
      const r = classifyAttendance({
        scheduledStart,
        scheduledEnd,
        firstIn,
        lastOut,
        workedSeconds: worked,
        onLeave: leave.some((l) => l.membershipId === m && l.startDate <= date && l.endDate >= date),
        isHoliday: hols.has(date),
        lateGraceMinutes,
        now,
      });
      if (r.status === 'UNSCHEDULED' && !firstIn) continue;
      out.push({
        membership_id: m,
        date,
        status: r.status,
        scheduled_start: scheduledStart?.toISOString() ?? null,
        scheduled_end: scheduledEnd?.toISOString() ?? null,
        first_in: firstIn?.toISOString() ?? null,
        last_out: lastOut?.toISOString() ?? null,
        worked_seconds: worked,
        scheduled_seconds: Math.round(r.scheduledSeconds),
        late_seconds: r.lateSeconds,
        early_leave_seconds: r.earlyLeaveSeconds,
        overtime_seconds: Math.round(r.overtimeSeconds),
      });
    }
  }
  void orgId;
  return out;
}

export async function listAttendance(x: Ctx, from: string, to: string, membershipIds?: string[]): Promise<AttendanceRow[]> {
  const visible = narrowMemberships(x.actor, 'attendance:read', membershipIds);
  const ids =
    visible === 'all'
      ? (await x.tx.select({ id: memberships.id }).from(memberships).innerJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id)).where(and(eq(memberships.status, 'ACTIVE'), eq(workerProfiles.trackingEnabled, true)))).map((r) => r.id)
      : visible;
  const rows = await computeAttendance(x.tx, x.org.id, x.org.settings.lateGraceMinutes, ids, from, to, x.deps.now());
  const names = await memberNames(x, ids);
  return rows.map((r) => ({ ...r, worker_name: names.get(r.membership_id) ?? '' })).sort((a, b) => (a.date === b.date ? a.worker_name.localeCompare(b.worker_name) : a.date < b.date ? 1 : -1));
}

/**
 * One numbered page of attendance rows (`page` is 1-based), filtered by status and member name,
 * plus counts per status and the overtime over every row. Attendance is computed for everyone in
 * the range (in a few batched queries) so the totals are complete; only one page is sent.
 * Each row carries the member's time zone, so the page needs no separate member list.
 */
export async function pageAttendance(
  x: Ctx,
  q: { from: string; to: string; membershipIds?: string[]; status?: string; search?: string; page: number; pageSize: number },
): Promise<OffsetPage<AttendanceRow & { timezone: string }> & { summary: { counts: Record<string, number>; overtime_seconds: number } }> {
  const all = await listAttendance(x, q.from, q.to, q.membershipIds);
  const term = q.search?.toLowerCase();
  const searched = term ? all.filter((r) => r.worker_name.toLowerCase().includes(term)) : all;
  const counts: Record<string, number> = { ALL: searched.length };
  for (const r of searched) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const matching = q.status ? searched.filter((r) => r.status === q.status) : searched;
  const rows = matching.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const ids = [...new Set(rows.map((r) => r.membership_id))];
  const tz = new Map(
    ids.length ? (await x.tx.select({ id: workerProfiles.membershipId, tz: workerProfiles.timezone }).from(workerProfiles).where(inArray(workerProfiles.membershipId, ids))).map((p) => [p.id, p.tz]) : [],
  );
  return {
    data: rows.map((r) => ({ ...r, timezone: tz.get(r.membership_id) || x.org.timezone })),
    total: matching.length,
    page: q.page,
    page_size: q.pageSize,
    summary: { counts, overtime_seconds: searched.reduce((s, r) => s + r.overtime_seconds, 0) },
  };
}

// ─── Holidays ────────────────────────────────────────────────────────────────
export async function listHolidays(x: Ctx, year?: number) {
  const rows = await x.tx
    .select()
    .from(holidays)
    .where(year ? sql`${holidays.date} like ${`${year}-%`}` : undefined)
    .orderBy(asc(holidays.date));
  return rows.map((h) => ({ id: h.id, date: h.date, name: h.name, paid: h.paid }));
}

export async function addHoliday(x: Ctx, input: z.infer<typeof holidayInput>) {
  if (!x.actor.grants['time_off:manage']) throw forbidden();
  const id = newId();
  await x.tx.insert(holidays).values({ id, organizationId: x.org.id, date: input.date, name: input.name, paid: input.paid }).onConflictDoUpdate({ target: [holidays.organizationId, holidays.date], set: { name: input.name, paid: input.paid } });
  await audit(x, { action: 'holiday.set', targetType: 'holiday', targetId: input.date, after: input });
  return listHolidays(x);
}

export async function deleteHoliday(x: Ctx, id: string) {
  if (!x.actor.grants['time_off:manage']) throw forbidden();
  await x.tx.delete(holidays).where(eq(holidays.id, id));
  await audit(x, { action: 'holiday.deleted', targetType: 'holiday', targetId: id });
}

// ─── Time off ────────────────────────────────────────────────────────────────
export async function listTimeOffPolicies(x: Ctx) {
  if (!x.actor.grants['time_off:read']) throw forbidden();
  const ps = await x.tx.select().from(timeOffPolicies).where(isNull(timeOffPolicies.archivedAt)).orderBy(asc(timeOffPolicies.name));
  const mem = ps.length ? await x.tx.select().from(timeOffPolicyMembers).where(inArray(timeOffPolicyMembers.policyId, ps.map((p) => p.id))) : [];
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    paid: p.paid,
    accrual: p.accrual,
    requires_approval: p.requiresApproval,
    hours_per_day: p.hoursPerDay,
    applies_to_all: p.appliesToAll,
    member_ids: mem.filter((m) => m.policyId === p.id).map((m) => m.membershipId),
  }));
}

export async function upsertTimeOffPolicy(x: Ctx, id: string | null, input: z.infer<typeof timeOffPolicyInput>) {
  if (!x.actor.grants['time_off:manage']) throw forbidden();
  const values = { name: input.name, paid: input.paid, requiresApproval: input.requires_approval, hoursPerDay: input.hours_per_day, accrual: input.accrual as AccrualPolicy, appliesToAll: input.applies_to_all };
  let pid = id;
  if (pid) {
    const r = await x.tx.update(timeOffPolicies).set({ ...values, updatedAt: new Date() }).where(eq(timeOffPolicies.id, pid)).returning({ id: timeOffPolicies.id });
    if (!r.length) throw notFound('time_off_policy');
  } else {
    pid = newId();
    await x.tx.insert(timeOffPolicies).values({ id: pid, organizationId: x.org.id, ...values });
  }
  if (input.member_ids) {
    await x.tx.delete(timeOffPolicyMembers).where(eq(timeOffPolicyMembers.policyId, pid));
    if (input.member_ids.length) await x.tx.insert(timeOffPolicyMembers).values(input.member_ids.map((m) => ({ organizationId: x.org.id, policyId: pid!, membershipId: m })));
  }
  await audit(x, { action: id ? 'time_off_policy.updated' : 'time_off_policy.created', targetType: 'time_off_policy', targetId: pid, after: input });
  return (await listTimeOffPolicies(x)).find((p) => p.id === pid)!;
}

async function policiesForMember(tx: Tx, membershipId: string) {
  const ps = await tx.select().from(timeOffPolicies).where(isNull(timeOffPolicies.archivedAt));
  const mem = await tx.select().from(timeOffPolicyMembers).where(eq(timeOffPolicyMembers.membershipId, membershipId));
  return ps.filter((p) => p.appliesToAll || mem.some((m) => m.policyId === p.id));
}

export async function balances(x: Ctx, membershipId: string) {
  if (!can(x.actor, 'time_off:read', { ownerMembershipId: membershipId })) throw notFound('worker');
  const ps = await policiesForMember(x.tx, membershipId);
  const ledger = await x.tx.select().from(timeOffLedger).where(eq(timeOffLedger.membershipId, membershipId));
  const pending = await x.tx.select().from(timeOffRequests).where(and(eq(timeOffRequests.membershipId, membershipId), eq(timeOffRequests.status, 'PENDING')));
  return ps.map((p) => ({
    policy_id: p.id,
    policy_name: p.name,
    paid: p.paid,
    balance_hours: p.accrual.type === 'none' ? null : ledgerBalance(ledger.filter((l) => l.policyId === p.id).map((l) => ({ hours: l.hours, kind: l.kind }))),
    pending_hours: pending.filter((r) => r.policyId === p.id).reduce((s, r) => s + r.hours, 0),
    used_hours: -ledger.filter((l) => l.policyId === p.id && (l.kind === 'REQUEST' || l.kind === 'REVERSAL')).reduce((s, l) => s + l.hours, 0),
  }));
}

type TimeOffQuery = { status?: string; from?: string; to?: string; membershipIds?: string[]; search?: string };

/** Time-off requests the person may see that overlap [from..to]; `search` covers the member, policy and reason. */
function timeOffWhere(x: Ctx, q: TimeOffQuery) {
  const visible = narrowMemberships(x.actor, 'time_off:read', q.membershipIds);
  const term = q.search ? likePattern(q.search) : null;
  return and(
    q.status ? eq(timeOffRequests.status, q.status as 'PENDING') : undefined,
    q.to ? lte(timeOffRequests.startDate, q.to) : undefined,
    q.from ? gte(timeOffRequests.endDate, q.from) : undefined,
    visible === 'all' ? undefined : inArray(timeOffRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    term
      ? or(
          ilike(timeOffPolicies.name, term),
          ilike(timeOffRequests.reason, term),
          inArray(timeOffRequests.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))),
        )
      : undefined,
  );
}

const timeOffOrder = [desc(timeOffRequests.startDate), desc(timeOffRequests.id)];

/** Time-off requests as a plain array, latest first, capped at 500; use `pageTimeOffRequests` to reach every request. */
export async function listTimeOffRequests(x: Ctx, q: TimeOffQuery) {
  const rows = await x.tx
    .select({ r: timeOffRequests, policyName: timeOffPolicies.name })
    .from(timeOffRequests)
    .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
    .where(timeOffWhere(x, q))
    .orderBy(...timeOffOrder)
    .limit(500);
  return toTimeOffRows(x, rows);
}

/** One numbered page of time-off requests (`page` is 1-based) and the total. */
export async function pageTimeOffRequests(x: Ctx, q: TimeOffQuery & { page: number; pageSize: number }): Promise<OffsetPage<Awaited<ReturnType<typeof toTimeOffRows>>[number]>> {
  const where = timeOffWhere(x, q);
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(timeOffRequests).innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId)).where(where);
  const rows = await x.tx
    .select({ r: timeOffRequests, policyName: timeOffPolicies.name })
    .from(timeOffRequests)
    .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
    .where(where)
    .orderBy(...timeOffOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: await toTimeOffRows(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toTimeOffRows(x: Ctx, rows: Array<{ r: typeof timeOffRequests.$inferSelect; policyName: string }>) {
  const names = await memberNames(x, [...new Set(rows.flatMap((r) => [r.r.membershipId, ...(r.r.decidedBy ? [r.r.decidedBy] : [])]))]);
  return rows.map(({ r, policyName }) => ({
    id: r.id,
    membership_id: r.membershipId,
    worker_name: names.get(r.membershipId) ?? '',
    policy_id: r.policyId,
    policy_name: policyName,
    start_date: r.startDate,
    end_date: r.endDate,
    half_day: r.halfDay,
    hours: r.hours,
    reason: r.reason,
    status: r.status,
    decided_by_name: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
    decided_at: r.decidedAt?.toISOString() ?? null,
    decision_comment: r.decisionComment,
    created_at: r.createdAt.toISOString(),
  }));
}

async function approveRequestLedger(tx: Tx, orgId: string, r: typeof timeOffRequests.$inferSelect, actorId: string) {
  await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: r.policyId, membershipId: r.membershipId, hours: -r.hours, kind: 'REQUEST', requestId: r.id, effectiveDate: r.startDate, createdBy: actorId });
}

export async function requestTimeOff(x: Ctx, input: z.infer<typeof timeOffRequestInput>) {
  if (!x.actor.grants['time_off:request']) throw forbidden();
  if (input.end_date < input.start_date) throw validation('End date must be on or after the start date');
  // Two requests sent at once must not both pass the overlap and balance checks.
  await lockWorker(x.tx, x.actor.membershipId);
  const ps = await policiesForMember(x.tx, x.actor.membershipId);
  const p = ps.find((pp) => pp.id === input.policy_id);
  if (!p) throw notFound('time_off_policy');
  const hols = new Set((await x.tx.select({ d: holidays.date }).from(holidays)).map((h) => h.d));
  const dates = eachDate(input.start_date, input.end_date);
  if (dates.length > 366) throw validation('Requests are limited to one year');
  const shiftsForMe = await computeShifts(x.tx, [x.actor.membershipId], input.start_date, input.end_date);
  const hasSchedule = shiftsForMe.length > 0;
  const isNonWorking = (d: string) => hols.has(d) || (hasSchedule ? !shiftsForMe.some((s) => s.date === d) : [0, 6].includes(dayOfWeek(d)));
  const hours = requestedHours(dates, isNonWorking, p.hoursPerDay, input.half_day);
  if (hours <= 0) throw businessRule('no_working_days', 'The selected dates contain no working days');
  const overlap = await x.tx
    .select({ id: timeOffRequests.id })
    .from(timeOffRequests)
    .where(and(eq(timeOffRequests.membershipId, x.actor.membershipId), inArray(timeOffRequests.status, ['PENDING', 'APPROVED']), lte(timeOffRequests.startDate, input.end_date), gte(timeOffRequests.endDate, input.start_date)))
    .limit(1);
  if (overlap.length) throw businessRule('time_off_overlap', 'You already have time off requested for these dates');
  if (p.accrual.type !== 'none') {
    const bal = (await balances(x, x.actor.membershipId)).find((b) => b.policy_id === p.id);
    if (bal && bal.balance_hours !== null && bal.balance_hours - bal.pending_hours < hours) throw businessRule('insufficient_balance', `Not enough balance (${bal.balance_hours - bal.pending_hours}h available)`);
  }
  const id = newId();
  const auto = !p.requiresApproval;
  const [r] = await x.tx
    .insert(timeOffRequests)
    .values({ id, organizationId: x.org.id, policyId: p.id, membershipId: x.actor.membershipId, startDate: input.start_date, endDate: input.end_date, halfDay: input.half_day, hours, reason: input.reason ?? null, status: auto ? 'APPROVED' : 'PENDING', decidedAt: auto ? new Date() : null })
    .returning();
  if (auto) await approveRequestLedger(x.tx, x.org.id, r!, x.actor.membershipId);
  else await emitFrom(x, 'time_off.requested', { request_id: id, membership_id: x.actor.membershipId, start_date: input.start_date, end_date: input.end_date, hours }, { workerId: x.actor.membershipId });
  await audit(x, { action: 'time_off.requested', targetType: 'time_off_request', targetId: id, after: { ...input, hours } });
  return (await listTimeOffRequests(x, { membershipIds: [x.actor.membershipId] })).find((q) => q.id === id)!;
}

export async function decideTimeOff(x: Ctx, id: string, action: 'APPROVE' | 'REJECT' | 'CANCEL', comment: string | null) {
  const [found] = await x.tx.select().from(timeOffRequests).where(eq(timeOffRequests.id, id));
  if (!found || !can(x.actor, 'time_off:read', { ownerMembershipId: found.membershipId })) throw notFound('time_off_request');
  // One decision at a time per person, then read again: a second approve or cancel must see the first.
  await lockWorker(x.tx, found.membershipId);
  const [r] = (await x.tx.select().from(timeOffRequests).where(eq(timeOffRequests.id, id))) as [typeof found];
  const own = r.membershipId === x.actor.membershipId;
  if (action === 'CANCEL') {
    if (!own && !can(x.actor, 'time_off:approve', { ownerMembershipId: r.membershipId })) throw forbidden();
    if (r.status === 'CANCELLED' || r.status === 'REJECTED') throw businessRule('already_closed', 'This request is already closed');
    if (r.status === 'APPROVED') {
      await x.tx.insert(timeOffLedger).values({ id: newId(), organizationId: x.org.id, policyId: r.policyId, membershipId: r.membershipId, hours: r.hours, kind: 'REVERSAL', requestId: r.id, effectiveDate: r.startDate, createdBy: x.actor.membershipId });
    }
  } else {
    if (own || !can(x.actor, 'time_off:approve', { ownerMembershipId: r.membershipId })) throw forbidden();
    if (r.status !== 'PENDING') throw businessRule('already_decided', 'This request has already been decided');
    if (action === 'APPROVE') await approveRequestLedger(x.tx, x.org.id, r, x.actor.membershipId);
  }
  const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CANCELLED';
  await x.tx.update(timeOffRequests).set({ status, decidedBy: x.actor.membershipId, decidedAt: new Date(), decisionComment: comment, updatedAt: new Date() }).where(eq(timeOffRequests.id, id));
  await emitFrom(x, `time_off.${status.toLowerCase()}`, { request_id: id, membership_id: r.membershipId }, { workerId: r.membershipId });
  await audit(x, { action: `time_off.${status.toLowerCase()}`, targetType: 'time_off_request', targetId: id, metadata: { comment } });
}

export async function adjustBalance(x: Ctx, input: z.infer<typeof timeOffAdjustInput>) {
  if (!x.actor.grants['time_off:manage']) throw forbidden();
  await x.tx.insert(timeOffLedger).values({ id: newId(), organizationId: x.org.id, policyId: input.policy_id, membershipId: input.membership_id, hours: input.hours, kind: 'ADJUSTMENT', note: input.note ?? null, effectiveDate: localDate(new Date(), x.org.timezone), createdBy: x.actor.membershipId });
  await audit(x, { action: 'time_off.balance_adjusted', targetType: 'membership', targetId: input.membership_id, after: input });
  return balances(x, input.membership_id);
}

/** Members a policy applies to, with the date they joined (profile start date, else membership creation). */
async function policyMembers(tx: Tx, p: typeof timeOffPolicies.$inferSelect, tz: string) {
  const rows = await tx
    .select({ id: memberships.id, createdAt: memberships.createdAt, startDate: workerProfiles.startDate })
    .from(memberships)
    .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .where(eq(memberships.status, 'ACTIVE'));
  const allowed = p.appliesToAll ? null : new Set((await tx.select({ id: timeOffPolicyMembers.membershipId }).from(timeOffPolicyMembers).where(eq(timeOffPolicyMembers.policyId, p.id))).map((m) => m.id));
  return rows.filter((r) => !allowed || allowed.has(r.id)).map((r) => ({ id: r.id, joinedOn: r.startDate ?? localDate(r.createdAt, tz) }));
}

async function ledgerOf(tx: Tx, policyId: string, membershipId: string) {
  const rows = await tx.select().from(timeOffLedger).where(and(eq(timeOffLedger.policyId, policyId), eq(timeOffLedger.membershipId, membershipId)));
  return { rows, balance: ledgerBalance(rows.map((l) => ({ hours: l.hours, kind: l.kind }))) };
}

/**
 * Daily job. Idempotent per period, and catches up if a run was missed:
 * - at the start of each year, balances above the carry-over cap expire (CARRYOVER_EXPIRY)
 * - monthly/annual policies credit once per period; members who joined mid-period get a pro-rata share
 */
export async function runAccruals(tx: Tx, deps: Deps, orgId: string, today: string, tz = 'UTC'): Promise<number> {
  const ps = await tx.select().from(timeOffPolicies).where(isNull(timeOffPolicies.archivedAt));
  const yearStart = `${today.slice(0, 4)}-01-01`;
  let written = 0;
  for (const p of ps) {
    if (p.accrual.type === 'none') continue;
    const periodic = p.accrual.type === 'monthly' || p.accrual.type === 'annual';
    const periodStart = p.accrual.type === 'monthly' ? `${today.slice(0, 8)}01` : yearStart;
    const periodEnd = p.accrual.type === 'monthly' ? addDaysToDate(`${addDaysToDate(periodStart, 32).slice(0, 8)}01`, -1) : `${today.slice(0, 4)}-12-31`;
    for (const m of await policyMembers(tx, p, tz)) {
      let { rows, balance } = await ledgerOf(tx, p.id, m.id);
      // Carry-over first, so this year's credit is not what expires.
      if (p.accrual.carryOverHours !== null && m.joinedOn < yearStart && !rows.some((l) => l.kind === 'CARRYOVER_EXPIRY' && l.effectiveDate === yearStart)) {
        const prior = ledgerBalance(rows.filter((l) => l.effectiveDate < yearStart).map((l) => ({ hours: l.hours, kind: l.kind })));
        const expire = carryOverExpiry(prior, p.accrual.carryOverHours);
        if (expire > 0) {
          await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: p.id, membershipId: m.id, hours: -expire, kind: 'CARRYOVER_EXPIRY', note: `Above the ${p.accrual.carryOverHours}h carry-over limit`, effectiveDate: yearStart });
          balance -= expire;
          written++;
        }
      }
      if (!periodic || m.joinedOn > today) continue;
      if (rows.some((l) => l.kind === 'ACCRUAL' && l.effectiveDate === periodStart && !l.requestId)) continue;
      const factor = proRataFactor(periodStart, periodEnd, m.joinedOn);
      const credit = Math.round(accrualCredit({ ...p.accrual, maxBalanceHours: null }, balance) * factor * 100) / 100;
      const capped = p.accrual.maxBalanceHours === null ? credit : Math.max(0, Math.min(credit, p.accrual.maxBalanceHours - balance));
      if (capped > 0) {
        await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: p.id, membershipId: m.id, hours: Math.round(capped * 100) / 100, kind: 'ACCRUAL', note: factor < 1 ? `Pro-rata (${Math.round(factor * 100)}%)` : null, effectiveDate: periodStart });
        written++;
      }
    }
  }
  void deps;
  return written;
}

/**
 * Per-hour-worked accrual on timesheet approval (credited once per timesheet), and its
 * reversal when the timesheet is reopened. The ledger row references the timesheet id.
 */
export async function accrueForTimesheet(tx: Tx, orgId: string, t: { id: string; membershipId: string; periodEnd: string; totalSeconds: number }, action: 'APPROVE' | 'REOPEN') {
  const ps = (await policiesForMember(tx, t.membershipId)).filter((p) => p.accrual.type === 'per_hour_worked');
  for (const p of ps) {
    const { rows, balance } = await ledgerOf(tx, p.id, t.membershipId);
    const net = Math.round(rows.filter((l) => l.requestId === t.id).reduce((sum, l) => sum + l.hours, 0) * 100) / 100;
    if (action === 'REOPEN') {
      if (net > 0) await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: p.id, membershipId: t.membershipId, hours: -net, kind: 'REVERSAL', requestId: t.id, note: 'Timesheet reopened', effectiveDate: t.periodEnd });
      continue;
    }
    if (net > 0) continue;
    const credit = accrualCredit(p.accrual, balance, t.totalSeconds / 3600);
    if (credit > 0) await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: p.id, membershipId: t.membershipId, hours: credit, kind: 'ACCRUAL', requestId: t.id, note: 'Hours worked (approved timesheet)', effectiveDate: t.periodEnd });
  }
}

export async function archiveTimeOffPolicy(x: Ctx, id: string) {
  if (!x.actor.grants['time_off:manage']) throw forbidden();
  const r = await x.tx.update(timeOffPolicies).set({ archivedAt: new Date() }).where(eq(timeOffPolicies.id, id)).returning({ id: timeOffPolicies.id });
  if (!r.length) throw notFound('time_off_policy');
  await audit(x, { action: 'time_off_policy.archived', targetType: 'time_off_policy', targetId: id });
}

// ─── Break types ─────────────────────────────────────────────────────────────
export async function listBreakTypes(x: Pick<Ctx, 'tx'>) {
  const rows = await x.tx.select().from(breakTypes).where(isNull(breakTypes.archivedAt)).orderBy(asc(breakTypes.name));
  return rows.map((b) => ({ id: b.id, name: b.name, paid: b.paid, max_minutes: b.maxMinutes }));
}

export async function upsertBreakType(x: Ctx, id: string | null, input: z.infer<typeof breakTypeInput>) {
  if (!x.actor.grants['org:update']) throw forbidden();
  const values = { name: input.name, paid: input.paid, maxMinutes: input.max_minutes ?? null };
  let bid = id;
  if (bid) {
    const r = await x.tx.update(breakTypes).set({ ...values, updatedAt: new Date() }).where(and(eq(breakTypes.id, bid), isNull(breakTypes.archivedAt))).returning({ id: breakTypes.id });
    if (!r.length) throw notFound('break_type');
  } else {
    bid = newId();
    await x.tx.insert(breakTypes).values({ id: bid, organizationId: x.org.id, ...values });
  }
  await audit(x, { action: id ? 'break_type.updated' : 'break_type.created', targetType: 'break_type', targetId: bid, after: input });
  return (await listBreakTypes(x)).find((b) => b.id === bid)!;
}

export async function archiveBreakType(x: Ctx, id: string) {
  if (!x.actor.grants['org:update']) throw forbidden();
  const r = await x.tx.update(breakTypes).set({ archivedAt: new Date() }).where(and(eq(breakTypes.id, id), isNull(breakTypes.archivedAt))).returning({ id: breakTypes.id });
  if (!r.length) throw notFound('break_type');
  await audit(x, { action: 'break_type.archived', targetType: 'break_type', targetId: id });
}

/** A break type the worker may use, or a 404 (archived or another organization's). */
export async function assertBreakType(tx: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [b] = await tx.select({ id: breakTypes.id }).from(breakTypes).where(and(eq(breakTypes.id, id), isNull(breakTypes.archivedAt)));
  if (!b) throw notFound('break_type');
  return b.id;
}

/** Tell workers (once per break) when a break runs past its type's maximum. */
export async function alertLongBreaks(tx: Tx, deps: Deps, orgId: string, now: Date): Promise<number> {
  const open = await tx
    .select({ seg: timeSegments, bt: breakTypes })
    .from(timeSegments)
    .innerJoin(breakTypes, eq(breakTypes.id, timeSegments.breakTypeId))
    .where(and(eq(timeSegments.kind, 'BREAK'), isNull(timeSegments.endedAt), isNull(timeSegments.alertedAt), sql`${breakTypes.maxMinutes} is not null`));
  let n = 0;
  for (const { seg, bt } of open) {
    if (now.getTime() - seg.startedAt.getTime() <= bt.maxMinutes! * 60_000) continue;
    await tx.update(timeSegments).set({ alertedAt: now }).where(eq(timeSegments.id, seg.id));
    await notify(tx, deps, orgId, [seg.membershipId], { type: 'break.overrun', title: `Your ${bt.name.toLowerCase()} break is over ${bt.maxMinutes} minutes`, body: 'Resume your timer when you are back.', link: '/', payload: { segment_id: seg.id } });
    n++;
  }
  return n;
}

// ─── Overtime rules ──────────────────────────────────────────────────────────
export async function getOvertimeRules(x: Ctx): Promise<OvertimeRules> {
  const [r] = await x.tx.select().from(overtimeRuleSets);
  return r?.rules ?? DEFAULT_OVERTIME;
}

export async function setOvertimeRules(x: Ctx, input: z.infer<typeof overtimeRulesInput>): Promise<OvertimeRules> {
  if (!x.actor.grants['org:update']) throw forbidden();
  const before = await getOvertimeRules(x);
  const rules: OvertimeRules = { dailyThresholdSeconds: input.daily_threshold_seconds, weeklyThresholdSeconds: input.weekly_threshold_seconds };
  await x.tx.insert(overtimeRuleSets).values({ organizationId: x.org.id, rules }).onConflictDoUpdate({ target: overtimeRuleSets.organizationId, set: { rules, updatedAt: new Date() } });
  await audit(x, { action: 'overtime_rules.updated', targetType: 'organization', targetId: x.org.id, before, after: rules });
  return rules;
}

// ─── Shift alerts & reminders ────────────────────────────────────────────────
/**
 * Every minute: when a scheduled shift started more than the grace period ago and the worker
 * has not started tracking (and is not on leave or a holiday), tell the worker and their
 * managers, once per shift. Only shifts that started within the last two hours are checked.
 */
export async function runShiftAlerts(tx: Tx, deps: Deps, orgId: string, tz: string, graceMinutes: number, now: Date): Promise<number> {
  const today = localDate(now, tz);
  const members = (await tx.select({ id: memberships.id }).from(memberships).innerJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id)).where(and(eq(memberships.status, 'ACTIVE'), eq(workerProfiles.trackingEnabled, true)))).map((m) => m.id);
  if (!members.length) return 0;
  const from = addDaysToDate(today, -1);
  const due = (await computeShifts(tx, members, from, today)).filter((sh) => {
    const late = now.getTime() - Date.parse(sh.starts_at);
    return late > graceMinutes * 60_000 && late < 2 * 3600_000 && now.getTime() < Date.parse(sh.ends_at);
  });
  if (!due.length) return 0;
  const rows = await computeAttendance(tx, orgId, graceMinutes, [...new Set(due.map((d) => d.membership_id))], from, today, now);
  let sent = 0;
  for (const sh of due) {
    const a = rows.find((r) => r.membership_id === sh.membership_id && r.date === sh.date);
    if (a && a.status !== 'ABSENT') continue; // tracking started, on leave, or a holiday
    const inserted = await tx.insert(shiftAlerts).values({ id: newId(), organizationId: orgId, membershipId: sh.membership_id, shiftStart: new Date(sh.starts_at), kind: 'NOT_STARTED' }).onConflictDoNothing().returning({ id: shiftAlerts.id });
    if (!inserted.length) continue;
    const name = (await memberNames({ tx }, [sh.membership_id])).get(sh.membership_id);
    const at = new Date(sh.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    await notify(tx, deps, orgId, [sh.membership_id], { type: 'shift.not_started', title: `Your shift started at ${at}`, body: 'Start your timer, or ask your manager to update your schedule.', link: '/' });
    const managers = (await approversFor(tx, orgId, sh.membership_id, 'attendance:read')).filter((id) => id !== sh.membership_id);
    await notify(tx, deps, orgId, managers, { type: 'shift.not_started', title: `${name ?? 'A team member'} has not started their ${at} shift`, link: '/attendance', payload: { membership_id: sh.membership_id, shift_start: sh.starts_at } });
    sent++;
  }
  return sent;
}

/** The worker's current or next shift today/tomorrow, for desktop reminders. */
export async function nextShift(tx: Tx, membershipId: string, tz: string, now: Date): Promise<{ starts_at: string; ends_at: string } | null> {
  const today = localDate(now, tz);
  const list = await computeShifts(tx, [membershipId], today, addDaysToDate(today, 1));
  const s = list.filter((sh) => Date.parse(sh.ends_at) > now.getTime()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  return s ? { starts_at: s.starts_at, ends_at: s.ends_at } : null;
}
