/**
 * Money is integer minor units (cents) + ISO currency. Rates are per hour.
 * Tracked time is never assumed to be billable: billable is a separate classification.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

export type RateKind = 'PAY' | 'BILL';
export type RateScope = 'ORG' | 'CLIENT' | 'PROJECT' | 'WORKER' | 'PROJECT_WORKER';

export interface Rate {
  id: string;
  kind: RateKind;
  scope: RateScope;
  /** client id, project id, membership id, or `${projectId}:${membershipId}`; null for ORG */
  scopeId: string | null;
  amountMinor: number;
  currency: string;
  effectiveFrom: string; // ISO date inclusive
  effectiveTo: string | null; // ISO date exclusive
}

/** Which rate wins, most specific first (the engine and every screen that explains it use this). */
export const RATE_PRECEDENCE: Record<RateKind, RateScope[]> = {
  BILL: ['PROJECT_WORKER', 'PROJECT', 'WORKER', 'CLIENT', 'ORG'],
  PAY: ['PROJECT_WORKER', 'WORKER', 'PROJECT', 'CLIENT', 'ORG'],
};

export interface RateContext {
  date: string;
  membershipId: string;
  projectId: string | null;
  clientId: string | null;
}

/** Most specific rate effective on `ctx.date` wins. */
export function resolveRate(rates: Rate[], kind: RateKind, ctx: RateContext): Rate | null {
  const effective = rates.filter(
    (r) => r.kind === kind && r.effectiveFrom <= ctx.date && (r.effectiveTo === null || ctx.date < r.effectiveTo),
  );
  for (const scope of RATE_PRECEDENCE[kind]) {
    const id =
      scope === 'ORG'
        ? null
        : scope === 'CLIENT'
          ? ctx.clientId
          : scope === 'PROJECT'
            ? ctx.projectId
            : scope === 'WORKER'
              ? ctx.membershipId
              : ctx.projectId
                ? `${ctx.projectId}:${ctx.membershipId}`
                : undefined;
    if (id === undefined || (scope !== 'ORG' && id === null)) continue;
    const match = effective
      .filter((r) => r.scope === scope && r.scopeId === id)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (match) return match;
  }
  return null;
}

/** Amount for `seconds` at an hourly rate, rounded half-up to the minor unit. */
export function amountForSeconds(seconds: number, hourlyMinor: number): number {
  return Math.round((seconds * hourlyMinor) / 3600);
}

export type BudgetState = 'healthy' | 'warning' | 'exceeded';

export interface BudgetStatus {
  spent: number;
  budget: number;
  remaining: number;
  pctUsed: number;
  state: BudgetState;
  /** projected total at period end based on the average daily burn so far */
  projected: number | null;
}

export function budgetStatus(input: {
  budget: number;
  spent: number;
  warnPct: number;
  daysElapsed?: number;
  daysTotal?: number;
}): BudgetStatus {
  const { budget, spent, warnPct } = input;
  const pctUsed = budget <= 0 ? 0 : Math.round((spent / budget) * 1000) / 10;
  const state: BudgetState = spent > budget ? 'exceeded' : pctUsed >= warnPct ? 'warning' : 'healthy';
  let projected: number | null = null;
  if (input.daysElapsed && input.daysTotal && input.daysElapsed > 0) {
    projected = Math.round((spent / input.daysElapsed) * input.daysTotal);
  }
  return { spent, budget, remaining: budget - spent, pctUsed, state, projected };
}

/** Threshold levels crossed going from `before` to `after` (for once-per-level notifications). */
export function crossedThresholds(beforePct: number, afterPct: number, levels: number[]): number[] {
  return levels.filter((l) => beforePct < l && afterPct >= l);
}

export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceLineInput {
  quantity: number; // hours for time lines (decimal), units otherwise
  unitPriceMinor: number;
  taxRateBps: number; // 1000 = 10.00%
}

export interface InvoiceTotals {
  lines: Array<{ amountMinor: number; taxMinor: number }>;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Tax is computed per line then summed (documented rounding rule). */
export function invoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  const out = lines.map((l) => {
    const amountMinor = Math.round(l.quantity * l.unitPriceMinor);
    const taxMinor = Math.round((amountMinor * l.taxRateBps) / 10000);
    return { amountMinor, taxMinor };
  });
  const subtotalMinor = out.reduce((s, l) => s + l.amountMinor, 0);
  const taxMinor = out.reduce((s, l) => s + l.taxMinor, 0);
  return { lines: out, subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Invoice status derived from allocations and due date. DRAFT and VOID are explicit. */
export function deriveInvoiceStatus(input: {
  explicit: 'DRAFT' | 'SENT' | 'VOID';
  totalMinor: number;
  paidMinor: number;
  dueDate: string;
  today: string;
}): InvoiceStatus {
  if (input.explicit === 'DRAFT' || input.explicit === 'VOID') return input.explicit;
  if (input.paidMinor >= input.totalMinor && input.totalMinor > 0) return 'PAID';
  if (input.today > input.dueDate) return 'OVERDUE';
  if (input.paidMinor > 0) return 'PARTIALLY_PAID';
  return 'SENT';
}

export function formatMoney(m: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amountMinor / 100);
}
