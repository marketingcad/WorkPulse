import { periodFor } from '@tallywork/domain';
import type { Period, PayrollRunFacts } from '@tallywork/domain/insights';
import type { Ctx } from '../ctx';
import { amountsOwed, listPayments, pageInvoices } from '../finance';
import { getPayrollRun, listPayrollRuns } from '../payroll';

/**
 * Finance inputs, each part only when the person holds its permission (null otherwise, which the
 * rules turn into a limitation). Amounts are the finance services' own, in minor units with their
 * currency; nothing here prices or recomputes anything.
 */
const has = (x: Ctx, p: string) => x.actor.grants[p as keyof typeof x.actor.grants] !== undefined;

export const mayReadFinance = (x: Ctx) => ['payroll:read', 'invoices:read', 'payments:read', 'billing:read', 'rates:read'].some((p) => has(x, p));

export async function financeInputs(x: Ctx, period: Period, previous: Period, today: string) {
  let payroll: PayrollRunFacts[] | null = null;
  if (has(x, 'payroll:read')) {
    const year = Number(today.slice(0, 4));
    const runs = [...(await listPayrollRuns(x, { year })), ...(await listPayrollRuns(x, { year: year - 1 }))].filter((r) => r.status === 'FINALIZED' || r.status === 'PAID');
    // The latest two runs per currency, with overtime from their lines (only those runs are opened).
    const latest = new Map<string, typeof runs>();
    for (const r of [...runs].sort((a, b) => b.period_start.localeCompare(a.period_start))) {
      const list = latest.get(r.currency) ?? [];
      if (list.length < 2) latest.set(r.currency, [...list, r]);
    }
    payroll = [];
    for (const list of latest.values()) {
      for (const r of list) {
        const full = await getPayrollRun(x, r.id);
        const overtimeSeconds = (full.lines ?? []).reduce((s, l) => s + (l.overtime_seconds ?? 0), 0);
        payroll.push({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, status: r.status, currency: r.currency, grossMinor: r.gross_minor, netMinor: r.net_minor, overtimeSeconds });
      }
    }
  }

  let owedEstimate: Array<{ currency: string; approvedMinor: number; estimatedMinor: number }> | null = null;
  if (has(x, 'billing:read') || has(x, 'rates:read')) {
    // The current pay period, priced by the existing rules: approved time at its approved amount, the
    // rest at today's effective rates. `estimated_amount_minor` already includes the approved part.
    const p = periodFor(today, x.org.payPeriod, x.org.weekStart);
    const rows = await amountsOwed(x, p.start, p.end);
    const byCurrency = new Map<string, { approvedMinor: number; estimatedMinor: number }>();
    for (const r of rows) {
      const cur = byCurrency.get(r.currency) ?? { approvedMinor: 0, estimatedMinor: 0 };
      cur.approvedMinor += r.approved_amount_minor;
      cur.estimatedMinor += Math.max(0, r.estimated_amount_minor - r.approved_amount_minor);
      byCurrency.set(r.currency, cur);
    }
    owedEstimate = [...byCurrency].map(([currency, v]) => ({ currency, ...v }));
  }

  let billing: { currency: string; outstandingMinor: number; overdueMinor: number; overdueCount: number; collectedMinor: number; previousCollectedMinor: number } | null = null;
  if (has(x, 'invoices:read') || has(x, 'payments:read')) {
    const currency = x.org.currency;
    billing = { currency, outstandingMinor: 0, overdueMinor: 0, overdueCount: 0, collectedMinor: 0, previousCollectedMinor: 0 };
    if (has(x, 'invoices:read')) {
      const s = (await pageInvoices(x, { page: 1, pageSize: 1 })).summary;
      billing = { ...billing, outstandingMinor: s.outstanding_minor, overdueMinor: s.overdue_minor, overdueCount: s.overdue_count };
    }
    if (has(x, 'payments:read')) {
      // Organization currency only: other currencies are never added in.
      const sum = async (p: Period) => (await listPayments(x, { from: p.from, to: p.to })).filter((r) => r.currency === currency).reduce((s, r) => s + r.amount_minor, 0);
      billing = { ...billing, collectedMinor: await sum(period), previousCollectedMinor: await sum(previous) };
    }
  }
  return { payroll, owedEstimate, billing };
}
