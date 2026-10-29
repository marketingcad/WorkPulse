import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  billingEntries,
  billingRates,
  budgets,
  clients,
  expenses,
  fileObjects,
  invoiceLines,
  invoiceSequences,
  invoices,
  memberships,
  organizations,
  paymentAllocations,
  payments,
  projects,
  rollupWorkerDay,
  tasks,
  timeTypes,
  timesheetEntries,
  users,
  type Tx,
} from '@tallywork/db';
import {
  budgetStatus,
  businessRule,
  can,
  conflict,
  crossedThresholds,
  deriveInvoiceStatus,
  forbidden,
  invoiceTotals,
  roundQuantity,
  localDate,
  newId,
  notFound,
  resolveRate,
  validation,
  type Rate,
  type RateKind,
  type RateScope,
} from '@tallywork/domain';
import type { BudgetStatusDto, ExpensePageSummary, InvoicePageSummary, OffsetPage, budgetInput, expenseInput, invoiceCreateInput, invoiceDraftUpdateInput, paymentInput, rateInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, emit, emitFrom } from './events';
import { canOnClient, canOnProject, clientFilter, existsInOrg, narrowMemberships } from './scope';
import { memberNames } from './timer';
import { priceEntries } from './pay-figures';
import { membersWith, notify } from './notify';
import { lockWorker } from './tracking';
import { isUuid, likePattern } from '../lib/search';
import { renderEmail } from '../lib/email';


/** The issuing company as printed on invoices. */
export async function companyProfile(x: Ctx) {
  const [o] = await x.tx
    .select({ name: organizations.name, logo: organizations.logo, brief: organizations.brief, taxId: organizations.taxId, address: organizations.address, phone: organizations.phone, email: organizations.email })
    .from(organizations)
    .where(eq(organizations.id, x.org.id));
  return o ?? { name: x.org.name };
}

// ─── Rates ───────────────────────────────────────────────────────────────────
export async function loadRates(tx: Tx): Promise<Rate[]> {
  const rows = await tx.select().from(billingRates);
  return rows.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, scopeId: r.scopeId, amountMinor: r.amountMinor, currency: r.currency, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
}

export async function listRates(x: Ctx) {
  if (!x.actor.grants['rates:read']) throw forbidden();
  const rows = await x.tx.select().from(billingRates).orderBy(asc(billingRates.kind), asc(billingRates.scope), desc(billingRates.effectiveFrom));
  const visibleWorkers = narrowMemberships(x.actor, 'rates:read');
  return rows
    .filter((r) => visibleWorkers === 'all' || !(r.scope === 'WORKER' || r.scope === 'PROJECT_WORKER') || visibleWorkers.includes((r.scopeId ?? '').split(':').pop() ?? ''))
    .map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, scope_id: r.scopeId, amount_minor: r.amountMinor, currency: r.currency, effective_from: r.effectiveFrom, effective_to: r.effectiveTo }));
}

/** Whether an active billing entry was priced with this rate (it is then part of history). */
async function rateInUse(tx: Tx, rateId: string): Promise<boolean> {
  const [u] = await tx.select({ id: billingEntries.id }).from(billingEntries).where(and(isNull(billingEntries.voidedAt), or(eq(billingEntries.billRateId, rateId), eq(billingEntries.payRateId, rateId)))).limit(1);
  return !!u;
}

/** New rate version: closes the previous open-ended rate for the same scope (history kept). */
/** Ends the open-ended rate(s) for one kind + scope at `from` (history kept). Returns what was closed. */
export async function closeOpenRates(x: Ctx, kind: RateKind, scope: RateScope, scopeId: string | null, from: string) {
  const prev = await x.tx
    .select()
    .from(billingRates)
    .where(and(eq(billingRates.kind, kind), eq(billingRates.scope, scope), scopeId ? eq(billingRates.scopeId, scopeId) : isNull(billingRates.scopeId), isNull(billingRates.effectiveTo)));
  for (const p of prev) {
    if (p.effectiveFrom >= from) {
      // Superseded before it started. A rate that already priced approved time is kept (as an
      // empty window) so billing history still points at it; approved amounts never change.
      if (await rateInUse(x.tx, p.id)) await x.tx.update(billingRates).set({ effectiveTo: p.effectiveFrom, updatedAt: new Date() }).where(eq(billingRates.id, p.id));
      else await x.tx.delete(billingRates).where(eq(billingRates.id, p.id));
    } else {
      await x.tx.update(billingRates).set({ effectiveTo: from, updatedAt: new Date() }).where(eq(billingRates.id, p.id));
    }
  }
  return prev;
}

/** Rates of one scope effective today, keyed `${kind}:${scopeId}`. */
export async function currentScopedRates(x: Ctx, scope: RateScope) {
  const today = localDate(x.deps.now(), x.org.timezone);
  const rows = await x.tx
    .select()
    .from(billingRates)
    .where(and(eq(billingRates.scope, scope), lte(billingRates.effectiveFrom, today), or(isNull(billingRates.effectiveTo), gt(billingRates.effectiveTo, today))))
    .orderBy(asc(billingRates.effectiveFrom));
  return new Map(rows.map((r) => [`${r.kind}:${r.scopeId}`, r]));
}

export type RateChange = [RateKind, number | null];

/** Collects the pay/bill amounts a form sent (undefined = untouched, null = clear). */
export function rateChanges(input: { pay_rate_minor?: number | null; bill_rate_minor?: number | null }): RateChange[] {
  const out: RateChange[] = [];
  if (input.bill_rate_minor !== undefined) out.push(['BILL', input.bill_rate_minor]);
  if (input.pay_rate_minor !== undefined) out.push(['PAY', input.pay_rate_minor]);
  return out;
}

/**
 * May the actor set or remove a rate of this scope? Org-wide rates:manage covers every rate. A narrower
 * grant covers only what it reaches: members in its scope, its assigned projects and their clients, never
 * the organization default and never the holder's own pay or bill rate.
 */
async function assertCanManageRate(x: Ctx, scope: RateScope, scopeId: string | null) {
  const grant = x.actor.grants['rates:manage'];
  if (!grant) throw forbidden();
  const [first, member] = scope === 'PROJECT_WORKER' ? (scopeId ?? '').split(':') : [scopeId ?? '', undefined];
  // The rate's subject must be in this organization (A8).
  const found =
    scope === 'ORG' ? true
    : scope === 'WORKER' ? await existsInOrg(x, 'member', first!)
    : scope === 'PROJECT' ? await existsInOrg(x, 'project', first!)
    : scope === 'CLIENT' ? await existsInOrg(x, 'client', first!)
    : !!member && (await existsInOrg(x, 'project', first!)) && (await existsInOrg(x, 'member', member));
  if (!found) throw validation('The rate’s member, project or client was not found', { errors: [{ field: 'scope_id', message: 'Not found in this organization' }] });
  if (grant === 'org') return;
  const ok =
    scope === 'WORKER' ? first !== x.actor.membershipId && can(x.actor, 'rates:manage', { ownerMembershipId: first })
    : scope === 'PROJECT' ? canOnProject(x.actor, 'rates:manage', first!)
    : scope === 'PROJECT_WORKER' ? !!member && member !== x.actor.membershipId && canOnProject(x.actor, 'rates:manage', first!) && can(x.actor, 'rates:manage', { ownerMembershipId: member })
    : scope === 'CLIENT' ? await canOnClient(x, 'rates:manage', first!)
    : false;
  if (!ok) throw forbidden('Your role can’t change this rate');
}

/** Applies form rate edits for one scope from today: unchanged amounts create no new version, null ends the rate. */
export async function applyScopedRates(x: Ctx, scope: RateScope, scopeId: string, changes: RateChange[], currency: string) {
  if (!changes.length) return;
  await assertCanManageRate(x, scope, scopeId);
  const current = await currentScopedRates(x, scope);
  const today = localDate(x.deps.now(), x.org.timezone);
  for (const [kind, amount] of changes) {
    const cur = current.get(`${kind}:${scopeId}`);
    if (amount === null) {
      if (cur) await closeOpenRates(x, kind, scope, scopeId, today);
    } else if (!cur || cur.amountMinor !== amount || cur.currency !== currency) {
      await setRate(x, { kind, scope, scope_id: scopeId, amount_minor: amount, currency, effective_from: today });
    }
  }
}

export async function setRate(x: Ctx, input: z.infer<typeof rateInput>) {
  if (!x.actor.grants['rates:manage']) throw forbidden();
  const scopeId = input.scope === 'ORG' ? null : (input.scope_id ?? null);
  if (input.scope !== 'ORG' && !scopeId) throw validation('scope_id is required for this scope');
  await assertCanManageRate(x, input.scope, scopeId);
  const prev = await closeOpenRates(x, input.kind, input.scope, scopeId, input.effective_from);
  const id = newId();
  await x.tx.insert(billingRates).values({ id, organizationId: x.org.id, kind: input.kind, scope: input.scope, scopeId, amountMinor: input.amount_minor, currency: input.currency, effectiveFrom: input.effective_from, createdBy: x.actor.membershipId });
  await audit(x, { action: 'rate.set', targetType: 'rate', targetId: id, before: prev, after: input });
  return listRates(x);
}

export async function deleteRate(x: Ctx, id: string) {
  if (!x.actor.grants['rates:manage']) throw forbidden();
  const [r] = await x.tx.select().from(billingRates).where(eq(billingRates.id, id));
  if (!r) throw notFound('rate');
  await assertCanManageRate(x, r.scope, r.scopeId);
  if (await rateInUse(x.tx, id)) throw businessRule('rate_in_use', 'This rate priced approved time. Set a new rate from a date instead of deleting it.');
  await x.tx.delete(billingRates).where(eq(billingRates.id, id));
  await audit(x, { action: 'rate.deleted', targetType: 'rate', targetId: id, before: r });
}

// ─── Budgets ─────────────────────────────────────────────────────────────────
function monthBounds(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${today.slice(0, 8)}01`, end, days: Number(end.slice(8)) };
}

async function budgetSpent(tx: Tx, b: typeof budgets.$inferSelect, rates: Rate[], today: string, currency: string): Promise<{ spent: number; from: string | null; to: string | null; daysElapsed?: number; daysTotal?: number }> {
  let from = b.startDate;
  let to = b.endDate;
  let daysElapsed: number | undefined;
  let daysTotal: number | undefined;
  if (b.period === 'MONTHLY') {
    const mb = monthBounds(today);
    from = mb.start;
    to = mb.end;
    daysElapsed = Number(today.slice(8));
    daysTotal = mb.days;
  }
  const owned = b.subjectType === 'PROJECT' ? [] : await tx.select({ id: projects.id, since: projects.clientSince }).from(projects).where(eq(projects.clientId, b.subjectId));
  const projectIds = b.subjectType === 'PROJECT' ? [b.subjectId] : owned.map((p) => p.id);
  if (!projectIds.length) return { spent: 0, from, to, daysElapsed, daysTotal };
  // A client's budget counts a project that moved to it only from the move (UTC day); before that it
  // was another client's work.
  const movedOn = new Map(owned.filter((p) => p.since).map((p) => [p.id, p.since!.toISOString().slice(0, 10)]));
  const rows = (await tx
    .select()
    .from(rollupWorkerDay)
    .where(
      and(
        inArray(rollupWorkerDay.projectId, projectIds),
        from ? gte(rollupWorkerDay.localDate, from) : undefined,
        to ? lte(rollupWorkerDay.localDate, to) : undefined,
        b.includeNonBillable ? undefined : eq(rollupWorkerDay.billable, true),
      ),
    )).filter((r) => !movedOn.has(r.projectId) || r.localDate >= movedOn.get(r.projectId)!);
  let spent = 0;
  if (b.kind === 'HOURS') spent = rows.reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0);
  else {
    // Approved time counts at the amount it was billed at (a later rate change does not reprice it);
    // time not yet approved is estimated at the current rate.
    const approved = await tx
      .select({
        m: billingEntries.membershipId,
        p: billingEntries.projectId,
        d: billingEntries.localDate,
        billable: billingEntries.billable,
        secs: sql<number>`sum(${billingEntries.seconds})::int`,
        // Billed amounts in the budget's currency only (F7); another currency can't be added to it.
        amount: sql<number>`coalesce(sum(${billingEntries.billAmountMinor}) filter (where ${billingEntries.currency} = ${currency}), 0)::bigint`,
        // Seconds weighted by the bill multiplier they were approved with, for non-billable time (Q9).
        weighted: sql<number>`sum(${billingEntries.seconds} * coalesce(${billingEntries.billCoefficient}, 1))::float`,
      })
      .from(billingEntries)
      .where(
        and(
          isNull(billingEntries.voidedAt),
          inArray(billingEntries.projectId, projectIds),
          // Approved time counts for the client it was billed to.
          b.subjectType === 'CLIENT' ? eq(billingEntries.clientId, b.subjectId) : undefined,
          from ? gte(billingEntries.localDate, from) : undefined,
          to ? lte(billingEntries.localDate, to) : undefined,
          b.includeNonBillable ? undefined : eq(billingEntries.billable, true),
        ),
      )
      .groupBy(billingEntries.membershipId, billingEntries.projectId, billingEntries.localDate, billingEntries.billable);
    const byKey = new Map(approved.map((a) => [`${a.m}|${a.p}|${a.d}|${a.billable}`, a]));
    const clientOf = new Map((await tx.select({ id: projects.id, c: projects.clientId }).from(projects).where(inArray(projects.id, projectIds))).map((p) => [p.id, p.c]));
    // Exact cents are added up and rounded once for the budget (F7), not once per day and person.
    let exact = 0;
    const billRate = (m: string, p: string, d: string) => {
      const rate = resolveRate(rates, 'BILL', { date: d, membershipId: m, projectId: p, clientId: clientOf.get(p) ?? null });
      return rate && rate.currency === currency ? rate.amountMinor : null;
    };
    // Approved billable time counts at what it was billed. Approved non-billable time (counted when the
    // budget includes it) is valued at the bill rate of the day it was worked, as before approval (Q9).
    const approvedValue = (a: (typeof approved)[number]) => {
      if (a.billable) return Number(a.amount);
      const rate = billRate(a.m, a.p, a.d);
      return rate === null ? 0 : (Number(a.weighted) * rate) / 3600;
    };
    for (const r of rows) {
      const key = `${r.membershipId}|${r.projectId}|${r.localDate}|${r.billable}`;
      const a = byKey.get(key);
      const total = r.trackedSeconds + r.manualSeconds;
      const rest = Math.max(0, total - (a?.secs ?? 0));
      const rate = rest > 0 ? billRate(r.membershipId, r.projectId, r.localDate) : null;
      // Unapproved time carries the row's time-type bill weighting.
      const weighted = total ? (rest * r.billWeightedSeconds) / total : rest;
      exact += (rate !== null ? (weighted * rate) / 3600 : 0) + (a ? approvedValue(a) : 0);
      byKey.delete(key);
    }
    for (const a of byKey.values()) exact += approvedValue(a);
    spent = Math.round(exact);
  }
  return { spent, from, to, daysElapsed, daysTotal };
}

export async function budgetStatuses(tx: Tx, orgCurrency: string, today: string, filter?: { subjectIds?: string[] }): Promise<BudgetStatusDto[]> {
  const bs = await tx.select().from(budgets).where(filter?.subjectIds ? inArray(budgets.subjectId, filter.subjectIds.length ? filter.subjectIds : ['00000000-0000-7000-8000-000000000000']) : undefined);
  if (!bs.length) return [];
  const rates = await loadRates(tx);
  const pnames = await tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, bs.map((b) => b.subjectId)));
  const cnames = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, bs.map((b) => b.subjectId)));
  const names = new Map([...pnames, ...cnames].map((n) => [n.id, n.name]));
  const out: BudgetStatusDto[] = [];
  for (const b of bs) {
    const s = await budgetSpent(tx, b, rates, today, orgCurrency);
    let daysElapsed = s.daysElapsed;
    let daysTotal = s.daysTotal;
    if (b.period === 'TOTAL' && b.startDate && b.endDate) {
      daysTotal = Math.max(1, Math.round((Date.parse(b.endDate) - Date.parse(b.startDate)) / 86400000) + 1);
      daysElapsed = Math.min(daysTotal, Math.max(1, Math.round((Date.parse(today) - Date.parse(b.startDate)) / 86400000) + 1));
    }
    const st = budgetStatus({ budget: b.amount, spent: s.spent, warnPct: b.warnPct, daysElapsed, daysTotal });
    out.push({
      id: b.id,
      subject_type: b.subjectType,
      subject_id: b.subjectId,
      subject_name: names.get(b.subjectId) ?? '(deleted)',
      kind: b.kind,
      amount: b.amount,
      spent: st.spent,
      remaining: st.remaining,
      pct_used: st.pctUsed,
      state: st.state,
      projected: st.projected,
      currency: orgCurrency,
      period: b.period,
      warn_pct: b.warnPct,
      include_non_billable: b.includeNonBillable,
    });
  }
  return out.sort((a, b) => b.pct_used - a.pct_used);
}

/** Money budgets are measured in billed value, which only billing/rate viewers may see. */
export function redactBudgetMoney(x: Pick<Ctx, 'actor'>, list: BudgetStatusDto[]): BudgetStatusDto[] {
  if (x.actor.grants['billing:read'] || x.actor.grants['rates:read']) return list;
  return list.map((b) => (b.kind === 'MONEY' ? { ...b, amount: 0, spent: 0, remaining: 0, projected: null, amounts_hidden: true } : b));
}

export async function listBudgets(x: Ctx) {
  const scope = x.actor.grants['budgets:read'];
  if (!scope) throw forbidden();
  const today = localDate(x.deps.now(), x.org.timezone);
  const all = await budgetStatuses(x.tx, x.org.currency, today);
  return redactBudgetMoney(x, scope === 'org' ? all : all.filter((b) => b.subject_type === 'PROJECT' && x.actor.assignedProjectIds.has(b.subject_id)));
}

/**
 * May the actor set or remove a budget on this subject? Audit 28 Oct 2026 (A2b): org scope covers
 * every budget, a narrower grant only its assigned projects and their clients. The subject must be
 * in this organization.
 */
async function assertCanManageBudget(x: Ctx, subjectType: 'PROJECT' | 'CLIENT', subjectId: string) {
  if (!x.actor.grants['budgets:manage']) throw forbidden();
  const table = subjectType === 'PROJECT' ? projects : clients;
  const [found] = await x.tx.select({ id: table.id }).from(table).where(and(eq(table.id, subjectId), eq(table.organizationId, x.org.id)));
  if (!found) throw notFound(subjectType === 'PROJECT' ? 'project' : 'client');
  const allowed = subjectType === 'PROJECT' ? canOnProject(x.actor, 'budgets:manage', subjectId) : await canOnClient(x, 'budgets:manage', subjectId);
  if (!allowed) throw forbidden('Your role can’t change this budget');
}

export async function upsertBudget(x: Ctx, input: z.infer<typeof budgetInput>) {
  await assertCanManageBudget(x, input.subject_type, input.subject_id);
  const values = {
    organizationId: x.org.id,
    subjectType: input.subject_type,
    subjectId: input.subject_id,
    kind: input.kind,
    amount: input.amount,
    period: input.period,
    warnPct: input.warn_pct,
    includeNonBillable: input.include_non_billable,
  };
  await x.tx
    .insert(budgets)
    .values({ id: newId(), ...values })
    .onConflictDoUpdate({ target: [budgets.organizationId, budgets.subjectType, budgets.subjectId], set: { ...values, lastNotifiedLevel: 0, notifiedPeriod: null, updatedAt: new Date() } });
  await audit(x, { action: 'budget.set', targetType: input.subject_type.toLowerCase(), targetId: input.subject_id, after: input });
  return listBudgets(x);
}

export async function deleteBudget(x: Ctx, id: string) {
  if (!x.actor.grants['budgets:manage']) throw forbidden();
  const [b] = isUuid(id) ? await x.tx.select().from(budgets).where(eq(budgets.id, id)) : [];
  if (!b) throw notFound('budget');
  await assertCanManageBudget(x, b.subjectType, b.subjectId);
  await x.tx.delete(budgets).where(eq(budgets.id, id));
  await audit(x, { action: 'budget.deleted', targetType: 'budget', targetId: id });
}

/** Called after time changes: notify once per threshold level crossed (warn%, 100%). */
export async function checkBudgets(tx: Tx, deps: Deps, organizationId: string, orgCurrency: string, timezone: string, projectIds: string[]): Promise<void> {
  if (!projectIds.length) return;
  const clientIds = (await tx.select({ c: projects.clientId }).from(projects).where(inArray(projects.id, projectIds))).map((r) => r.c).filter((c): c is string => !!c);
  const today = localDate(deps.now(), timezone);
  const statuses = await budgetStatuses(tx, orgCurrency, today, { subjectIds: [...projectIds, ...clientIds] });
  for (const s of statuses) {
    const [b] = await tx.select().from(budgets).where(eq(budgets.id, s.id));
    if (!b) continue;
    // Monthly budgets start over each month; total budgets notify once per level, ever.
    const period = b.period === 'MONTHLY' ? monthBounds(today).start : 'TOTAL';
    const notifiedLevel = b.notifiedPeriod === period ? b.lastNotifiedLevel : 0;
    const levels = crossedThresholds(notifiedLevel, s.pct_used, [b.warnPct, 100]);
    if (!levels.length) continue;
    const top = Math.max(...levels);
    await tx.update(budgets).set({ lastNotifiedLevel: top, notifiedPeriod: period }).where(eq(budgets.id, b.id));
    const exceeded = top >= 100;
    await emit(tx, organizationId, 'budget.threshold_crossed', { budget_id: b.id, subject_type: b.subjectType, subject_id: b.subjectId, level: top, pct_used: s.pct_used, state: s.state });
    await notify(tx, deps, organizationId, await membersWith(tx, organizationId, 'budgets:manage'), {
      type: exceeded ? 'budget.exceeded' : 'budget.warning',
      title: `${s.subject_name} budget ${exceeded ? 'exceeded' : `at ${Math.round(s.pct_used)}%`}`,
      body: `${b.subjectType === 'PROJECT' ? 'Project' : 'Client'} budget has used ${s.pct_used}% of its ${b.kind === 'HOURS' ? 'hours' : 'amount'}.`,
      link: `/finance/budgets`,
    });
  }
}

// ─── Amounts owed (payroll-ready) ────────────────────────────────────────────
export async function amountsOwed(x: Ctx, from: string, to: string) {
  if (!x.actor.grants['billing:read'] && !x.actor.grants['rates:read']) throw forbidden();
  const visible = narrowMemberships(x.actor, x.actor.grants['billing:read'] ? 'billing:read' : 'rates:read');
  // Approved time at its approved amounts, the rest per entry at today's rates: with everything
  // approved, "estimated" equals "approved" to the cent.
  const priced = await priceEntries(x.tx, x.org.currency, from, to, visible);
  // Both figures come from the same priced entries, so pay in another currency is left out of both
  // (it used to be added to "approved" as if it were in the org currency).
  const byWorker = new Map<string, { seconds: number; estimated: number; approvedSeconds: number; approved: number }>();
  for (const e of priced) {
    const w = byWorker.get(e.membershipId) ?? { seconds: 0, estimated: 0, approvedSeconds: 0, approved: 0 };
    w.seconds += e.seconds;
    w.estimated += e.payMinor;
    if (e.approved) {
      w.approvedSeconds += e.seconds;
      w.approved += e.payMinor;
    }
    byWorker.set(e.membershipId, w);
  }
  const names = await memberNames(x, [...byWorker.keys()]);
  return [...byWorker.entries()]
    .map(([m, w]) => {
      return { membership_id: m, worker_name: names.get(m) ?? '', tracked_seconds: w.seconds, approved_seconds: w.approvedSeconds, approved_amount_minor: w.approved, estimated_amount_minor: w.estimated, currency: x.org.currency };
    })
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name));
}

// ─── Expenses ────────────────────────────────────────────────────────────────
type ExpenseQuery = { status?: string; from?: string; to?: string; search?: string };

/** The expenses the person may see that match the filters. `withStatus: false` ignores the status (for per-status counts). */
function expenseWhere(x: Ctx, q: ExpenseQuery, withStatus = true) {
  const visible = narrowMemberships(x.actor, 'expenses:read');
  const term = q.search ? likePattern(q.search) : null;
  return and(
    withStatus && q.status && q.status !== 'ALL' ? eq(expenses.status, q.status as 'SUBMITTED') : undefined,
    q.from ? gte(expenses.spentOn, q.from) : undefined,
    q.to ? lte(expenses.spentOn, q.to) : undefined,
    visible === 'all' ? undefined : inArray(expenses.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
    term
      ? or(
          ilike(expenses.category, term),
          ilike(expenses.description, term),
          ilike(projects.name, term),
          ilike(clients.name, term),
          inArray(expenses.membershipId, x.tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(ilike(users.name, term))),
        )
      : undefined,
  );
}

const expenseOrder = [desc(expenses.spentOn), desc(expenses.id)];

/**
 * Expenses as a plain array, newest first. Capped at 1000 unless `limit` is null (reports, which
 * are bounded by their date range); use `pageExpenses` to reach every expense.
 */
export async function listExpenses(x: Ctx, q: ExpenseQuery, limit: number | null = 1000) {
  const base = x.tx
    .select({ e: expenses, projectName: projects.name, clientName: clients.name })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(expenseWhere(x, q))
    .orderBy(...expenseOrder);
  return toExpenseRows(x, limit === null ? await base : await base.limit(limit));
}

/** One numbered page of expenses (`page` is 1-based), the total, and per-status counts. */
export async function pageExpenses(x: Ctx, q: ExpenseQuery & { page: number; pageSize: number }): Promise<OffsetPage<Awaited<ReturnType<typeof toExpenseRows>>[number]> & { summary: ExpensePageSummary }> {
  const byStatus = await x.tx
    .select({ status: expenses.status, n: sql<number>`count(*)::int` })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(expenseWhere(x, q, false))
    .groupBy(expenses.status);
  const [sum] = await x.tx
    .select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = ${x.org.currency}), 0)::bigint` })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(expenseWhere(x, q));
  const rows = await x.tx
    .select({ e: expenses, projectName: projects.name, clientName: clients.name })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(expenseWhere(x, q))
    .orderBy(...expenseOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const counts: ExpensePageSummary['counts'] = { ALL: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, REIMBURSED: 0 };
  for (const r of byStatus) {
    counts[r.status] = r.n;
    counts.ALL += r.n;
  }
  return { data: await toExpenseRows(x, rows), total: sum?.n ?? 0, page: q.page, page_size: q.pageSize, summary: { counts, total_minor: Number(sum?.amount ?? 0), currency: x.org.currency } };
}

async function toExpenseRows(x: Ctx, rows: Array<{ e: typeof expenses.$inferSelect; projectName: string | null; clientName: string | null }>) {
  const names = await memberNames(x, [...new Set(rows.map((r) => r.e.membershipId))]);
  return rows.map(({ e, projectName, clientName }) => ({
    id: e.id,
    membership_id: e.membershipId,
    worker_name: names.get(e.membershipId) ?? '',
    project_id: e.projectId,
    project_name: projectName,
    client_id: e.clientId,
    client_name: clientName,
    category: e.category,
    description: e.description,
    amount_minor: e.amountMinor,
    currency: e.currency,
    spent_on: e.spentOn,
    receipt_file_id: e.receiptFileId,
    billable: e.billable,
    reimbursable: e.reimbursable,
    status: e.status,
    invoiced: !!e.invoiceLineId,
    created_at: e.createdAt.toISOString(),
  }));
}

export async function createExpense(x: Ctx, input: z.infer<typeof expenseInput>) {
  if (!x.actor.grants['expenses:create']) throw forbidden();
  if (input.receipt_file_id) {
    // A receipt backs one claim, by the person who uploaded it (two submissions at once are
    // serialized by the member lock, so both cannot pass the check).
    await lockWorker(x.tx, x.actor.membershipId);
    const [f] = await x.tx.select().from(fileObjects).where(eq(fileObjects.id, input.receipt_file_id));
    if (!f || f.purpose !== 'RECEIPT' || f.uploadedBy !== x.actor.membershipId) throw notFound('receipt');
    const [used] = await x.tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.receiptFileId, f.id)).limit(1);
    if (used) throw businessRule('receipt_in_use', 'This receipt is already attached to another expense', { errors: [{ field: 'receipt_file_id', message: 'Upload the receipt for this expense' }] });
  }
  let clientId = input.client_id ?? null;
  // Only a project the person can see and that is still in use; the client must be the project's
  // (a billable expense on another client would end up on that client's invoice).
  if (input.project_id) {
    const [p] = await x.tx.select().from(projects).where(eq(projects.id, input.project_id));
    if (!p || !canOnProject(x.actor, 'projects:read', p.id)) throw notFound('project');
    if (p.archivedAt) throw validation('This project is archived', { errors: [{ field: 'project_id', message: 'Choose a project that is in use' }] });
    if (clientId && clientId !== p.clientId) throw validation('The client must be the project’s client', { errors: [{ field: 'client_id', message: 'Leave it empty to use the project’s client' }] });
    clientId ??= p.clientId;
  } else if (clientId) {
    const [c] = await x.tx.select({ id: clients.id, archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, clientId));
    if (!c || !(await canOnClient(x, 'clients:read', c.id))) throw notFound('client');
    if (c.archivedAt) throw validation('This client is archived', { errors: [{ field: 'client_id', message: 'Choose a client that is in use' }] });
  }
  // A billable expense is invoiced in its client's currency; in another one it could never reach an
  // invoice (U6), so it is refused with the currency to use.
  if (input.billable && clientId) {
    const [c] = await x.tx.select({ currency: clients.currency }).from(clients).where(eq(clients.id, clientId));
    const billed = c?.currency ?? x.org.currency;
    if (input.currency.toUpperCase() !== billed) throw validation(`This client is invoiced in ${billed}`, { errors: [{ field: 'currency', message: `Billable expenses for this client are in ${billed}` }] });
  }
  const id = newId();
  await x.tx.insert(expenses).values({
    id,
    organizationId: x.org.id,
    membershipId: x.actor.membershipId,
    projectId: input.project_id ?? null,
    clientId,
    category: input.category,
    description: input.description ?? null,
    amountMinor: input.amount_minor,
    currency: input.currency,
    spentOn: input.spent_on,
    receiptFileId: input.receipt_file_id ?? null,
    billable: input.billable,
    reimbursable: input.reimbursable,
  });
  await emitFrom(x, 'expense.submitted', { expense_id: id, membership_id: x.actor.membershipId, amount_minor: input.amount_minor }, { workerId: x.actor.membershipId });
  await audit(x, { action: 'expense.created', targetType: 'expense', targetId: id, after: input });
  return (await listExpenses(x, {})).find((e) => e.id === id)!;
}

export async function decideExpense(x: Ctx, id: string, action: 'APPROVE' | 'REJECT' | 'REIMBURSE') {
  const [e] = await x.tx.select().from(expenses).where(eq(expenses.id, id));
  if (!e || !can(x.actor, 'expenses:read', { ownerMembershipId: e.membershipId })) throw notFound('expense');
  if (!can(x.actor, 'expenses:approve', { ownerMembershipId: e.membershipId }) || e.membershipId === x.actor.membershipId) throw forbidden();
  const next = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'REIMBURSED';
  const allowed = { APPROVE: ['SUBMITTED', 'REJECTED'], REJECT: ['SUBMITTED', 'APPROVED'], REIMBURSE: ['APPROVED'] }[action];
  if (!allowed.includes(e.status)) throw businessRule('invalid_expense_transition', `Cannot ${action.toLowerCase()} an expense that is ${e.status.toLowerCase()}`);
  if (e.invoiceLineId && action === 'REJECT') throw businessRule('expense_invoiced', 'This expense is on an invoice');
  if (action === 'REIMBURSE' && !e.reimbursable) throw businessRule('expense_not_reimbursable', 'This expense was submitted as not reimbursable');
  // Conditional on the status read above: two decisions sent at once cannot both apply (e.g. reimbursed twice).
  const [done] = await x.tx
    .update(expenses)
    .set({ status: next, decidedBy: x.actor.membershipId, decidedAt: new Date(), ...(action === 'REIMBURSE' ? { reimbursedAt: new Date() } : {}), updatedAt: new Date() })
    .where(and(eq(expenses.id, id), eq(expenses.status, e.status)))
    .returning({ id: expenses.id });
  if (!done) throw conflict('expense_changed', 'This expense was just decided by someone else. Refresh to see its status.');
  await emitFrom(x, `expense.${next.toLowerCase()}`, { expense_id: id, membership_id: e.membershipId }, { workerId: e.membershipId });
  await audit(x, { action: `expense.${next.toLowerCase()}`, targetType: 'expense', targetId: id });
}

// ─── Invoices ────────────────────────────────────────────────────────────────
interface DraftLine {
  kind: 'TIME' | 'EXPENSE' | 'CUSTOM';
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  taxRateBps: number;
  projectId: string | null;
  billingEntryIds: string[];
  expenseIds: string[];
}

async function buildInvoiceDraft(x: Ctx, input: z.infer<typeof invoiceCreateInput>) {
  const [client] = await x.tx.select().from(clients).where(eq(clients.id, input.client_id));
  if (!client) throw notFound('client');
  if (input.period_end < input.period_start) throw validation('Period end must be after period start', { errors: [{ field: 'period_end', message: 'Choose an end on or after the start' }] });
  // Same rule as editing a draft (updateInvoiceDraft).
  if (input.due_date < input.issue_date) throw validation('The due date cannot be before the issue date', { errors: [{ field: 'due_date', message: 'The due date cannot be before the issue date' }] });
  const currency = client.currency ?? x.org.currency;
  const entries = await x.tx
    .select({ b: billingEntries, projectName: projects.name, taskTitle: tasks.title, workerName: users.name, rateAmount: billingRates.amountMinor, timeTypeId: timesheetEntries.timeTypeId })
    .from(billingEntries)
    .leftJoin(billingRates, eq(billingRates.id, billingEntries.billRateId))
    // The time type the entry had when it was approved (the snapshot the billing entry was priced from).
    .leftJoin(timesheetEntries, and(eq(timesheetEntries.timesheetId, billingEntries.timesheetId), eq(timesheetEntries.timeEntryId, billingEntries.timeEntryId), isNull(timesheetEntries.supersededAt)))
    .innerJoin(projects, eq(projects.id, billingEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, billingEntries.taskId))
    .innerJoin(memberships, eq(memberships.id, billingEntries.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(billingEntries.clientId, input.client_id),
        eq(billingEntries.currency, currency),
        eq(billingEntries.billable, true),
        isNull(billingEntries.voidedAt),
        isNull(billingEntries.invoiceLineId),
        gte(billingEntries.localDate, input.period_start),
        lte(billingEntries.localDate, input.period_end),
        sql`${billingEntries.billAmountMinor} > 0`,
      ),
    );
  const types = await x.tx.select({ id: timeTypes.id, name: timeTypes.name, isDefault: timeTypes.isDefault, archivedAt: timeTypes.archivedAt }).from(timeTypes);
  // No type on the entry means the default type (as for its coefficient).
  const typeName = (id: string | null) => (id ? types.find((t) => t.id === id)?.name : types.find((t) => t.isDefault && !t.archivedAt)?.name) ?? 'Time type';
  const groups = new Map<string, DraftLine & { seconds: number }>();
  const seen = new Set<string>();
  for (const { b, projectName, taskTitle, workerName, rateAmount, timeTypeId } of entries) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const label = input.group_by === 'task' ? `${projectName} — ${taskTitle ?? 'No task'}` : input.group_by === 'worker' ? `${projectName} — ${workerName}` : projectName;
    // One line per label, unit price and time type multiplier. The multiplier is the one the time was
    // priced with at approval (Q10), not the time type's today. Entries approved before it was kept
    // are priced from what they were billed: amount ÷ hours.
    const k = b.billCoefficient;
    const hourly = rateAmount !== null && k !== null ? Math.round(rateAmount * k) : b.seconds > 0 ? Math.round((b.billAmountMinor * 3600) / b.seconds) : 0;
    const key = `${label}|${hourly}|${k ?? 'billed'}`;
    let g = groups.get(key);
    if (!g) {
      const typeLabel = k !== null && k !== 1 ? ` — ${typeName(timeTypeId)} ×${k}` : '';
      g = { kind: 'TIME', description: `${label}${typeLabel}`, quantity: 0, unitPriceMinor: hourly, amountMinor: 0, taxRateBps: input.tax_rate_bps, projectId: b.projectId, billingEntryIds: [], expenseIds: [], seconds: 0 };
      groups.set(key, g);
    }
    g.seconds += b.seconds;
    g.amountMinor += b.billAmountMinor;
    g.billingEntryIds.push(b.id);
  }
  // Each line is quantity × unit price, rounded once (F10), so the invoice always multiplies out. It can
  // differ from the sum of the entries' approved amounts by a few cents; the Billing report shows that.
  const lines: DraftLine[] = [...groups.values()].map((g) => {
    const quantity = roundQuantity(g.seconds / 3600);
    return { ...g, quantity, amountMinor: Math.round(quantity * g.unitPriceMinor) };
  });
  if (input.include_expenses) {
    const ex = await x.tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, input.client_id), eq(expenses.currency, currency), eq(expenses.billable, true), inArray(expenses.status, ['APPROVED', 'REIMBURSED']), isNull(expenses.invoiceLineId), gte(expenses.spentOn, input.period_start), lte(expenses.spentOn, input.period_end)));
    for (const e of ex) {
      lines.push({ kind: 'EXPENSE', description: `Expense: ${e.category}${e.description ? ` — ${e.description}` : ''} (${e.spentOn})`, quantity: 1, unitPriceMinor: e.amountMinor, amountMinor: e.amountMinor, taxRateBps: input.tax_rate_bps, projectId: e.projectId, billingEntryIds: [], expenseIds: [e.id] });
    }
  }
  for (const l of input.extra_lines) {
    const t = invoiceTotals([{ quantity: l.quantity, unitPriceMinor: l.unit_price_minor, taxRateBps: l.tax_rate_bps }]);
    lines.push({ kind: 'CUSTOM', description: l.description, quantity: l.quantity, unitPriceMinor: l.unit_price_minor, amountMinor: t.lines[0]!.amountMinor, taxRateBps: l.tax_rate_bps, projectId: null, billingEntryIds: [], expenseIds: [] });
  }
  const withTax = lines.map((l) => ({ ...l, taxMinor: Math.round((l.amountMinor * l.taxRateBps) / 10000) }));
  const subtotal = withTax.reduce((s, l) => s + l.amountMinor, 0);
  const tax = withTax.reduce((s, l) => s + l.taxMinor, 0);
  // Approved time or expenses in another currency are left for a separate invoice.
  const [other] = await x.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(billingEntries)
    .where(and(eq(billingEntries.clientId, input.client_id), sql`${billingEntries.currency} <> ${currency}`, eq(billingEntries.billable, true), isNull(billingEntries.voidedAt), isNull(billingEntries.invoiceLineId), gte(billingEntries.localDate, input.period_start), lte(billingEntries.localDate, input.period_end)));
  return { client, lines: withTax, subtotal, tax, total: subtotal + tax, currency, otherCurrencyEntries: other?.n ?? 0 };
}

/** Invoices are managed per client: org scope covers every client, a narrower one its projects' clients (A2b). */
async function assertCanManageInvoicesFor(x: Ctx, clientId: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  if (!(await canOnClient(x, 'invoices:manage', clientId))) throw notFound('client');
}

export async function previewInvoice(x: Ctx, input: z.infer<typeof invoiceCreateInput>) {
  await assertCanManageInvoicesFor(x, input.client_id);
  const d = await buildInvoiceDraft(x, input);
  return {
    client_id: d.client.id,
    client_name: d.client.name,
    currency: d.currency,
    subtotal_minor: d.subtotal,
    tax_minor: d.tax,
    total_minor: d.total,
    other_currency_entries: d.otherCurrencyEntries,
    lines: d.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unit_price_minor: l.unitPriceMinor, amount_minor: l.amountMinor, tax_minor: l.taxMinor, entries: l.billingEntryIds.length })),
  };
}

export async function createInvoice(x: Ctx, input: z.infer<typeof invoiceCreateInput>) {
  await assertCanManageInvoicesFor(x, input.client_id);
  const d = await buildInvoiceDraft(x, input);
  if (!d.lines.length) throw businessRule('nothing_to_invoice', 'There is no approved billable time or expenses for this client and period');
  const [seq] = await x.tx.update(invoiceSequences).set({ next: sql`${invoiceSequences.next} + 1` }).where(eq(invoiceSequences.organizationId, x.org.id)).returning();
  const number = `${seq?.prefix ?? 'INV-'}${(seq?.next ?? 1001) - 1}`;
  const id = newId();
  await x.tx.insert(invoices).values({
    id,
    organizationId: x.org.id,
    clientId: d.client.id,
    number,
    issueDate: input.issue_date,
    dueDate: input.due_date,
    periodStart: input.period_start,
    periodEnd: input.period_end,
    currency: d.currency,
    subtotalMinor: d.subtotal,
    taxMinor: d.tax,
    totalMinor: d.total,
    notes: input.notes ?? null,
    createdBy: x.actor.membershipId,
  });
  let pos = 0;
  for (const l of d.lines) {
    const lineId = newId();
    await x.tx.insert(invoiceLines).values({ id: lineId, organizationId: x.org.id, invoiceId: id, kind: l.kind, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps, amountMinor: l.amountMinor, taxMinor: l.taxMinor, projectId: l.projectId, position: pos++ });
    // Claim only entries that are still uninvoiced: a concurrent invoice for the same time fails
    // here instead of billing it twice.
    if (l.billingEntryIds.length) {
      const claimed = await x.tx.update(billingEntries).set({ invoiceLineId: lineId }).where(and(inArray(billingEntries.id, l.billingEntryIds), isNull(billingEntries.invoiceLineId), isNull(billingEntries.voidedAt))).returning({ id: billingEntries.id });
      if (claimed.length !== l.billingEntryIds.length) throw conflict('invoice_conflict', 'Some of this time was invoiced at the same moment; reload and try again');
    }
    if (l.expenseIds.length) {
      const claimed = await x.tx.update(expenses).set({ invoiceLineId: lineId }).where(and(inArray(expenses.id, l.expenseIds), isNull(expenses.invoiceLineId))).returning({ id: expenses.id });
      if (claimed.length !== l.expenseIds.length) throw conflict('invoice_conflict', 'Some of these expenses were invoiced at the same moment; reload and try again');
    }
  }
  await emitFrom(x, 'invoice.created', { invoice_id: id, number, client_id: d.client.id, total_minor: d.total, currency: d.currency });
  await audit(x, { action: 'invoice.created', targetType: 'invoice', targetId: id, after: { number, total: d.total } });
  return getInvoice(x, id);
}

type InvoiceQuery = { status?: string; clientId?: string; from?: string; to?: string; search?: string };

/**
 * An invoice's status exactly as `deriveInvoiceStatus` computes it, in SQL, so lists can filter
 * and count by it before paging. Keep the two in step (finance-paging.test.ts checks they agree).
 */
const invoiceStatusSql = (today: string) =>
  sql<InvoiceStatusKey>`case when ${invoices.status} in ('DRAFT', 'VOID') then ${invoices.status} when ${invoices.paidMinor} >= ${invoices.totalMinor} and ${invoices.totalMinor} > 0 then 'PAID' when ${invoices.dueDate} < ${today} then 'OVERDUE' when ${invoices.paidMinor} > 0 then 'PARTIALLY_PAID' else 'SENT' end`;
type InvoiceStatusKey = Exclude<keyof InvoicePageSummary['counts'], 'ALL'>;

/** Invoices matching the filters. `withStatus: false` ignores the status (for per-status counts and totals). */
function invoiceWhere(q: InvoiceQuery, today: string, withStatus = true) {
  const term = q.search ? likePattern(q.search) : null;
  return and(
    q.clientId ? eq(invoices.clientId, q.clientId) : undefined,
    // OPEN: still waiting for money (sent, partially paid or overdue), e.g. for applying a payment.
    withStatus && q.status === 'OPEN' ? sql`${invoiceStatusSql(today)} in ('SENT', 'PARTIALLY_PAID', 'OVERDUE')` : undefined,
    withStatus && q.status && q.status !== 'ALL' && q.status !== 'OPEN' ? sql`${invoiceStatusSql(today)} = ${q.status}` : undefined,
    q.from ? gte(invoices.issueDate, q.from) : undefined,
    q.to ? lte(invoices.issueDate, q.to) : undefined,
    term ? or(ilike(invoices.number, term), ilike(clients.name, term)) : undefined,
  );
}

const invoiceOrder = [desc(invoices.issueDate), desc(invoices.createdAt), desc(invoices.id)];

/**
 * Invoices as a plain array, newest first. Capped at 1000 unless `limit` is null (reports, which
 * are bounded by their date range); use `pageInvoices` to reach every invoice.
 */
export async function listInvoices(x: Ctx, q: InvoiceQuery, limit: number | null = 1000) {
  if (!x.actor.grants['invoices:read']) throw forbidden();
  const today = localDate(x.deps.now(), x.org.timezone);
  const base = x.tx
    .select({ i: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(invoiceWhere(q, today), clientFilter(x, 'invoices:read', invoices.clientId)))
    .orderBy(...invoiceOrder);
  return (limit === null ? await base : await base.limit(limit)).map((r) => toInvoiceRow(r, today));
}

/** One numbered page of invoices (`page` is 1-based), the total, and totals over every matching invoice. */
export async function pageInvoices(x: Ctx, q: InvoiceQuery & { page: number; pageSize: number }): Promise<OffsetPage<ReturnType<typeof toInvoiceRow>> & { summary: InvoicePageSummary }> {
  if (!x.actor.grants['invoices:read']) throw forbidden();
  const today = localDate(x.deps.now(), x.org.timezone);
  const status = invoiceStatusSql(today);
  const inCurrency = sql`${invoices.currency} = ${x.org.currency}`;
  const groups = await x.tx
    .select({
      status,
      n: sql<number>`count(*)::int`,
      balance: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}) filter (where ${inCurrency}), 0)::bigint`,
      paid: sql<number>`coalesce(sum(${invoices.paidMinor}) filter (where ${inCurrency}), 0)::bigint`,
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(invoiceWhere(q, today, false), clientFilter(x, 'invoices:read', invoices.clientId)))
    // By position: the status expression carries a parameter, so repeating it would not match the select list.
    .groupBy(sql`1`);
  const rows = await x.tx
    .select({ i: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(invoiceWhere(q, today), clientFilter(x, 'invoices:read', invoices.clientId)))
    .orderBy(...invoiceOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const counts: InvoicePageSummary['counts'] = { ALL: 0, DRAFT: 0, SENT: 0, PARTIALLY_PAID: 0, OVERDUE: 0, PAID: 0, VOID: 0 };
  let outstanding = 0;
  let overdue = 0;
  let collected = 0;
  for (const g of groups) {
    counts[g.status] = g.n;
    counts.ALL += g.n;
    collected += Number(g.paid);
    // Open invoices are the ones still waiting for money; a void invoice owes nothing.
    if (g.status === 'SENT' || g.status === 'PARTIALLY_PAID' || g.status === 'OVERDUE') outstanding += Number(g.balance);
    if (g.status === 'OVERDUE') overdue += Number(g.balance);
  }
  const open = counts.SENT + counts.PARTIALLY_PAID + counts.OVERDUE;
  const total = q.status === 'OPEN' ? open : q.status && q.status !== 'ALL' ? (counts[q.status as InvoiceStatusKey] ?? 0) : counts.ALL;
  return {
    data: rows.map((r) => toInvoiceRow(r, today)),
    total,
    page: q.page,
    page_size: q.pageSize,
    summary: { counts, open_count: open, overdue_count: counts.OVERDUE, outstanding_minor: outstanding, overdue_minor: overdue, collected_minor: collected, currency: x.org.currency },
  };
}

function toInvoiceRow({ i, clientName }: { i: typeof invoices.$inferSelect; clientName: string }, today: string) {
  return {
    id: i.id,
    number: i.number,
    client_id: i.clientId,
    client_name: clientName,
    status: deriveInvoiceStatus({ explicit: i.status, totalMinor: i.totalMinor, paidMinor: i.paidMinor, dueDate: i.dueDate, today }),
    issue_date: i.issueDate,
    due_date: i.dueDate,
    period_start: i.periodStart,
    period_end: i.periodEnd,
    currency: i.currency,
    subtotal_minor: i.subtotalMinor,
    tax_minor: i.taxMinor,
    total_minor: i.totalMinor,
    paid_minor: i.paidMinor,
    balance_minor: i.status === 'VOID' ? 0 : i.totalMinor - i.paidMinor,
  };
}

export async function getInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:read']) throw forbidden();
  // Looked up by id directly, so any invoice opens, however old (not only the newest 1000).
  if (!isUuid(id)) throw notFound('invoice');
  const [found] = await x.tx.select({ i: invoices, clientName: clients.name }).from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId)).where(eq(invoices.id, id));
  // A narrower scope than org reads only the invoices of its assigned projects' clients (A2b).
  if (!found || !(await canOnClient(x, 'invoices:read', found.i.clientId))) throw notFound('invoice');
  const inv = toInvoiceRow(found, localDate(x.deps.now(), x.org.timezone));
  const raw = found.i;
  const lines = await x.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position));
  const [client] = await x.tx.select().from(clients).where(eq(clients.id, inv.client_id));
  const allocs = await x.tx
    .select({ a: paymentAllocations, p: payments })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, id));
  return {
    ...inv,
    notes: raw?.notes ?? null,
    sent_at: raw?.sentAt?.toISOString() ?? null,
    client: { name: client?.name ?? '', email: client?.email ?? null, address: client?.address ?? null, contact_name: client?.contactName ?? null },
    lines: lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: l.quantity, unit_price_minor: l.unitPriceMinor, tax_rate_bps: l.taxRateBps, amount_minor: l.amountMinor, tax_minor: l.taxMinor })),
    payments: allocs.map(({ a, p }) => ({ payment_id: p.id, amount_minor: a.amountMinor, received_on: p.receivedOn, provider: p.provider, provider_ref: p.providerRef })),
  };
}

export async function sendInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const inv = await getInvoice(x, id);
  await assertCanManageInvoicesFor(x, inv.client_id);
  if (inv.status !== 'DRAFT') throw businessRule('invoice_not_draft', 'Only draft invoices can be sent');
  await x.tx.update(invoices).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, id));
  if (inv.client.email) {
    const fmt = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency }).format(m / 100);
    await x.deps.mailer.send(
      renderEmail(
        {
          subject: `Invoice ${inv.number} from ${x.org.name}`,
          preheader: `${fmt(inv.total_minor)} due ${inv.due_date}`,
          heading: `Invoice ${inv.number}`,
          paragraphs: [`${x.org.name} sent you invoice ${inv.number}.`],
          details: [
            ...inv.lines.map((l) => ({ label: l.description, value: fmt(l.amount_minor) })),
            { label: 'Amount due', value: fmt(inv.total_minor), strong: true },
            { label: 'Due date', value: inv.due_date },
          ],
          note: `Questions about this invoice? Reply to ${x.org.name} directly.`,
          reason: `You received this email because ${x.org.name} sent you an invoice through WorkPulse.`,
        },
        { appUrl: x.deps.config.appUrl, to: inv.client.email },
      ),
    );
  }
  await emitFrom(x, 'invoice.sent', { invoice_id: id, number: inv.number });
  await audit(x, { action: 'invoice.sent', targetType: 'invoice', targetId: id });
  return getInvoice(x, id);
}

export async function voidInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const inv = await getInvoice(x, id);
  await assertCanManageInvoicesFor(x, inv.client_id);
  if (inv.status === 'VOID') return inv;
  if (inv.paid_minor > 0) throw businessRule('invoice_has_payments', 'Remove payments before voiding this invoice');
  // Conditional: a payment recorded at the same moment either lands first (and the void is refused)
  // or finds the invoice void (and is refused). Before, both could commit: a void invoice holding money.
  const [voided] = await x.tx
    .update(invoices)
    .set({ status: 'VOID', voidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, id), ne(invoices.status, 'VOID'), eq(invoices.paidMinor, 0)))
    .returning({ id: invoices.id });
  if (!voided) {
    const [now] = await x.tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id));
    if (now?.status === 'VOID') return getInvoice(x, id);
    throw businessRule('invoice_has_payments', 'Remove payments before voiding this invoice');
  }
  const lineIds = inv.lines.map((l) => l.id);
  if (lineIds.length) {
    await x.tx.update(billingEntries).set({ invoiceLineId: null }).where(inArray(billingEntries.invoiceLineId, lineIds));
    await x.tx.update(expenses).set({ invoiceLineId: null }).where(inArray(expenses.invoiceLineId, lineIds));
  }
  await emitFrom(x, 'invoice.voided', { invoice_id: id });
  await audit(x, { action: 'invoice.voided', targetType: 'invoice', targetId: id });
  return getInvoice(x, id);
}

// ─── Payments ────────────────────────────────────────────────────────────────
type PaymentQuery = { from?: string; to?: string; search?: string };

/** Payments matching the filters. The search covers the client, reference, note and the invoices paid. */
function paymentWhere(x: Ctx, q: PaymentQuery) {
  const term = q.search ? likePattern(q.search) : null;
  return and(
    // A narrower scope than org sees the payments of its assigned projects' clients only (A2b).
    clientFilter(x, 'payments:read', payments.clientId),
    q.from ? gte(payments.receivedOn, q.from) : undefined,
    q.to ? lte(payments.receivedOn, q.to) : undefined,
    term
      ? or(
          ilike(clients.name, term),
          ilike(payments.providerRef, term),
          ilike(payments.note, term),
          inArray(payments.id, x.tx.select({ id: paymentAllocations.paymentId }).from(paymentAllocations).innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId)).where(ilike(invoices.number, term))),
        )
      : undefined,
  );
}

const paymentOrder = [desc(payments.receivedOn), desc(payments.id)];

/**
 * Payments as a plain array, newest first. Capped at 1000 unless `limit` is null (reports, which
 * are bounded by their date range); use `pagePayments` to reach every payment.
 */
export async function listPayments(x: Ctx, q: PaymentQuery = {}, limit: number | null = 1000) {
  if (!x.actor.grants['payments:read']) throw forbidden();
  const base = x.tx.select({ p: payments, clientName: clients.name }).from(payments).leftJoin(clients, eq(clients.id, payments.clientId)).where(paymentWhere(x, q)).orderBy(...paymentOrder);
  return toPaymentRows(x, limit === null ? await base : await base.limit(limit));
}

/** One numbered page of payments (`page` is 1-based) and the total. */
export async function pagePayments(x: Ctx, q: PaymentQuery & { page: number; pageSize: number }): Promise<OffsetPage<Awaited<ReturnType<typeof toPaymentRows>>[number]>> {
  if (!x.actor.grants['payments:read']) throw forbidden();
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(payments).leftJoin(clients, eq(clients.id, payments.clientId)).where(paymentWhere(x, q));
  const rows = await x.tx
    .select({ p: payments, clientName: clients.name })
    .from(payments)
    .leftJoin(clients, eq(clients.id, payments.clientId))
    .where(paymentWhere(x, q))
    .orderBy(...paymentOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: await toPaymentRows(x, rows), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

async function toPaymentRows(x: Ctx, rows: Array<{ p: typeof payments.$inferSelect; clientName: string | null }>) {
  const allocs = rows.length ? await x.tx.select({ a: paymentAllocations, number: invoices.number }).from(paymentAllocations).innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId)).where(inArray(paymentAllocations.paymentId, rows.map((r) => r.p.id))) : [];
  return rows.map(({ p, clientName }) => ({
    id: p.id,
    client_id: p.clientId,
    client_name: clientName,
    provider: p.provider,
    provider_ref: p.providerRef,
    amount_minor: p.amountMinor,
    currency: p.currency,
    received_on: p.receivedOn,
    status: p.status,
    note: p.note,
    allocations: allocs.filter((a) => a.a.paymentId === p.id).map((a) => ({ invoice_id: a.a.invoiceId, invoice_number: a.number, amount_minor: a.a.amountMinor })),
  }));
}

export async function recordPayment(x: Ctx, input: z.infer<typeof paymentInput>) {
  if (!x.actor.grants['payments:manage']) throw forbidden();
  if (x.actor.grants['payments:manage'] !== 'org' && (!input.client_id || !(await canOnClient(x, 'payments:manage', input.client_id)))) throw forbidden('Your role can record payments only for the clients of your projects');
  // The client must be one of this organization's (TEN-001), at every scope.
  if (input.client_id && !(await existsInOrg(x, 'client', input.client_id))) throw notFound('client');
  const allocated = input.allocations.reduce((s, a) => s + a.amount_minor, 0);
  if (allocated > input.amount_minor) throw validation('Allocations exceed the payment amount');
  const id = newId();
  // A reference (cheque number, transfer id) is recorded once per organization.
  const [created] = await x.tx
    .insert(payments)
    .values({ id, organizationId: x.org.id, clientId: input.client_id ?? null, provider: input.provider, providerRef: input.provider_ref ?? null, amountMinor: input.amount_minor, currency: input.currency, receivedOn: input.received_on, note: input.note ?? null, createdBy: x.actor.membershipId })
    .onConflictDoNothing()
    .returning({ id: payments.id });
  if (!created) throw conflict('duplicate_payment', `A payment with reference ${input.provider_ref} is already recorded`, { errors: [{ field: 'provider_ref', message: 'Already recorded' }] });
  for (const a of input.allocations) {
    const [inv] = await x.tx.select().from(invoices).where(eq(invoices.id, a.invoice_id));
    if (!inv) throw notFound('invoice');
    if (inv.status === 'VOID' || inv.status === 'DRAFT') throw businessRule('invoice_not_payable', `Invoice ${inv.number} is not open`);
    if (inv.currency !== input.currency) throw businessRule('currency_mismatch', `Invoice ${inv.number} is in ${inv.currency}`);
    if (input.client_id && inv.clientId !== input.client_id) throw businessRule('client_mismatch', `Invoice ${inv.number} belongs to another client`);
    // Conditional increment: two payments recorded at once cannot push an invoice past its total, and
    // an invoice voided meanwhile takes no money.
    const [paid] = await x.tx
      .update(invoices)
      .set({ paidMinor: sql`${invoices.paidMinor} + ${a.amount_minor}`, updatedAt: new Date() })
      .where(and(eq(invoices.id, a.invoice_id), eq(invoices.status, 'SENT'), sql`${invoices.paidMinor} + ${a.amount_minor} <= ${invoices.totalMinor}`))
      .returning({ paidMinor: invoices.paidMinor, totalMinor: invoices.totalMinor });
    if (!paid) {
      const [now] = await x.tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, a.invoice_id));
      if (now?.status !== 'SENT') throw businessRule('invoice_not_payable', `Invoice ${inv.number} is not open`);
      throw businessRule('overpayment', `Payment exceeds the balance of ${inv.number}`);
    }
    await x.tx.insert(paymentAllocations).values({ id: newId(), organizationId: x.org.id, paymentId: id, invoiceId: a.invoice_id, amountMinor: a.amount_minor });
    if (paid.paidMinor >= paid.totalMinor) await emitFrom(x, 'invoice.paid', { invoice_id: inv.id, number: inv.number });
  }
  await emitFrom(x, 'payment.received', { payment_id: id, amount_minor: input.amount_minor, currency: input.currency });
  await audit(x, { action: 'payment.recorded', targetType: 'payment', targetId: id, after: input });
  return (await listPayments(x)).find((p) => p.id === id)!;
}

/** Delete a payment and reverse its allocations (e.g. recorded by mistake). */
export async function deletePayment(x: Ctx, id: string) {
  if (!x.actor.grants['payments:manage']) throw forbidden();
  if (x.actor.grants['payments:manage'] !== 'org') {
    const [existing] = isUuid(id) ? await x.tx.select({ clientId: payments.clientId }).from(payments).where(eq(payments.id, id)) : [];
    if (!existing?.clientId || !(await canOnClient(x, 'payments:manage', existing.clientId))) throw notFound('payment');
  }
  const allocs = await x.tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
  // Delete first: of two deletes sent at once only one gets the row back and reverses the allocations
  // (before, both did and the invoice lost the payment twice).
  const [p] = await x.tx.delete(payments).where(eq(payments.id, id)).returning();
  if (!p) throw notFound('payment');
  for (const a of allocs) {
    await x.tx.update(invoices).set({ paidMinor: sql`greatest(0, ${invoices.paidMinor} - ${a.amountMinor})`, updatedAt: new Date() }).where(eq(invoices.id, a.invoiceId));
  }
  await audit(x, { action: 'payment.deleted', targetType: 'payment', targetId: id, before: { ...p, allocations: allocs } });
}

export async function updateDraftInvoice(x: Ctx, id: string, input: z.infer<typeof invoiceDraftUpdateInput>) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const [inv] = isUuid(id) ? await x.tx.select().from(invoices).where(eq(invoices.id, id)) : [];
  if (!inv || !(await canOnClient(x, 'invoices:manage', inv.clientId))) throw notFound('invoice');
  if (inv.status !== 'DRAFT') throw businessRule('invoice_not_draft', 'Only draft invoices can be edited');
  const issue = input.issue_date ?? inv.issueDate;
  const due = input.due_date ?? inv.dueDate;
  if (due < issue) throw validation('The due date cannot be before the issue date', { errors: [{ field: 'due_date', message: 'The due date cannot be before the issue date' }] });
  await x.tx
    .update(invoices)
    .set({ issueDate: issue, dueDate: due, ...(input.notes !== undefined ? { notes: input.notes } : {}), updatedAt: new Date() })
    .where(eq(invoices.id, id));
  await audit(x, { action: 'invoice.updated', targetType: 'invoice', targetId: id, before: { issue_date: inv.issueDate, due_date: inv.dueDate }, after: { issue_date: issue, due_date: due } });
  return getInvoice(x, id);
}

/** Draft invoices can be deleted outright (their time and expenses become invoiceable again). */
export async function deleteDraftInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const [inv] = isUuid(id) ? await x.tx.select().from(invoices).where(eq(invoices.id, id)) : [];
  if (!inv || !(await canOnClient(x, 'invoices:manage', inv.clientId))) throw notFound('invoice');
  if (inv.status !== 'DRAFT') throw businessRule('invoice_not_draft', 'Only draft invoices can be deleted; void sent invoices instead');
  const lineIds = (await x.tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).map((l) => l.id);
  if (lineIds.length) {
    await x.tx.update(billingEntries).set({ invoiceLineId: null }).where(inArray(billingEntries.invoiceLineId, lineIds));
    await x.tx.update(expenses).set({ invoiceLineId: null }).where(inArray(expenses.invoiceLineId, lineIds));
  }
  await x.tx.delete(invoices).where(eq(invoices.id, id));
  await audit(x, { action: 'invoice.deleted', targetType: 'invoice', targetId: id, before: { number: inv.number, total: inv.totalMinor } });
}
