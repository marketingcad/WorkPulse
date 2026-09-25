import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
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
  paymentAllocations,
  payments,
  projects,
  rollupWorkerDay,
  tasks,
  users,
  type Tx,
} from '@tallywork/db';
import {
  amountForSeconds,
  budgetStatus,
  businessRule,
  can,
  conflict,
  crossedThresholds,
  deriveInvoiceStatus,
  forbidden,
  invoiceTotals,
  localDate,
  newId,
  notFound,
  resolveRate,
  validation,
  type Rate,
} from '@tallywork/domain';
import type { BudgetStatusDto, budgetInput, expenseInput, invoiceCreateInput, paymentInput, rateInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, emit, emitFrom } from './events';
import { narrowMemberships } from './scope';
import { memberNames } from './timer';
import { membersWith, notify } from './notify';

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
export async function setRate(x: Ctx, input: z.infer<typeof rateInput>) {
  if (!x.actor.grants['rates:manage']) throw forbidden();
  const scopeId = input.scope === 'ORG' ? null : (input.scope_id ?? null);
  if (input.scope !== 'ORG' && !scopeId) throw validation('scope_id is required for this scope');
  const prev = await x.tx
    .select()
    .from(billingRates)
    .where(and(eq(billingRates.kind, input.kind), eq(billingRates.scope, input.scope), scopeId ? eq(billingRates.scopeId, scopeId) : isNull(billingRates.scopeId), isNull(billingRates.effectiveTo)));
  for (const p of prev) {
    if (p.effectiveFrom >= input.effective_from) {
      // Superseded before it started. A rate that already priced approved time is kept (as an
      // empty window) so billing history still points at it; approved amounts never change.
      if (await rateInUse(x.tx, p.id)) await x.tx.update(billingRates).set({ effectiveTo: p.effectiveFrom, updatedAt: new Date() }).where(eq(billingRates.id, p.id));
      else await x.tx.delete(billingRates).where(eq(billingRates.id, p.id));
    } else {
      await x.tx.update(billingRates).set({ effectiveTo: input.effective_from, updatedAt: new Date() }).where(eq(billingRates.id, p.id));
    }
  }
  const id = newId();
  await x.tx.insert(billingRates).values({ id, organizationId: x.org.id, kind: input.kind, scope: input.scope, scopeId, amountMinor: input.amount_minor, currency: input.currency, effectiveFrom: input.effective_from, createdBy: x.actor.membershipId });
  await audit(x, { action: 'rate.set', targetType: 'rate', targetId: id, before: prev, after: input });
  return listRates(x);
}

export async function deleteRate(x: Ctx, id: string) {
  if (!x.actor.grants['rates:manage']) throw forbidden();
  const [r] = await x.tx.select().from(billingRates).where(eq(billingRates.id, id));
  if (!r) throw notFound('rate');
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

async function budgetSpent(tx: Tx, b: typeof budgets.$inferSelect, rates: Rate[], today: string): Promise<{ spent: number; from: string | null; to: string | null; daysElapsed?: number; daysTotal?: number }> {
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
  const projectIds =
    b.subjectType === 'PROJECT' ? [b.subjectId] : (await tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, b.subjectId))).map((p) => p.id);
  if (!projectIds.length) return { spent: 0, from, to, daysElapsed, daysTotal };
  const rows = await tx
    .select()
    .from(rollupWorkerDay)
    .where(
      and(
        inArray(rollupWorkerDay.projectId, projectIds),
        from ? gte(rollupWorkerDay.localDate, from) : undefined,
        to ? lte(rollupWorkerDay.localDate, to) : undefined,
        b.includeNonBillable ? undefined : eq(rollupWorkerDay.billable, true),
      ),
    );
  let spent = 0;
  if (b.kind === 'HOURS') spent = rows.reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0);
  else {
    // Approved time counts at the amount it was billed at (a later rate change does not reprice it);
    // time not yet approved is estimated at the current rate.
    const approved = await tx
      .select({ m: billingEntries.membershipId, p: billingEntries.projectId, d: billingEntries.localDate, billable: billingEntries.billable, secs: sql<number>`sum(${billingEntries.seconds})::int`, amount: sql<number>`sum(${billingEntries.billAmountMinor})::bigint` })
      .from(billingEntries)
      .where(and(isNull(billingEntries.voidedAt), inArray(billingEntries.projectId, projectIds), from ? gte(billingEntries.localDate, from) : undefined, to ? lte(billingEntries.localDate, to) : undefined, b.includeNonBillable ? undefined : eq(billingEntries.billable, true)))
      .groupBy(billingEntries.membershipId, billingEntries.projectId, billingEntries.localDate, billingEntries.billable);
    const byKey = new Map(approved.map((a) => [`${a.m}|${a.p}|${a.d}|${a.billable}`, a]));
    const clientOf = new Map((await tx.select({ id: projects.id, c: projects.clientId }).from(projects).where(inArray(projects.id, projectIds))).map((p) => [p.id, p.c]));
    for (const r of rows) {
      const a = byKey.get(`${r.membershipId}|${r.projectId}|${r.localDate}|${r.billable}`);
      const rest = Math.max(0, r.trackedSeconds + r.manualSeconds - (a?.secs ?? 0));
      const rate = rest > 0 ? resolveRate(rates, 'BILL', { date: r.localDate, membershipId: r.membershipId, projectId: r.projectId, clientId: clientOf.get(r.projectId) ?? null }) : null;
      spent += (rate ? amountForSeconds(rest, rate.amountMinor) : 0) + Number(a?.amount ?? 0);
      byKey.delete(`${r.membershipId}|${r.projectId}|${r.localDate}|${r.billable}`);
    }
    for (const a of byKey.values()) spent += Number(a.amount);
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
    const s = await budgetSpent(tx, b, rates, today);
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

export async function listBudgets(x: Ctx) {
  const scope = x.actor.grants['budgets:read'];
  if (!scope) throw forbidden();
  const today = localDate(x.deps.now(), x.org.timezone);
  const all = await budgetStatuses(x.tx, x.org.currency, today);
  if (scope === 'org') return all;
  return all.filter((b) => b.subject_type === 'PROJECT' && x.actor.assignedProjectIds.has(b.subject_id));
}

export async function upsertBudget(x: Ctx, input: z.infer<typeof budgetInput>) {
  if (!x.actor.grants['budgets:manage']) throw forbidden();
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
  const rows = await x.tx
    .select()
    .from(rollupWorkerDay)
    .where(and(gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to), visible === 'all' ? undefined : inArray(rollupWorkerDay.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000'])));
  const approved = await x.tx
    .select({ m: billingEntries.membershipId, s: sql<number>`sum(${billingEntries.seconds})::int`, pay: sql<number>`sum(${billingEntries.payAmountMinor})::bigint` })
    .from(billingEntries)
    .where(and(isNull(billingEntries.voidedAt), gte(billingEntries.localDate, from), lte(billingEntries.localDate, to)))
    .groupBy(billingEntries.membershipId);
  const rates = await loadRates(x.tx);
  const byWorker = new Map<string, { seconds: number; estimated: number }>();
  for (const r of rows) {
    const secs = r.trackedSeconds + r.manualSeconds;
    const rate = resolveRate(rates, 'PAY', { date: r.localDate, membershipId: r.membershipId, projectId: r.projectId, clientId: null });
    const w = byWorker.get(r.membershipId) ?? { seconds: 0, estimated: 0 };
    w.seconds += secs;
    w.estimated += rate ? amountForSeconds(secs, rate.amountMinor) : 0;
    byWorker.set(r.membershipId, w);
  }
  const names = await memberNames(x, [...byWorker.keys()]);
  return [...byWorker.entries()]
    .map(([m, w]) => {
      const a = approved.find((ap) => ap.m === m);
      return { membership_id: m, worker_name: names.get(m) ?? '', tracked_seconds: w.seconds, approved_seconds: a?.s ?? 0, approved_amount_minor: Number(a?.pay ?? 0), estimated_amount_minor: w.estimated, currency: x.org.currency };
    })
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name));
}

// ─── Expenses ────────────────────────────────────────────────────────────────
export async function listExpenses(x: Ctx, q: { status?: string; from?: string; to?: string }) {
  const visible = narrowMemberships(x.actor, 'expenses:read');
  const rows = await x.tx
    .select({ e: expenses, projectName: projects.name, clientName: clients.name })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(
      and(
        q.status ? eq(expenses.status, q.status as 'SUBMITTED') : undefined,
        q.from ? gte(expenses.spentOn, q.from) : undefined,
        q.to ? lte(expenses.spentOn, q.to) : undefined,
        visible === 'all' ? undefined : inArray(expenses.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
      ),
    )
    .orderBy(desc(expenses.spentOn))
    .limit(1000);
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
    const [f] = await x.tx.select().from(fileObjects).where(eq(fileObjects.id, input.receipt_file_id));
    if (!f || f.purpose !== 'RECEIPT') throw notFound('receipt');
  }
  let clientId = input.client_id ?? null;
  if (input.project_id) {
    const [p] = await x.tx.select().from(projects).where(eq(projects.id, input.project_id));
    if (!p) throw notFound('project');
    clientId ??= p.clientId;
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
  await x.tx
    .update(expenses)
    .set({ status: next, decidedBy: x.actor.membershipId, decidedAt: new Date(), ...(action === 'REIMBURSE' ? { reimbursedAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(expenses.id, id));
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
  if (input.period_end < input.period_start) throw validation('Period end must be after period start');
  const currency = client.currency ?? x.org.currency;
  const entries = await x.tx
    .select({ b: billingEntries, projectName: projects.name, taskTitle: tasks.title, workerName: users.name, rateAmount: billingRates.amountMinor })
    .from(billingEntries)
    .leftJoin(billingRates, eq(billingRates.id, billingEntries.billRateId))
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
  const groups = new Map<string, DraftLine & { seconds: number }>();
  for (const { b, projectName, taskTitle, workerName, rateAmount } of entries) {
    const label = input.group_by === 'task' ? `${projectName} — ${taskTitle ?? 'No task'}` : input.group_by === 'worker' ? `${projectName} — ${workerName}` : projectName;
    // One line per label and rate. The line amount is the exact sum of the billed amounts, so the
    // invoice reconciles with approved billing; the unit price is the rate itself.
    const hourly = rateAmount ?? (b.seconds > 0 ? Math.round((b.billAmountMinor * 3600) / b.seconds) : 0);
    const key = `${label}|${b.billRateId ?? hourly}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind: 'TIME', description: label, quantity: 0, unitPriceMinor: hourly, amountMinor: 0, taxRateBps: input.tax_rate_bps, projectId: b.projectId, billingEntryIds: [], expenseIds: [], seconds: 0 };
      groups.set(key, g);
    }
    g.seconds += b.seconds;
    g.amountMinor += b.billAmountMinor;
    g.billingEntryIds.push(b.id);
  }
  const lines: DraftLine[] = [...groups.values()].map((g) => ({ ...g, quantity: Math.round((g.seconds / 3600) * 10000) / 10000 }));
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

export async function previewInvoice(x: Ctx, input: z.infer<typeof invoiceCreateInput>) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
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
  if (!x.actor.grants['invoices:manage']) throw forbidden();
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

export async function listInvoices(x: Ctx, q: { status?: string; clientId?: string }) {
  if (!x.actor.grants['invoices:read']) throw forbidden();
  const today = localDate(x.deps.now(), x.org.timezone);
  const rows = await x.tx
    .select({ i: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(q.clientId ? eq(invoices.clientId, q.clientId) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(1000);
  const list = rows.map(({ i, clientName }) => ({
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
  }));
  return q.status ? list.filter((i) => i.status === q.status) : list;
}

export async function getInvoice(x: Ctx, id: string) {
  const [inv] = (await listInvoices(x, {})).filter((i) => i.id === id);
  if (!inv) throw notFound('invoice');
  const lines = await x.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position));
  const [raw] = await x.tx.select().from(invoices).where(eq(invoices.id, id));
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
    client: { name: client?.name ?? '', email: client?.email ?? null, address: client?.address ?? null },
    lines: lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: l.quantity, unit_price_minor: l.unitPriceMinor, tax_rate_bps: l.taxRateBps, amount_minor: l.amountMinor, tax_minor: l.taxMinor })),
    payments: allocs.map(({ a, p }) => ({ payment_id: p.id, amount_minor: a.amountMinor, received_on: p.receivedOn, provider: p.provider, provider_ref: p.providerRef })),
  };
}

export async function sendInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const inv = await getInvoice(x, id);
  if (inv.status !== 'DRAFT') throw businessRule('invoice_not_draft', 'Only draft invoices can be sent');
  await x.tx.update(invoices).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, id));
  if (inv.client.email) {
    const fmt = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency }).format(m / 100);
    await x.deps.mailer.send({
      to: inv.client.email,
      subject: `Invoice ${inv.number} from ${x.org.name}`,
      text: `Invoice ${inv.number}\nAmount due: ${fmt(inv.total_minor)}\nDue date: ${inv.due_date}\n\n${inv.lines.map((l) => `- ${l.description}: ${fmt(l.amount_minor)}`).join('\n')}\n`,
    });
  }
  await emitFrom(x, 'invoice.sent', { invoice_id: id, number: inv.number });
  await audit(x, { action: 'invoice.sent', targetType: 'invoice', targetId: id });
  return getInvoice(x, id);
}

export async function voidInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const inv = await getInvoice(x, id);
  if (inv.status === 'VOID') return inv;
  if (inv.paid_minor > 0) throw businessRule('invoice_has_payments', 'Remove payments before voiding this invoice');
  const lineIds = inv.lines.map((l) => l.id);
  if (lineIds.length) {
    await x.tx.update(billingEntries).set({ invoiceLineId: null }).where(inArray(billingEntries.invoiceLineId, lineIds));
    await x.tx.update(expenses).set({ invoiceLineId: null }).where(inArray(expenses.invoiceLineId, lineIds));
  }
  await x.tx.update(invoices).set({ status: 'VOID', voidedAt: new Date(), updatedAt: new Date() }).where(eq(invoices.id, id));
  await emitFrom(x, 'invoice.voided', { invoice_id: id });
  await audit(x, { action: 'invoice.voided', targetType: 'invoice', targetId: id });
  return getInvoice(x, id);
}

// ─── Payments ────────────────────────────────────────────────────────────────
export async function listPayments(x: Ctx) {
  if (!x.actor.grants['payments:read']) throw forbidden();
  const rows = await x.tx.select({ p: payments, clientName: clients.name }).from(payments).leftJoin(clients, eq(clients.id, payments.clientId)).orderBy(desc(payments.receivedOn)).limit(1000);
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
  const allocated = input.allocations.reduce((s, a) => s + a.amount_minor, 0);
  if (allocated > input.amount_minor) throw validation('Allocations exceed the payment amount');
  const id = newId();
  await x.tx.insert(payments).values({ id, organizationId: x.org.id, clientId: input.client_id ?? null, provider: input.provider, providerRef: input.provider_ref ?? null, amountMinor: input.amount_minor, currency: input.currency, receivedOn: input.received_on, note: input.note ?? null, createdBy: x.actor.membershipId });
  for (const a of input.allocations) {
    const [inv] = await x.tx.select().from(invoices).where(eq(invoices.id, a.invoice_id));
    if (!inv) throw notFound('invoice');
    if (inv.status === 'VOID' || inv.status === 'DRAFT') throw businessRule('invoice_not_payable', `Invoice ${inv.number} is not open`);
    if (inv.currency !== input.currency) throw businessRule('currency_mismatch', `Invoice ${inv.number} is in ${inv.currency}`);
    if (input.client_id && inv.clientId !== input.client_id) throw businessRule('client_mismatch', `Invoice ${inv.number} belongs to another client`);
    // Conditional increment: two payments recorded at once cannot push an invoice past its total.
    const [paid] = await x.tx
      .update(invoices)
      .set({ paidMinor: sql`${invoices.paidMinor} + ${a.amount_minor}`, updatedAt: new Date() })
      .where(and(eq(invoices.id, a.invoice_id), sql`${invoices.paidMinor} + ${a.amount_minor} <= ${invoices.totalMinor}`))
      .returning({ paidMinor: invoices.paidMinor, totalMinor: invoices.totalMinor });
    if (!paid) throw businessRule('overpayment', `Payment exceeds the balance of ${inv.number}`);
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
  const [p] = await x.tx.select().from(payments).where(eq(payments.id, id));
  if (!p) throw notFound('payment');
  const allocs = await x.tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
  for (const a of allocs) {
    await x.tx.update(invoices).set({ paidMinor: sql`greatest(0, ${invoices.paidMinor} - ${a.amountMinor})`, updatedAt: new Date() }).where(eq(invoices.id, a.invoiceId));
  }
  await x.tx.delete(payments).where(eq(payments.id, id));
  await audit(x, { action: 'payment.deleted', targetType: 'payment', targetId: id, before: { ...p, allocations: allocs } });
}

/** Draft invoices can be deleted outright (their time and expenses become invoiceable again). */
export async function deleteDraftInvoice(x: Ctx, id: string) {
  if (!x.actor.grants['invoices:manage']) throw forbidden();
  const [inv] = await x.tx.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) throw notFound('invoice');
  if (inv.status !== 'DRAFT') throw businessRule('invoice_not_draft', 'Only draft invoices can be deleted; void sent invoices instead');
  const lineIds = (await x.tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id))).map((l) => l.id);
  if (lineIds.length) {
    await x.tx.update(billingEntries).set({ invoiceLineId: null }).where(inArray(billingEntries.invoiceLineId, lineIds));
    await x.tx.update(expenses).set({ invoiceLineId: null }).where(inArray(expenses.invoiceLineId, lineIds));
  }
  await x.tx.delete(invoices).where(eq(invoices.id, id));
  await audit(x, { action: 'invoice.deleted', targetType: 'invoice', targetId: id, before: { number: inv.number, total: inv.totalMinor } });
}
