import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  holidays,
  memberships,
  shifts,
  timeEntries,
  timeOffLedger,
  timeOffPolicies,
  timeOffPolicyMembers,
  timeOffRequests,
  workSchedules,
  workerProfiles,
  type Tx,
} from '@tallywork/db';
import {
  accrualCredit,
  businessRule,
  can,
  classifyAttendance,
  dayOfWeek,
  eachDate,
  forbidden,
  ledgerBalance,
  localDate,
  newId,
  notFound,
  requestedHours,
  validation,
  zonedWallTimeToUtc,
  type AccrualPolicy,
  type AttendanceStatus,
} from '@tallywork/domain';
import type { holidayInput, scheduleInput, timeOffAdjustInput, timeOffPolicyInput, timeOffRequestInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { narrowMemberships } from './scope';
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
    // A new schedule ends the previous open-ended one.
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

export async function listTimeOffRequests(x: Ctx, q: { status?: string; from?: string; to?: string; membershipIds?: string[] }) {
  const visible = narrowMemberships(x.actor, 'time_off:read', q.membershipIds);
  const rows = await x.tx
    .select({ r: timeOffRequests, policyName: timeOffPolicies.name })
    .from(timeOffRequests)
    .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
    .where(
      and(
        q.status ? eq(timeOffRequests.status, q.status as 'PENDING') : undefined,
        q.to ? lte(timeOffRequests.startDate, q.to) : undefined,
        q.from ? gte(timeOffRequests.endDate, q.from) : undefined,
        visible === 'all' ? undefined : inArray(timeOffRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    )
    .orderBy(desc(timeOffRequests.startDate))
    .limit(500);
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
  const [r] = await x.tx.select().from(timeOffRequests).where(eq(timeOffRequests.id, id));
  if (!r || !can(x.actor, 'time_off:read', { ownerMembershipId: r.membershipId })) throw notFound('time_off_request');
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

/** Daily job: grant monthly/annual accruals (idempotent per period). */
export async function runAccruals(tx: Tx, deps: Deps, orgId: string, today: string): Promise<number> {
  const ps = await tx.select().from(timeOffPolicies).where(and(isNull(timeOffPolicies.archivedAt), inArray(sql`${timeOffPolicies.accrual}->>'type'`, ['monthly', 'annual'])));
  let credited = 0;
  for (const p of ps) {
    const periodStart = p.accrual.type === 'monthly' ? `${today.slice(0, 8)}01` : `${today.slice(0, 4)}-01-01`;
    if (today !== periodStart) continue;
    const members = p.appliesToAll
      ? (await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.status, 'ACTIVE'))).map((m) => m.id)
      : (await tx.select({ id: timeOffPolicyMembers.membershipId }).from(timeOffPolicyMembers).where(eq(timeOffPolicyMembers.policyId, p.id))).map((m) => m.id);
    for (const m of members) {
      const [already] = await tx.select({ id: timeOffLedger.id }).from(timeOffLedger).where(and(eq(timeOffLedger.policyId, p.id), eq(timeOffLedger.membershipId, m), eq(timeOffLedger.kind, 'ACCRUAL'), eq(timeOffLedger.effectiveDate, periodStart))).limit(1);
      if (already) continue;
      const ledger = await tx.select().from(timeOffLedger).where(and(eq(timeOffLedger.policyId, p.id), eq(timeOffLedger.membershipId, m)));
      const credit = accrualCredit(p.accrual, ledgerBalance(ledger.map((l) => ({ hours: l.hours, kind: l.kind }))));
      if (credit > 0) {
        await tx.insert(timeOffLedger).values({ id: newId(), organizationId: orgId, policyId: p.id, membershipId: m, hours: credit, kind: 'ACCRUAL', effectiveDate: periodStart });
        credited++;
      }
    }
  }
  void deps;
  return credited;
}
