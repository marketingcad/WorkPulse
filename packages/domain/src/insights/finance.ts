import { findingId, percentChange } from './compare';
import { monthEndProjection } from './forecast';
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
  /** The pay group (payroll profile): runs are only compared within one group. */
  groupId: string;
  groupName: string;
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
  /** Pay for time recorded this calendar month before today, per currency (absent or null: none). */
  monthToDatePay?: Array<{ currency: string; minor: number }> | null;
  today?: string;
}): { findings: Finding[]; limitations: string[] } {
  const { period } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const base = { section: 'finance' as const, period };

  if (input.monthToDatePay && input.today) {
    for (const p of input.monthToDatePay) {
      if (p.minor <= 0) continue;
      const m = monthEndProjection({ today: input.today, soFar: p.minor });
      if (!m) {
        if (!limitations.includes('Too early in the month to project month-end pay.')) limitations.push('Too early in the month to project month-end pay.');
        continue;
      }
      findings.push({
        ...base,
        period: { from: m.monthStart, to: m.monthEnd },
        id: findingId('finance', 'month_end_pay', `${m.monthStart}:${p.currency}`),
        category: 'month_end_pay',
        severity: 'info',
        basis: 'estimate',
        title: `Expected pay this month (${p.currency})`,
        summary: `Pay for the time recorded in the first ${m.elapsedWeekdays} of ${m.totalWeekdays} working days, priced by the existing rates and projected to the end of the month. This is an estimate, not a certainty.`,
        metrics: [
          { label: 'So far', value: p.minor, unit: 'money', currency: p.currency },
          { label: 'Projected', value: m.projected, unit: 'money', currency: p.currency },
        ],
        refs: [],
        links: ['finance.payroll'],
        next_step: 'No action needed.',
      });
    }
  }

  if (input.payroll === null) limitations.push('Payroll insights need payroll access.');
  else {
    // Per pay group and currency: a weekly group is never compared with a monthly one.
    const byGroup = new Map<string, PayrollRunFacts[]>();
    for (const r of input.payroll.filter((x) => x.status === 'FINALIZED' || x.status === 'PAID')) {
      const k = `${r.groupId}:${r.currency}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), r]);
    }
    for (const [key, runs] of byGroup) {
      const [latest, prior] = [...runs].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
      if (!latest || !prior) continue;
      const currency = latest.currency;
      const label = `${latest.groupName} (${currency})`;
      const change = percentChange(latest.grossMinor, prior.grossMinor, 1);
      findings.push({
        ...base,
        id: findingId('finance', 'payroll_change', key),
        category: 'payroll_change',
        severity: change !== null && change >= 15 ? 'attention' : 'info',
        basis: 'observation',
        title: `Payroll – ${label} ${change === null ? 'compared with the run before' : `${change >= 0 ? 'up' : 'down'} ${Math.abs(change)} %`}`,
        summary: `Gross pay for the run starting ${latest.periodStart}, against the run starting ${prior.periodStart}, as finalized in Payroll.`,
        metrics: [{ label: 'Gross pay', value: latest.grossMinor, unit: 'money', currency, previous: prior.grossMinor }, ...(change === null ? [] : [{ label: 'Change', value: change, unit: 'percent' as const }])],
        refs: [{ type: 'payroll_run', id: latest.id, name: `Payroll ${latest.periodStart}` }],
        links: ['finance.payroll'],
        next_step: change !== null && change >= 15 ? 'Check what drove the increase (overtime, new members, rate changes).' : 'No action needed.',
      });
      if (latest.overtimeSeconds > 0 || prior.overtimeSeconds > 0) {
        findings.push({
          ...base,
          id: findingId('finance', 'overtime_cost_share', key),
          category: 'overtime_cost_share',
          severity: latest.overtimeSeconds > prior.overtimeSeconds * 1.25 && latest.overtimeSeconds >= 2 * 3600 ? 'attention' : 'info',
          basis: 'observation',
          title: `Overtime in the latest payroll – ${label}`,
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
