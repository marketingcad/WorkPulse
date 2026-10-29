import { and, asc, desc, eq, gte, inArray, isNull, lte, min, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  billingEntries,
  billingRates,
  holidays,
  memberships,
  overtimeRuleSets,
  payrollProfileMembers,
  payrollProfiles,
  payrollRunLines,
  payrollRuns,
  rollupWorkerDay,
  timeOffPolicies,
  timeOffRequests,
  users,
  type PayAdjustment,
} from '@tallywork/db';
import { DEFAULT_OVERTIME, addDaysToDate, amountForSeconds, businessRule, conflict, forbidden, localDate, newId, notFound, periodFor, resolveRate, validation } from '@tallywork/domain';
import { overtimeInRange, paidHolidayHours } from './pay-figures';
import type { BankDetailsDto, PayStubDto, PayrollProfileDto, PayrollRunDto, bankDetailsInput, payAdjustmentsInput, payrollProfileInput, payrollProfilePatchInput, payrollRunInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { loadRates } from './finance';
import { membersWith, notificationEmail, notify } from './notify';
import { timeOffHoursInRange } from './reports';
import { memberNames } from './timer';
import { decrypt, encrypt } from '../lib/crypto';

const BANK_PURPOSE = 'bank-details';
/** Payroll is org-wide: a payroll grant at a narrower scope (from an older custom role) gives nothing. */
const has = (x: Ctx, p: 'payroll:read' | 'payroll:manage') => x.actor.grants[p] === 'org';
const need = (x: Ctx, p: 'payroll:read' | 'payroll:manage') => {
  if (!has(x, p)) throw forbidden();
};

// ─── Profiles ────────────────────────────────────────────────────────────────
function openBank(x: Ctx, enc: string | null): BankDetailsDto | null {
  if (!enc) return null;
  try {
    return JSON.parse(decrypt(x.deps.config.appSecret, enc, BANK_PURPOSE)) as BankDetailsDto;
  } catch {
    return null;
  }
}

export async function listPayrollProfiles(x: Ctx, opts: { includeArchived?: boolean } = {}): Promise<PayrollProfileDto[]> {
  need(x, 'payroll:read');
  const ps = await x.tx.select().from(payrollProfiles).where(opts.includeArchived ? undefined : isNull(payrollProfiles.archivedAt)).orderBy(asc(payrollProfiles.name));
  if (!ps.length) return [];
  const ms = await x.tx.select().from(payrollProfileMembers).where(inArray(payrollProfileMembers.profileId, ps.map((p) => p.id)));
  const names = await memberNames(x, [...new Set(ms.map((m) => m.membershipId))]);
  return ps.map((p) => ({
    id: p.id,
    name: p.name,
    period: p.period,
    currency: p.currency,
    is_default: p.isDefault,
    archived_at: p.archivedAt?.toISOString() ?? null,
    members: ms
      .filter((m) => m.profileId === p.id)
      .map((m) => {
        const b = openBank(x, m.bankDetailsEnc);
        const acct = b?.account_number ?? b?.iban ?? null;
        // Lists only show a summary; the full details come from the bank-details endpoint.
        return { membership_id: m.membershipId, name: names.get(m.membershipId) ?? '', bank: b ? { type: b.type, bank_name: b.bank_name, account_last4: acct ? acct.replace(/\s+/g, '').slice(-4) : null } : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export async function upsertPayrollProfile(x: Ctx, id: string | null, sent: z.infer<typeof payrollProfileInput> | z.infer<typeof payrollProfilePatchInput>) {
  need(x, 'payroll:manage');
  const pid = id ?? newId();
  let existing: typeof payrollProfiles.$inferSelect | undefined;
  let currentIds: string[] = [];
  if (id) {
    [existing] = await x.tx.select().from(payrollProfiles).where(eq(payrollProfiles.id, id));
    if (!existing) throw notFound('payroll_profile');
    currentIds = (await x.tx.select({ m: payrollProfileMembers.membershipId }).from(payrollProfileMembers).where(eq(payrollProfileMembers.profileId, id))).map((r) => r.m);
  }
  // An update changes only what it sends: leaving out `member_ids` keeps the members and their bank details.
  const name = sent.name ?? existing?.name;
  const period = sent.period ?? existing?.period;
  const currency = sent.currency ?? existing?.currency;
  if (!name || !period || !currency) throw validation('Give the pay group a name, a pay period and a currency');
  const input = { name, period, currency, is_default: sent.is_default ?? existing?.isDefault ?? false, member_ids: sent.member_ids ?? currentIds };
  // Only one payroll profile per currency for each member.
  if (input.member_ids.length) {
    const clash = await x.tx
      .select({ m: payrollProfileMembers.membershipId, name: payrollProfiles.name })
      .from(payrollProfileMembers)
      .innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollProfileMembers.profileId))
      .where(and(inArray(payrollProfileMembers.membershipId, input.member_ids), eq(payrollProfiles.currency, input.currency), isNull(payrollProfiles.archivedAt), ne(payrollProfiles.id, pid)));
    if (clash.length) {
      const names = await memberNames(x, [clash[0]!.m]);
      throw businessRule('payroll_profile_currency', `${names.get(clash[0]!.m) ?? 'A member'} is already in ${clash[0]!.name}, which also pays in ${input.currency}. Only one payroll profile per currency is allowed.`);
    }
  }
  const values = { name: input.name, period: input.period, currency: input.currency, isDefault: input.is_default };
  if (id) await x.tx.update(payrollProfiles).set({ ...values, updatedAt: new Date() }).where(eq(payrollProfiles.id, pid));
  else await x.tx.insert(payrollProfiles).values({ id: pid, organizationId: x.org.id, ...values });
  if (values.isDefault) await x.tx.update(payrollProfiles).set({ isDefault: false }).where(and(ne(payrollProfiles.id, pid), eq(payrollProfiles.isDefault, true)));
  // Members: keep bank details of members who stay.
  const keep = new Set(input.member_ids);
  const gone = currentIds.filter((m) => !keep.has(m));
  if (gone.length) await x.tx.delete(payrollProfileMembers).where(and(eq(payrollProfileMembers.profileId, pid), inArray(payrollProfileMembers.membershipId, gone)));
  const added = input.member_ids.filter((m) => !currentIds.includes(m));
  if (added.length) {
    const valid = await x.tx.select({ id: memberships.id }).from(memberships).where(inArray(memberships.id, added));
    if (valid.length !== new Set(added).size) throw notFound('worker');
    await x.tx.insert(payrollProfileMembers).values(added.map((membershipId) => ({ organizationId: x.org.id, profileId: pid, membershipId })));
  }
  await audit(x, { action: id ? 'payroll_profile.updated' : 'payroll_profile.created', targetType: 'payroll_profile', targetId: pid, after: input });
  return (await listPayrollProfiles(x, { includeArchived: true })).find((p) => p.id === pid)!;
}

export async function archivePayrollProfile(x: Ctx, id: string) {
  need(x, 'payroll:manage');
  const r = await x.tx.update(payrollProfiles).set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(eq(payrollProfiles.id, id)).returning({ id: payrollProfiles.id });
  if (!r.length) throw notFound('payroll_profile');
  await audit(x, { action: 'payroll_profile.archived', targetType: 'payroll_profile', targetId: id });
}

/** Bank details: the member themselves, or payroll managers. */
function bankAccess(x: Ctx, membershipId: string) {
  if (membershipId !== x.actor.membershipId && !has(x, 'payroll:manage')) throw forbidden();
}

export async function getBankDetails(x: Ctx, profileId: string, membershipId: string): Promise<BankDetailsDto | null> {
  bankAccess(x, membershipId);
  const [m] = await x.tx.select().from(payrollProfileMembers).where(and(eq(payrollProfileMembers.profileId, profileId), eq(payrollProfileMembers.membershipId, membershipId)));
  if (!m) throw notFound('payroll_profile_member');
  // Someone else opening the full details is on the audit trail (the details themselves never are).
  if (membershipId !== x.actor.membershipId && m.bankDetailsEnc) await audit(x, { action: 'payroll.bank_details_viewed', targetType: 'membership', targetId: membershipId, metadata: { profile_id: profileId } });
  return openBank(x, m.bankDetailsEnc);
}

/**
 * Payout details changing is how pay gets redirected, so nobody changes them unseen: when someone
 * else changes a person's details, that person is told in the app and always by email; when people
 * change their own, the payroll managers are told.
 */
async function announceBankChange(x: Ctx, profileId: string, membershipId: string) {
  const [p] = await x.tx.select({ name: payrollProfiles.name }).from(payrollProfiles).where(eq(payrollProfiles.id, profileId));
  const names = await memberNames(x, [membershipId, x.actor.membershipId]);
  const group = p?.name ?? 'your pay group';
  if (membershipId !== x.actor.membershipId) {
    const n = { type: 'payroll.bank_details_changed', title: 'Your payout details were changed', body: `${names.get(x.actor.membershipId) ?? 'A payroll manager'} changed your payout details for ${group}. If you did not expect this, contact your payroll manager now.`, link: '/pay-stubs' };
    await notify(x.tx, x.deps, x.org.id, [membershipId], n);
    const [u] = await x.tx.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.id, membershipId));
    if (u) await x.deps.mailer.send(notificationEmail(x.deps.config.appUrl, x.org.id, x.org.name, u.email, n, 'You received this email because the payout details of your WorkPulse account changed. It is always sent, whatever your notification settings.')).catch(() => undefined);
  } else {
    const managers = (await membersWith(x.tx, x.org.id, 'payroll:manage')).filter((m) => m !== membershipId);
    await notify(x.tx, x.deps, x.org.id, managers, { type: 'payroll.bank_details_changed', title: `${names.get(membershipId) ?? 'A member'} changed their payout details`, body: `For ${group}. Check them before the next payroll is paid.`, link: '/finance/payroll' });
  }
}

export async function setBankDetails(x: Ctx, profileId: string, membershipId: string, input: z.infer<typeof bankDetailsInput>) {
  bankAccess(x, membershipId);
  const details: BankDetailsDto = {
    type: input.type,
    bank_name: input.bank_name ?? null,
    account_name: input.account_name ?? null,
    account_number: input.account_number ?? null,
    routing_number: input.routing_number ?? null,
    iban: input.iban ?? null,
    swift: input.swift ?? null,
    notes: input.notes ?? null,
  };
  const r = await x.tx
    .update(payrollProfileMembers)
    .set({ bankDetailsEnc: encrypt(x.deps.config.appSecret, JSON.stringify(details), BANK_PURPOSE), updatedAt: new Date() })
    .where(and(eq(payrollProfileMembers.profileId, profileId), eq(payrollProfileMembers.membershipId, membershipId)))
    .returning({ m: payrollProfileMembers.membershipId });
  if (!r.length) throw notFound('payroll_profile_member');
  // Account numbers never go to the audit trail.
  await audit(x, { action: 'payroll.bank_details_updated', targetType: 'membership', targetId: membershipId, metadata: { profile_id: profileId } });
  await announceBankChange(x, profileId, membershipId);
  return details;
}

/** The member's own payroll profiles (for entering bank details). */
export async function myPayrollProfiles(x: Ctx) {
  const rows = await x.tx
    .select({ p: payrollProfiles, enc: payrollProfileMembers.bankDetailsEnc })
    .from(payrollProfileMembers)
    .innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollProfileMembers.profileId))
    .where(and(eq(payrollProfileMembers.membershipId, x.actor.membershipId), isNull(payrollProfiles.archivedAt)));
  return rows.map(({ p, enc }) => ({ id: p.id, name: p.name, currency: p.currency, bank: openBank(x, enc) }));
}

// ─── Runs ────────────────────────────────────────────────────────────────────
function runDto(r: typeof payrollRuns.$inferSelect, profileName: string, memberCount: number): PayrollRunDto {
  return {
    id: r.id,
    profile_id: r.profileId,
    profile_name: profileName,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    currency: r.currency,
    status: r.status,
    gross_minor: r.grossMinor,
    adjustments_minor: r.adjustmentsMinor,
    net_minor: r.netMinor,
    notes: r.notes,
    member_count: memberCount,
    created_at: r.createdAt.toISOString(),
    finalized_at: r.finalizedAt?.toISOString() ?? null,
    paid_at: r.paidAt?.toISOString() ?? null,
    other_currency: r.otherCurrency,
  };
}

function stubDto(l: typeof payrollRunLines.$inferSelect, r: typeof payrollRuns.$inferSelect, name: string, profileName: string): PayStubDto {
  return {
    id: l.id,
    run_id: r.id,
    membership_id: l.membershipId,
    name,
    profile_name: profileName,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    currency: r.currency,
    status: r.status,
    approved_seconds: l.approvedSeconds,
    unapproved_seconds: l.unapprovedSeconds,
    carried_seconds: l.carriedSeconds,
    regular_seconds: l.regularSeconds,
    overtime_seconds: l.overtimeSeconds,
    time_pay_minor: l.timePayMinor,
    time_off_hours: l.timeOffHours,
    time_off_pay_minor: l.timeOffPayMinor,
    gross_minor: l.grossMinor,
    adjustments: l.adjustments,
    net_minor: l.netMinor,
    paid_at: r.paidAt?.toISOString() ?? null,
    warnings: l.warnings,
  };
}

export async function listPayrollRuns(x: Ctx, opts: { year?: number } = {}): Promise<PayrollRunDto[]> {
  need(x, 'payroll:read');
  const rows = await x.tx
    .select({ r: payrollRuns, name: payrollProfiles.name })
    .from(payrollRuns)
    .innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollRuns.profileId))
    .where(opts.year ? and(gte(payrollRuns.periodStart, `${opts.year}-01-01`), lte(payrollRuns.periodStart, `${opts.year}-12-31`)) : undefined)
    .orderBy(desc(payrollRuns.periodStart));
  const counts = rows.length ? await x.tx.select({ run: payrollRunLines.runId }).from(payrollRunLines).where(inArray(payrollRunLines.runId, rows.map((r) => r.r.id))) : [];
  return rows.map(({ r, name }) => runDto(r, name, counts.filter((c) => c.run === r.id).length));
}

export async function getPayrollRun(x: Ctx, id: string): Promise<PayrollRunDto> {
  need(x, 'payroll:read');
  const [row] = await x.tx.select({ r: payrollRuns, name: payrollProfiles.name }).from(payrollRuns).innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollRuns.profileId)).where(eq(payrollRuns.id, id));
  if (!row) throw notFound('payroll_run');
  const lines = await x.tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, id));
  const names = await memberNames(x, lines.map((l) => l.membershipId));
  return { ...runDto(row.r, row.name, lines.length), lines: lines.map((l) => stubDto(l, row.r, names.get(l.membershipId) ?? '', row.name)).sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Earliest date a run of this profile pays: the start of its first payroll. Approved time older than
 * that predates payroll in WorkPulse and is never picked up.
 */
async function payableSince(x: Ctx, profileId: string, from: string): Promise<string> {
  const [first] = await x.tx.select({ start: min(payrollRuns.periodStart) }).from(payrollRuns).where(eq(payrollRuns.profileId, profileId));
  return first?.start && first.start < from ? first.start : from;
}

/**
 * Approved time a run may pay: not voided, not paid by another payroll yet, dated up to the end of
 * the period. That includes time from earlier periods approved after their payroll was finalized,
 * so late approvals are paid by the next run instead of being lost. Time with a pay rate in another
 * currency is never paid by this profile.
 */
async function payableEntries(x: Ctx, profile: typeof payrollProfiles.$inferSelect, members: string[], since: string, to: string) {
  if (!members.length) return [];
  const rows = await x.tx
    .select({ id: billingEntries.id, m: billingEntries.membershipId, d: billingEntries.localDate, s: billingEntries.seconds, pay: billingEntries.payAmountMinor, cur: billingRates.currency })
    .from(billingEntries)
    .leftJoin(billingRates, eq(billingRates.id, billingEntries.payRateId))
    .where(and(isNull(billingEntries.voidedAt), isNull(billingEntries.payrollLineId), inArray(billingEntries.membershipId, members), gte(billingEntries.localDate, since), lte(billingEntries.localDate, to)));
  return rows.map((r) => ({ ...r, foreign: !!r.cur && r.cur !== profile.currency }));
}

/**
 * Pay for each profile member, from approved time only (billing entries snapshot the pay rate at
 * approval; see payableEntries), plus paid time off in the period at the member's own pay rate. Time
 * in the period that is not approved yet is reported but not paid; once approved, the draft picks it
 * up on recalculation, or the next payroll does.
 */
async function computeLines(x: Ctx, profile: typeof payrollProfiles.$inferSelect, from: string, to: string) {
  const members = (await x.tx.select({ m: payrollProfileMembers.membershipId }).from(payrollProfileMembers).where(eq(payrollProfileMembers.profileId, profile.id))).map((r) => r.m);
  if (!members.length) return { lines: [], otherCurrency: false };
  const approved = await payableEntries(x, profile, members, await payableSince(x, profile.id, from), to);
  const rollups = await x.tx.select().from(rollupWorkerDay).where(and(inArray(rollupWorkerDay.membershipId, members), gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to)));
  const [ot] = await x.tx.select().from(overtimeRuleSets);
  const rules = ot?.rules ?? DEFAULT_OVERTIME;
  const split = await overtimeInRange(x.tx, x.org.weekStart, rules, members, from, to, { approvedOnly: true });
  const off = await x.tx
    .select({ t: timeOffRequests, paid: timeOffPolicies.paid, hpd: timeOffPolicies.hoursPerDay })
    .from(timeOffRequests)
    .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
    .where(and(inArray(timeOffRequests.membershipId, members), eq(timeOffRequests.status, 'APPROVED'), lte(timeOffRequests.startDate, to), gte(timeOffRequests.endDate, from)));
  const hols = new Set((await x.tx.select({ d: holidays.date }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to)))).map((h) => h.d));
  const holidayPay = await paidHolidayHours(x.tx, members, from, to);
  const rates = await loadRates(x.tx);
  let otherCurrency = false;

  const lines = members.map((m) => {
    const all = approved.filter((a) => a.m === m);
    // Time in another currency is flagged for its own period only, and never paid here.
    if (all.some((a) => a.foreign && a.d >= from)) otherCurrency = true;
    const mine = all.filter((a) => !a.foreign);
    const timePay = mine.reduce((s, a) => s + a.pay, 0);
    const approvedSeconds = mine.reduce((s, a) => s + a.s, 0);
    const carriedSeconds = mine.filter((a) => a.d < from).reduce((s, a) => s + a.s, 0);
    const worked = rollups.filter((r) => r.membershipId === m);
    const total = worked.reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0);
    // Whole weeks: a week split between two payrolls keeps the overtime worked on this period's days.
    const { regular, overtime } = split.get(m) ?? { regular: 0, overtime: 0 };
    let offHours = 0;
    let offPay = 0;
    const warnings = new Set<string>();
    // Paid at the member's own pay rate (worker, else organization) in effect on each day (F9), so a
    // raise in the middle of a request is respected. No such rate: nothing is invented, the line is flagged.
    const payOffDay = (d: string, h: number) => {
      const rate = resolveRate(rates, 'PAY', { date: d, membershipId: m, projectId: null, clientId: null });
      if (!rate) warnings.add('time_off_no_rate');
      else if (rate.currency !== profile.currency) otherCurrency = true;
      else offPay += amountForSeconds(Math.round(h * 3600), rate.amountMinor);
    };
    for (const o of off.filter((r) => r.t.membershipId === m && r.paid)) {
      const h = timeOffHoursInRange(o.t, from, to, hols, o.hpd || 8);
      offHours += h;
      if (o.t.dayHours) for (const [d, dh] of Object.entries(o.t.dayHours)) if (d >= from && d <= to) payOffDay(d, dh);
      if (!o.t.dayHours) payOffDay(o.t.startDate < from ? from : o.t.startDate, h);
    }
    // Paid holidays are paid time off too: the hours the person would normally work that day.
    for (const { date: d, hours: h } of holidayPay.get(m) ?? []) {
      offHours += h;
      payOffDay(d, h);
    }
    return { membershipId: m, approvedSeconds, carriedSeconds, unapprovedSeconds: Math.max(0, total - (approvedSeconds - carriedSeconds)), regularSeconds: regular, overtimeSeconds: overtime, timePayMinor: timePay, timeOffHours: Math.round(offHours * 100) / 100, timeOffPayMinor: offPay, grossMinor: timePay + offPay, warnings: [...warnings] };
  });
  return { lines, otherCurrency };
}

async function writeTotals(x: Ctx, runId: string) {
  const lines = await x.tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, runId));
  const gross = lines.reduce((s, l) => s + l.grossMinor, 0);
  const adj = lines.reduce((s, l) => s + l.adjustments.reduce((a, b) => a + b.amount_minor, 0), 0);
  await x.tx.update(payrollRuns).set({ grossMinor: gross, adjustmentsMinor: adj, netMinor: gross + adj, updatedAt: new Date() }).where(eq(payrollRuns.id, runId));
}

async function loadRun(x: Ctx, id: string, status?: 'DRAFT' | 'FINALIZED') {
  const [r] = await x.tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
  if (!r) throw notFound('payroll_run');
  if (status && r.status !== status) throw businessRule('payroll_run_status', status === 'DRAFT' ? 'Only draft payrolls can be changed' : 'Finalize the payroll first');
  return r;
}

export async function createPayrollRun(x: Ctx, input: z.infer<typeof payrollRunInput>) {
  need(x, 'payroll:manage');
  const [profile] = await x.tx.select().from(payrollProfiles).where(and(eq(payrollProfiles.id, input.profile_id), isNull(payrollProfiles.archivedAt)));
  if (!profile) throw notFound('payroll_profile');
  // Default: the last period that has fully ended.
  const today = localDate(x.deps.now(), x.org.timezone);
  const current = periodFor(today, profile.period, x.org.weekStart);
  const period = periodFor(input.date ?? addDaysToDate(current.start, -1), profile.period, x.org.weekStart);
  const [exists] = await x.tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.profileId, profile.id), eq(payrollRuns.periodStart, period.start)));
  if (exists) throw conflict('payroll_exists', `${profile.name} already has a payroll for ${period.start} – ${period.end}`);
  // A changed pay period must not pay days twice (time off is paid by date).
  const [overlap] = await x.tx
    .select({ start: payrollRuns.periodStart, end: payrollRuns.periodEnd })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.profileId, profile.id), lte(payrollRuns.periodStart, period.end), gte(payrollRuns.periodEnd, period.start)))
    .limit(1);
  if (overlap) throw conflict('payroll_overlap', `${profile.name} already has a payroll for ${overlap.start} – ${overlap.end}, which overlaps ${period.start} – ${period.end}`);
  const id = newId();
  const { lines, otherCurrency } = await computeLines(x, profile, period.start, period.end);
  await x.tx.insert(payrollRuns).values({ id, organizationId: x.org.id, profileId: profile.id, periodStart: period.start, periodEnd: period.end, currency: profile.currency, otherCurrency, notes: input.notes ?? null, createdBy: x.actor.membershipId });
  if (lines.length) await x.tx.insert(payrollRunLines).values(lines.map((l) => ({ id: newId(), organizationId: x.org.id, runId: id, ...l, netMinor: l.grossMinor })));
  await writeTotals(x, id);
  await audit(x, { action: 'payroll.created', targetType: 'payroll_run', targetId: id, after: { profile_id: profile.id, period } });
  return getPayrollRun(x, id);
}

/** Re-reads approved time into a draft; adjustments are kept. */
export async function recalculatePayrollRun(x: Ctx, id: string) {
  need(x, 'payroll:manage');
  const run = await loadRun(x, id, 'DRAFT');
  const [profile] = await x.tx.select().from(payrollProfiles).where(eq(payrollProfiles.id, run.profileId));
  const existing = await x.tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, id));
  const { lines, otherCurrency } = await computeLines(x, profile!, run.periodStart, run.periodEnd);
  await x.tx.delete(payrollRunLines).where(eq(payrollRunLines.runId, id));
  if (lines.length) {
    await x.tx.insert(payrollRunLines).values(
      lines.map((l) => {
        const adjustments = existing.find((e) => e.membershipId === l.membershipId)?.adjustments ?? [];
        return { id: newId(), organizationId: x.org.id, runId: id, ...l, adjustments, netMinor: l.grossMinor + adjustments.reduce((a, b) => a + b.amount_minor, 0) };
      }),
    );
  }
  await x.tx.update(payrollRuns).set({ otherCurrency }).where(eq(payrollRuns.id, id));
  await writeTotals(x, id);
  await audit(x, { action: 'payroll.recalculated', targetType: 'payroll_run', targetId: id });
  return getPayrollRun(x, id);
}

export async function setPayAdjustments(x: Ctx, runId: string, lineId: string, input: z.infer<typeof payAdjustmentsInput>) {
  need(x, 'payroll:manage');
  await loadRun(x, runId, 'DRAFT');
  const [l] = await x.tx.select().from(payrollRunLines).where(and(eq(payrollRunLines.id, lineId), eq(payrollRunLines.runId, runId)));
  if (!l) throw notFound('pay_stub');
  const adjustments: PayAdjustment[] = input.adjustments.map((a) => ({ label: a.label, amount_minor: a.amount_minor }));
  await x.tx.update(payrollRunLines).set({ adjustments, netMinor: l.grossMinor + adjustments.reduce((s, a) => s + a.amount_minor, 0), updatedAt: new Date() }).where(eq(payrollRunLines.id, lineId));
  await writeTotals(x, runId);
  await audit(x, { action: 'payroll.adjusted', targetType: 'payroll_run', targetId: runId, before: l.adjustments, after: adjustments, metadata: { line_id: lineId } });
  return getPayrollRun(x, runId);
}

export async function finalizePayrollRun(x: Ctx, id: string) {
  need(x, 'payroll:manage');
  const run = await loadRun(x, id, 'DRAFT');
  await claimPaidTime(x, run);
  await x.tx.update(payrollRuns).set({ status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: x.actor.membershipId, updatedAt: new Date() }).where(eq(payrollRuns.id, id));
  const lines = await x.tx.select({ m: payrollRunLines.membershipId }).from(payrollRunLines).where(eq(payrollRunLines.runId, id));
  await notify(x.tx, x.deps, x.org.id, lines.map((l) => l.m), { type: 'payroll.stub_ready', title: 'Your pay stub is ready', body: `Pay period ${run.periodStart} – ${run.periodEnd}`, link: '/pay-stubs' });
  await audit(x, { action: 'payroll.finalized', targetType: 'payroll_run', targetId: id });
  return getPayrollRun(x, id);
}

/**
 * Marks the approved time each pay stub pays, so no other payroll pays it again. The draft must match
 * what is approved and unpaid right now: if time was approved, reopened or paid by another payroll
 * since it was calculated, it has to be recalculated first.
 */
async function claimPaidTime(x: Ctx, run: typeof payrollRuns.$inferSelect) {
  const [profile] = await x.tx.select().from(payrollProfiles).where(eq(payrollProfiles.id, run.profileId));
  const lines = await x.tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
  const entries = (await payableEntries(x, profile!, lines.map((l) => l.membershipId), await payableSince(x, run.profileId, run.periodStart), run.periodEnd)).filter((e) => !e.foreign);
  const stale = () => businessRule('payroll_stale', 'Approved time changed since this payroll was calculated. Recalculate it, check the totals, then finalize.');
  for (const l of lines) {
    const mine = entries.filter((e) => e.m === l.membershipId);
    if (mine.reduce((s, e) => s + e.s, 0) !== l.approvedSeconds || mine.reduce((s, e) => s + e.pay, 0) !== l.timePayMinor) throw stale();
    if (!mine.length) continue;
    // Conditional claim: a payroll finalized at the same moment cannot take the same time.
    const claimed = await x.tx
      .update(billingEntries)
      .set({ payrollLineId: l.id })
      .where(and(inArray(billingEntries.id, mine.map((e) => e.id)), isNull(billingEntries.payrollLineId), isNull(billingEntries.voidedAt)))
      .returning({ id: billingEntries.id });
    if (claimed.length !== mine.length) throw stale();
  }
}

export async function markPayrollPaid(x: Ctx, id: string) {
  need(x, 'payroll:manage');
  await loadRun(x, id, 'FINALIZED');
  await x.tx.update(payrollRuns).set({ status: 'PAID', paidAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, id));
  await audit(x, { action: 'payroll.paid', targetType: 'payroll_run', targetId: id });
  return getPayrollRun(x, id);
}

export async function deletePayrollRun(x: Ctx, id: string) {
  need(x, 'payroll:manage');
  await loadRun(x, id, 'DRAFT');
  await x.tx.delete(payrollRunLines).where(eq(payrollRunLines.runId, id));
  await x.tx.delete(payrollRuns).where(eq(payrollRuns.id, id));
  await audit(x, { action: 'payroll.deleted', targetType: 'payroll_run', targetId: id });
}

// ─── Pay stubs ───────────────────────────────────────────────────────────────
/** The member's own stubs from finalized and paid payrolls. */
export async function myPayStubs(x: Ctx): Promise<PayStubDto[]> {
  const rows = await x.tx
    .select({ l: payrollRunLines, r: payrollRuns, profile: payrollProfiles.name })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollRuns.profileId))
    .where(and(eq(payrollRunLines.membershipId, x.actor.membershipId), inArray(payrollRuns.status, ['FINALIZED', 'PAID'])))
    .orderBy(desc(payrollRuns.periodStart));
  const names = await memberNames(x, [x.actor.membershipId]);
  return rows.map(({ l, r, profile }) => stubDto(l, r, names.get(x.actor.membershipId) ?? '', profile));
}

/** One stub: its owner (once finalized) or payroll readers. */
export async function getPayStub(x: Ctx, lineId: string): Promise<PayStubDto> {
  const [row] = await x.tx
    .select({ l: payrollRunLines, r: payrollRuns, profile: payrollProfiles.name })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .innerJoin(payrollProfiles, eq(payrollProfiles.id, payrollRuns.profileId))
    .where(eq(payrollRunLines.id, lineId));
  const own = row && row.l.membershipId === x.actor.membershipId && row.r.status !== 'DRAFT';
  if (!row || (!own && !has(x, 'payroll:read'))) throw notFound('pay_stub');
  const names = await memberNames(x, [row.l.membershipId]);
  return stubDto(row.l, row.r, names.get(row.l.membershipId) ?? '', row.profile);
}
