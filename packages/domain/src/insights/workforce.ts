import { findingId, percentChange } from './compare';
import type { Finding, Period } from './types';

/** Hours of one team, project or member for the period and the one before (seconds). */
export interface GroupHours {
  id: string;
  name: string;
  type: 'team' | 'project' | 'member';
  seconds: number;
  previousSeconds: number | null;
  overtimeSeconds: number;
  previousOvertimeSeconds: number | null;
  approvedSeconds: number;
}

const H = 3600;
const hours = (s: number) => Math.round(s / 36) / 100;

export function workforceFindings(input: {
  period: Period;
  previous: Period;
  totals: { seconds: number; previousSeconds: number | null; approvedSeconds: number; overtimeSeconds: number; previousOvertimeSeconds: number | null };
  groups: GroupHours[];
  pending: number;
  missing: number;
  timeOff: { approvedDays: number; pendingRequests: number };
}): { findings: Finding[]; limitations: string[] } {
  const { period, totals } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const base = { section: 'workforce' as const, period };
  const hasPrevious = !!totals.previousSeconds;
  if (!hasPrevious) limitations.push('No previous period to compare with.');

  const change = hasPrevious ? percentChange(totals.seconds, totals.previousSeconds, H) : null;
  findings.push({
    ...base,
    id: findingId('workforce', 'hours_trend', period.from),
    category: 'hours_trend',
    severity: 'info',
    basis: 'observation',
    title: change === null ? 'Hours recorded this period' : `Hours ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)} % on the previous period`,
    summary:
      change === null
        ? `${hours(totals.seconds)} h were recorded from ${period.from} to ${period.to}.`
        : `${hours(totals.seconds)} h were recorded, against ${hours(totals.previousSeconds!)} h from ${input.previous.from} to ${input.previous.to}.`,
    metrics: [{ label: 'Hours', value: hours(totals.seconds), unit: 'hours', previous: hasPrevious ? hours(totals.previousSeconds!) : null }, ...(change === null ? [] : [{ label: 'Change', value: change, unit: 'percent' as const }])],
    refs: [],
    links: ['timesheets.all'],
    next_step: 'Open time entries to see where the hours went.',
  });

  if (totals.seconds > 0) {
    const share = Math.round((totals.approvedSeconds / totals.seconds) * 100);
    findings.push({
      ...base,
      id: findingId('workforce', 'approved_share', period.from),
      category: 'approved_share',
      severity: share < 50 ? 'attention' : 'info',
      basis: 'observation',
      title: `${share} % of this period's time is approved`,
      summary: `${hours(totals.approvedSeconds)} h of ${hours(totals.seconds)} h recorded are on approved timesheets.`,
      metrics: [{ label: 'Approved', value: share, unit: 'percent' }],
      refs: [],
      links: ['timesheets.approvals'],
      next_step: share < 50 ? 'Review the approval queue so pay and billing use approved time.' : 'No action needed.',
    });
  }

  for (const g of input.groups) {
    const ref = [{ type: g.type, id: g.id, name: g.name }];
    const otChange = percentChange(g.overtimeSeconds, g.previousOvertimeSeconds, 2 * H);
    const otAppeared = (g.previousOvertimeSeconds ?? 0) === 0 && g.previousOvertimeSeconds !== null && g.overtimeSeconds >= 2 * H;
    if ((otChange !== null && otChange >= 25) || otAppeared) {
      findings.push({
        ...base,
        id: findingId('workforce', 'overtime_trend', g.id),
        category: 'overtime_trend',
        severity: 'attention',
        basis: 'observation',
        title: `More overtime in ${g.name}`,
        summary: `${g.name} recorded ${hours(g.overtimeSeconds)} h of overtime this period, against ${hours(g.previousOvertimeSeconds ?? 0)} h before.`,
        metrics: [{ label: 'Overtime', value: hours(g.overtimeSeconds), unit: 'hours', previous: hours(g.previousOvertimeSeconds ?? 0) }, ...(otChange === null ? [] : [{ label: 'Change', value: otChange, unit: 'percent' as const }])],
        refs: ref,
        links: ['timesheets.all'],
        next_step: `Check whether ${g.name}'s workload can be spread, or whether the overtime is planned.`,
      });
    }
    const wChange = percentChange(g.seconds, g.previousSeconds, 8 * H);
    if (wChange !== null && wChange >= 20) {
      findings.push({
        ...base,
        id: findingId('workforce', 'workload_up', g.id),
        category: 'workload_up',
        severity: 'attention',
        basis: 'observation',
        title: `${g.name}'s workload is up ${wChange} %`,
        summary: `${g.name} recorded ${hours(g.seconds)} h, against ${hours(g.previousSeconds!)} h in the previous period.`,
        metrics: [{ label: 'Hours', value: hours(g.seconds), unit: 'hours', previous: hours(g.previousSeconds!) }, { label: 'Change', value: wChange, unit: 'percent' }],
        refs: ref,
        links: ['timesheets.all'],
        next_step: 'Look at which projects drove the increase.',
      });
    }
  }

  if (input.pending > 0) {
    findings.push({
      ...base,
      id: findingId('workforce', 'approval_backlog', period.from),
      category: 'approval_backlog',
      severity: input.pending >= 10 ? 'warning' : 'attention',
      basis: 'fact',
      title: `${input.pending} ${input.pending === 1 ? 'timesheet is' : 'timesheets are'} waiting for approval`,
      summary: 'Approved time is what payroll and invoices use.',
      metrics: [{ label: 'Waiting', value: input.pending, unit: 'count' }],
      refs: [],
      links: ['timesheets.approvals'],
      next_step: 'Open Approvals.',
    });
  }
  if (input.missing > 0) {
    findings.push({
      ...base,
      id: findingId('workforce', 'missing_timesheets', period.from),
      category: 'missing_timesheets',
      severity: 'attention',
      basis: 'fact',
      title: `${input.missing} ${input.missing === 1 ? 'person has' : 'people have'} not submitted a timesheet`,
      summary: 'For the period that ended most recently.',
      metrics: [{ label: 'Not submitted', value: input.missing, unit: 'count' }],
      refs: [],
      links: ['timesheets.approvals'],
      next_step: 'See the Timesheets tab of AI Insights for names.',
    });
  }
  if (input.timeOff.approvedDays > 0 || input.timeOff.pendingRequests > 0) {
    findings.push({
      ...base,
      id: findingId('workforce', 'time_off', period.from),
      category: 'time_off',
      severity: 'info',
      basis: 'fact',
      title: 'Time off this period',
      summary: `${input.timeOff.approvedDays} approved ${input.timeOff.approvedDays === 1 ? 'day' : 'days'} away, and ${input.timeOff.pendingRequests} ${input.timeOff.pendingRequests === 1 ? 'request' : 'requests'} waiting.`,
      metrics: [
        { label: 'Days away', value: input.timeOff.approvedDays, unit: 'days' },
        { label: 'Requests waiting', value: input.timeOff.pendingRequests, unit: 'count' },
      ],
      refs: [],
      links: ['time_off'],
      next_step: input.timeOff.pendingRequests > 0 ? 'Decide the waiting requests.' : 'No action needed.',
    });
  }
  return { findings, limitations };
}
