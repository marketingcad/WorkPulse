import { findingId, percentChange } from './compare';
import type { Finding, Period } from './types';

/** Something waiting for a decision. `concerns`: Phase 1 timesheet findings that reference it. */
export interface WaitingItem {
  kind: 'timesheet' | 'manual_time' | 'time_off' | 'expense';
  id: string;
  memberName: string;
  /** Local date it was submitted. */
  submittedOn: string;
  concerns: number;
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const KIND: Record<WaitingItem['kind'], string> = { timesheet: 'Timesheets', manual_time: 'Manual time', time_off: 'Time off', expense: 'Expenses' };
const MAX_LISTED = 10;
const LONG_DAYS = 3;

/** Approval workflow: what to look at first, what has waited long, and how quickly decisions are made. */
export function workflowFindings(input: { period: Period; today: string; waiting: WaitingItem[]; decisionDays: { current: number | null; previous: number | null } }): { findings: Finding[]; limitations: string[] } {
  const { period, today, waiting, decisionDays } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const base = { section: 'workflow' as const, period, links: ['timesheets.approvals' as const] };
  if (!waiting.length && decisionDays.current === null) return { findings, limitations: ['Nothing is waiting for a decision.'] };

  if (waiting.length) {
    const ordered = [...waiting].sort((a, b) => b.concerns - a.concerns || a.submittedOn.localeCompare(b.submittedOn)).slice(0, MAX_LISTED);
    findings.push({
      ...base,
      id: findingId('workflow', 'review_first', period.from),
      category: 'review_first',
      severity: 'attention',
      basis: 'fact',
      title: `${waiting.length} ${waiting.length === 1 ? 'item is' : 'items are'} waiting for a decision`,
      summary: `Suggested order (most concerns, then oldest): ${ordered.map((w) => `${w.memberName} (${KIND[w.kind].toLowerCase()}${w.concerns ? `, ${w.concerns} to check` : ''})`).join(', ')}.`,
      metrics: [{ label: 'Waiting', value: waiting.length, unit: 'count' }],
      refs: ordered.map((w) => ({ type: w.kind === 'timesheet' ? ('timesheet' as const) : ('member' as const), id: w.id, name: w.memberName })),
      next_step: 'Open Approvals and start at the top of this list.',
    });

    const old = waiting.filter((w) => daysBetween(w.submittedOn, today) > LONG_DAYS);
    if (old.length) {
      findings.push({
        ...base,
        id: findingId('workflow', 'waiting_long', period.from),
        category: 'waiting_long',
        severity: 'attention',
        basis: 'fact',
        title: `${old.length} ${old.length === 1 ? 'item has' : 'items have'} waited more than ${LONG_DAYS} days`,
        summary: `Waiting longest: ${old
          .sort((a, b) => a.submittedOn.localeCompare(b.submittedOn))
          .slice(0, MAX_LISTED)
          .map((w) => `${w.memberName} since ${w.submittedOn}`)
          .join(', ')}.`,
        metrics: [{ label: 'Waiting over 3 days', value: old.length, unit: 'count' }],
        refs: [],
        next_step: 'Decide these first, or ask another approver to help.',
      });
    }

    const count = (k: WaitingItem['kind']) => waiting.filter((w) => w.kind === k).length;
    findings.push({
      ...base,
      id: findingId('workflow', 'backlog_mix', period.from),
      category: 'backlog_mix',
      severity: 'info',
      basis: 'fact',
      title: 'What is waiting, by kind',
      summary: (Object.keys(KIND) as WaitingItem['kind'][]).map((k) => `${KIND[k]}: ${count(k)}`).join(', ') + '.',
      metrics: (Object.keys(KIND) as WaitingItem['kind'][]).map((k) => ({ label: KIND[k], value: count(k), unit: 'count' as const })),
      refs: [],
      next_step: 'No action needed.',
    });
  }

  if (decisionDays.current !== null) {
    const change = percentChange(decisionDays.current, decisionDays.previous, 0.5);
    if (decisionDays.previous === null) limitations.push('No decisions in the previous period to compare with.');
    findings.push({
      ...base,
      id: findingId('workflow', 'decision_time', period.from),
      category: 'decision_time',
      severity: change !== null && change >= 50 ? 'attention' : 'info',
      basis: 'observation',
      title: `Timesheets are decided in ${decisionDays.current} ${decisionDays.current === 1 ? 'day' : 'days'} on average`,
      summary:
        change === null
          ? `From submission to approval or rejection, for timesheets decided in this period.`
          : `Against ${decisionDays.previous} days in the previous period (${change > 0 ? '+' : ''}${change} %).`,
      metrics: [{ label: 'Days to decide', value: decisionDays.current, unit: 'days', previous: decisionDays.previous }, ...(change === null ? [] : [{ label: 'Change', value: change, unit: 'percent' as const }])],
      refs: [],
      next_step: change !== null && change >= 50 ? 'Check whether approvers need a reminder or a backup approver.' : 'No action needed.',
    });
  }
  return { findings, limitations };
}
