import { findingId, percentChange } from './compare';
import type { Finding, Period } from './types';

/**
 * Payroll and billing insights from the existing finance services: amounts are integer minor units
 * with their currency, never added across currencies, and never recomputed here. A forecast is the
 * existing pricing of time not yet paid (approved at its approved price, the rest at today's rates),
 * labelled as an estimate.
 */
export interface PayrollRunFacts {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  currency: string;
  grossMinor: number;
  netMinor: number;
  overtimeSeconds: number;
}

const hours = (s: number) => Math.round(s / 36) / 100;

export function financeFindings(input: {
  period: Period;
  previous: Period;
  /** null: the person may not see payroll */
  payroll: PayrollRunFacts[] | null;
  /** null: the person may not see amounts owed */
  owedEstimate: Array<{ currency: string; approvedMinor: number; estimatedMinor: number }> | null;
  /** null: the person may not see invoices or payments. Organization currency only. */
  billing: null | { currency: string; outstandingMinor: number; overdueMinor: number; overdueCount: number; collectedMinor: number; previousCollectedMinor: number };
}): { findings: Finding[]; limitations: string[] } {
  const { period } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const base = { section: 'finance' as const, period };

  if (input.payroll === null) limitations.push('Payroll insights need payroll access.');
  else {
    const byCurrency = new Map<string, PayrollRunFacts[]>();
    for (const r of input.payroll.filter((x) => x.status === 'FINALIZED' || x.status === 'PAID')) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);
    for (const [currency, runs] of byCurrency) {
      const [latest, prior] = [...runs].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
      if (!latest || !prior) continue;
      const change = percentChange(latest.grossMinor, prior.grossMinor, 1);
      findings.push({
        ...base,
        id: findingId('finance', 'payroll_change', currency),
        category: 'payroll_change',
        severity: change !== null && change >= 15 ? 'attention' : 'info',
        basis: 'observation',
        title: `Payroll (${currency}) ${change === null ? 'compared with the run before' : `${change >= 0 ? 'up' : 'down'} ${Math.abs(change)} %`}`,
        summary: `Gross pay for the run starting ${latest.periodStart}, against the run starting ${prior.periodStart}, as finalized in Payroll.`,
        metrics: [{ label: 'Gross pay', value: latest.grossMinor, unit: 'money', currency, previous: prior.grossMinor }, ...(change === null ? [] : [{ label: 'Change', value: change, unit: 'percent' as const }])],
        refs: [{ type: 'payroll_run', id: latest.id, name: `Payroll ${latest.periodStart}` }],
        links: ['finance.payroll'],
        next_step: change !== null && change >= 15 ? 'Check what drove the increase (overtime, new members, rate changes).' : 'No action needed.',
      });
      if (latest.overtimeSeconds > 0 || prior.overtimeSeconds > 0) {
        findings.push({
          ...base,
          id: findingId('finance', 'overtime_cost_share', currency),
          category: 'overtime_cost_share',
          severity: latest.overtimeSeconds > prior.overtimeSeconds * 1.25 && latest.overtimeSeconds >= 2 * 3600 ? 'attention' : 'info',
          basis: 'observation',
          title: `Overtime in the latest ${currency} payroll`,
          summary: `${hours(latest.overtimeSeconds)} h of overtime against ${hours(prior.overtimeSeconds)} h in the run before.`,
          metrics: [{ label: 'Overtime hours', value: hours(latest.overtimeSeconds), unit: 'hours', previous: hours(prior.overtimeSeconds) }],
          refs: [{ type: 'payroll_run', id: latest.id, name: `Payroll ${latest.periodStart}` }],
          links: ['finance.payroll'],
          next_step: 'See which teams worked the overtime in AI Insights › Workforce.',
        });
      }
    }
  }

  if (input.owedEstimate === null) limitations.push('The payroll forecast needs billing or rates access.');
  else {
    for (const o of input.owedEstimate) {
      const total = o.approvedMinor + o.estimatedMinor;
      if (total <= 0) continue;
      findings.push({
        ...base,
        id: findingId('finance', 'payroll_forecast', o.currency),
        category: 'payroll_forecast',
        severity: 'info',
        basis: 'estimate',
        title: `Expected pay for the current period (${o.currency})`,
        summary: 'Estimated from approved time at its approved price and other time at today’s rates. The payroll run remains the official figure.',
        metrics: [
          { label: 'Expected pay', value: total, unit: 'money', currency: o.currency },
          { label: 'Already approved', value: o.approvedMinor, unit: 'money', currency: o.currency },
        ],
        refs: [],
        links: ['finance.payroll'],
        next_step: 'Approve pending timesheets so the estimate becomes approved pay.',
      });
    }
  }

  if (input.billing === null) limitations.push('Invoice and payment insights need invoice or payment access.');
  else {
    const b = input.billing;
    if (b.overdueCount > 0) {
      findings.push({
        ...base,
        id: findingId('finance', 'overdue_invoices', period.from),
        category: 'overdue_invoices',
        severity: 'warning',
        basis: 'fact',
        title: `${b.overdueCount} ${b.overdueCount === 1 ? 'invoice is' : 'invoices are'} overdue`,
        summary: 'Past their due date and not fully paid.',
        metrics: [
          { label: 'Overdue', value: b.overdueMinor, unit: 'money', currency: b.currency },
          { label: 'Outstanding', value: b.outstandingMinor, unit: 'money', currency: b.currency },
        ],
        refs: [],
        links: ['finance.invoices'],
        next_step: 'Send reminders from Invoices.',
      });
    }
    const change = percentChange(b.collectedMinor, b.previousCollectedMinor, 1);
    if (b.collectedMinor > 0 || b.previousCollectedMinor > 0) {
      findings.push({
        ...base,
        id: findingId('finance', 'collections_change', period.from),
        category: 'collections_change',
        severity: change !== null && change <= -30 ? 'attention' : 'info',
        basis: 'observation',
        title: `Payments received ${change === null ? 'this period' : `${change >= 0 ? 'up' : 'down'} ${Math.abs(change)} %`}`,
        summary: `Payments received in ${b.currency} this period against the previous period.`,
        metrics: [{ label: 'Received', value: b.collectedMinor, unit: 'money', currency: b.currency, previous: b.previousCollectedMinor }, ...(change === null ? [] : [{ label: 'Change', value: change, unit: 'percent' as const }])],
        refs: [],
        links: ['finance.invoices'],
        next_step: 'No action needed.',
      });
    }
  }
  return { findings, limitations };
}
