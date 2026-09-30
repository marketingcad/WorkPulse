import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
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
  type PayAdjustment,
} from '@tallywork/db';
import { DEFAULT_OVERTIME, addDaysToDate, amountForSeconds, businessRule, conflict, forbidden, localDate, newId, notFound, periodFor, resolveRate, splitOvertime, startOfWeek } from '@tallywork/domain';
import type { BankDetailsDto, PayStubDto, PayrollProfileDto, PayrollRunDto, bankDetailsInput, payAdjustmentsInput, payrollProfileInput, payrollRunInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { loadRates } from './finance';
import { notify } from './notify';
import { timeOffHoursInRange } from './reports';
import { memberNames } from './timer';
import { decrypt, encrypt } from '../lib/crypto';

const BANK_PURPOSE = 'bank-details';
const need = (x: Ctx, p: 'payroll:read' | 'payroll:manage') => {
  if (!x.actor.grants[p]) throw forbidden();
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

export async function upsertPayrollProfile(x: Ctx, id: string | null, input: z.infer<typeof payrollProfileInput>) {
  need(x, 'payroll:manage');
  const pid = id ?? newId();
  if (id) {
    const [p] = await x.tx.select().from(payrollProfiles).where(eq(payrollProfiles.id, id));
    if (!p) throw notFound('payroll_profile');
  }
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
  const values = { name: input.name, period: input.period, currency: input.currency, isDefault: input.is_default ?? false };
  if (id) await x.tx.update(payrollProfiles).set({ ...values, updatedAt: new Date() }).where(eq(payrollProfiles.id, pid));
  else await x.tx.insert(payrollProfiles).values({ id: pid, organizationId: x.org.id, ...values });
  if (values.isDefault) await x.tx.update(payrollProfiles).set({ isDefault: false }).where(and(ne(payrollProfiles.id, pid), eq(payrollProfiles.isDefault, true)));
  // Members: keep bank details of members who stay.
  const current = await x.tx.select({ m: payrollProfileMembers.membershipId }).from(payrollProfileMembers).where(eq(payrollProfileMembers.profileId, pid));
  const keep = new Set(input.member_ids);
  const gone = current.map((c) => c.m).filter((m) => !keep.has(m));
  if (gone.length) await x.tx.delete(payrollProfileMembers).where(and(eq(payrollProfileMembers.profileId, pid), inArray(payrollProfileMembers.membershipId, gone)));
  const added = input.member_ids.filter((m) => !current.some((c) => c.m === m));
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
  if (membershipId !== x.actor.membershipId && !x.actor.grants['payroll:manage']) throw forbidden();
}

export async function getBankDetails(x: Ctx, profileId: string, membershipId: string): Promise<BankDetailsDto | null> {
  bankAccess(x, membershipId);
  const [m] = await x.tx.select().from(payrollProfileMembers).where(and(eq(payrollProfileMembers.profileId, profileId), eq(payrollProfileMembers.membershipId, membershipId)));
  if (!m) throw notFound('payroll_profile_member');
  return openBank(x, m.bankDetailsEnc);
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
    regular_seconds: l.regularSeconds,
    overtime_seconds: l.overtimeSeconds,
    time_pay_minor: l.timePayMinor,
    time_off_hours: l.timeOffHours,
    time_off_pay_minor: l.timeOffPayMinor,
    gross_minor: l.grossMinor,
    adjustments: l.adjustments,
    net_minor: l.netMinor,
    paid_at: r.paidAt?.toISOString() ?? null,
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
 * Pay for each profile member in the period, from approved time only (billing entries snapshot the
 * pay rate at approval), plus paid time off at the member's own pay rate. Time that is not approved
 * yet is reported but not paid; approve it and recalculate the draft to include it.
 */
async function computeLines(x: Ctx, profile: typeof payrollProfiles.$inferSelect, from: string, to: string) {
  const members = (await x.tx.select({ m: payrollProfileMembers.membershipId }).from(payrollProfileMembers).where(eq(payrollProfileMembers.profileId, profile.id))).map((r) => r.m);
  if (!members.length) return { lines: [], otherCurrency: false };
  const approved = await x.tx
    .select({ m: billingEntries.membershipId, d: billingEntries.localDate, s: billingEntries.seconds, pay: billingEntries.payAmountMinor, cur: billingRates.currency })
    .from(billingEntries)
    .leftJoin(billingRates, eq(billingRates.id, billingEntries.payRateId))
    .where(and(isNull(billingEntries.voidedAt), inArray(billingEntries.membershipId, members), gte(billingEntries.localDate, from), lte(billingEntries.localDate, to)));
  const rollups = await x.tx.select().from(rollupWorkerDay).where(and(inArray(rollupWorkerDay.membershipId, members), gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to)));
  const [ot] = await x.tx.select().from(overtimeRuleSets);
  const rules = ot?.rules ?? DEFAULT_OVERTIME;
  const off = await x.tx
    .select({ t: timeOffRequests, paid: timeOffPolicies.paid, hpd: timeOffPolicies.hoursPerDay })
    .from(timeOffRequests)
    .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
    .where(and(inArray(timeOffRequests.membershipId, members), eq(timeOffRequests.status, 'APPROVED'), lte(timeOffRequests.startDate, to), gte(timeOffRequests.endDate, from)));
  const hols = new Set((await x.tx.select({ d: holidays.date }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to)))).map((h) => h.d));
  const rates = await loadRates(x.tx);
  let otherCurrency = false;

  const lines = members.map((m) => {
    const mine = approved.filter((a) => a.m === m);
    let timePay = 0;
    for (const a of mine) {
      if (a.cur && a.cur !== profile.currency) otherCurrency = true;
      else timePay += a.pay;
    }
    const approvedSeconds = mine.reduce((s, a) => s + a.s, 0);
    const worked = rollups.filter((r) => r.membershipId === m);
    const total = worked.reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0);
    const weeks = new Map<string, number[]>();
    for (const r of worked) {
      const wk = startOfWeek(r.localDate, x.org.weekStart);
      const days = weeks.get(wk) ?? Array(7).fill(0);
      days[Math.round((Date.parse(r.localDate) - Date.parse(wk)) / 86400000)] += r.trackedSeconds + r.manualSeconds;
      weeks.set(wk, days);
    }
    let regular = 0;
    let overtime = 0;
    for (const days of weeks.values()) {
      const sp = splitOvertime(days, rules);
      regular += sp.regular;
      overtime += sp.overtime;
    }
    let offHours = 0;
    let offPay = 0;
    for (const o of off.filter((r) => r.t.membershipId === m && r.paid)) {
      const h = timeOffHoursInRange(o.t, from, to, hols, o.hpd || 8);
      offHours += h;
      const rate = resolveRate(rates, 'PAY', { date: o.t.startDate < from ? from : o.t.startDate, membershipId: m, projectId: null, clientId: null });
      if (rate && rate.currency !== profile.currency) otherCurrency = true;
      else if (rate) offPay += amountForSeconds(Math.round(h * 3600), rate.amountMinor);
    }
    return { membershipId: m, approvedSeconds, unapprovedSeconds: Math.max(0, total - approvedSeconds), regularSeconds: regular, overtimeSeconds: overtime, timePayMinor: timePay, timeOffHours: Math.round(offHours * 100) / 100, timeOffPayMinor: offPay, grossMinor: timePay + offPay };
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
  await x.tx.update(payrollRuns).set({ status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: x.actor.membershipId, updatedAt: new Date() }).where(eq(payrollRuns.id, id));
  const lines = await x.tx.select({ m: payrollRunLines.membershipId }).from(payrollRunLines).where(eq(payrollRunLines.runId, id));
  await notify(x.tx, x.deps, x.org.id, lines.map((l) => l.m), { type: 'payroll.stub_ready', title: 'Your pay stub is ready', body: `Pay period ${run.periodStart} – ${run.periodEnd}`, link: '/pay-stubs' });
  await audit(x, { action: 'payroll.finalized', targetType: 'payroll_run', targetId: id });
  return getPayrollRun(x, id);
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
  if (!row || (!own && !x.actor.grants['payroll:read'])) throw notFound('pay_stub');
  const names = await memberNames(x, [row.l.membershipId]);
  return stubDto(row.l, row.r, names.get(row.l.membershipId) ?? '', row.profile);
}
