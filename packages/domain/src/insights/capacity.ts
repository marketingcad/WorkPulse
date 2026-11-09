import { findingId } from './compare';
import type { Finding, Period } from './types';

/**
 * Workload and capacity for the next two weeks, per team: scheduled hours minus approved time off,
 * against the team's recent pace. Recommendations only: nobody is ever reassigned.
 */
export interface TeamCapacity {
  id: string;
  name: string;
  /** Scheduled seconds in the period; null when the team has no schedules. */
  scheduledSeconds: number | null;
  timeOffSeconds: number;
  /** Average tracked seconds per week over the last four weeks; null when unknown. */
  recentWeeklySeconds: number | null;
  /** Remaining estimates on open tasks assigned to the team. */
  openEstimateSeconds: number;
}

const hours = (s: number) => Math.round(s / 36) / 100;
const WEEKS = 2;

export function capacityFindings(input: { period: Period; teams: TeamCapacity[] }): { findings: Finding[]; limitations: string[] } {
  const { period } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const over: TeamCapacity[] = [];
  const under: TeamCapacity[] = [];
  for (const t of input.teams) {
    if (t.scheduledSeconds === null) {
      limitations.push(`No schedules for ${t.name}; capacity cannot be estimated.`);
      continue;
    }
    const available = Math.max(0, t.scheduledSeconds - t.timeOffSeconds);
    const pace = t.recentWeeklySeconds === null ? null : t.recentWeeklySeconds * WEEKS;
    const ref = [{ type: 'team' as const, id: t.id, name: t.name }];
    const base = { section: 'capacity' as const, period, refs: ref, links: ['schedules' as const] };
    if (t.scheduledSeconds > 0 && t.timeOffSeconds / t.scheduledSeconds > 0.25) {
      findings.push({
        ...base,
        id: findingId('capacity', 'time_off_dip', t.id),
        category: 'time_off_dip',
        severity: 'attention',
        basis: 'fact',
        title: `Time off reduces ${t.name}'s capacity`,
        summary: `${hours(t.timeOffSeconds)} h of approved time off against ${hours(t.scheduledSeconds)} h scheduled in the next two weeks.`,
        metrics: [
          { label: 'Time off', value: hours(t.timeOffSeconds), unit: 'hours' },
          { label: 'Scheduled', value: hours(t.scheduledSeconds), unit: 'hours' },
        ],
        next_step: 'Plan deadlines around the absences.',
      });
    }
    if ((pace !== null && pace > available * 1.15) || t.openEstimateSeconds > available) {
      over.push(t);
      findings.push({
        ...base,
        id: findingId('capacity', 'overloaded', t.id),
        category: 'overloaded',
        severity: 'attention',
        basis: 'observation',
        title: `${t.name} may be overloaded`,
        summary: `${hours(available)} h available in the next two weeks${pace !== null ? `, against a recent pace of ${hours(pace)} h` : ''}${t.openEstimateSeconds ? ` and ${hours(t.openEstimateSeconds)} h of open estimates` : ''}.`,
        metrics: [
          { label: 'Available', value: hours(available), unit: 'hours' },
          ...(pace !== null ? [{ label: 'Recent pace', value: hours(pace), unit: 'hours' as const }] : []),
          ...(t.openEstimateSeconds ? [{ label: 'Open estimates', value: hours(t.openEstimateSeconds), unit: 'hours' as const }] : []),
        ],
        next_step: 'Check priorities with the team before adding work.',
      });
    } else if (pace !== null && available > pace * 1.4) {
      under.push(t);
      findings.push({
        ...base,
        id: findingId('capacity', 'underused', t.id),
        category: 'underused',
        severity: 'info',
        basis: 'observation',
        title: `${t.name} has room for more work`,
        summary: `${hours(available)} h available in the next two weeks against a recent pace of ${hours(pace)} h.`,
        metrics: [
          { label: 'Available', value: hours(available), unit: 'hours' },
          { label: 'Recent pace', value: hours(pace), unit: 'hours' },
        ],
        next_step: 'Consider bringing forward planned work.',
      });
    }
  }
  if (over.length && under.length) {
    findings.push({
      section: 'capacity',
      period,
      id: findingId('capacity', 'redistribute', period.from),
      category: 'redistribute',
      severity: 'info',
      basis: 'estimate',
      title: 'Work could be shared between teams',
      summary: `${over.map((t) => t.name).join(', ')} could hand some work to ${under.map((t) => t.name).join(', ')}, if the skills match. This is a suggestion based on hours only.`,
      metrics: [],
      refs: [...over, ...under].map((t) => ({ type: 'team' as const, id: t.id, name: t.name })),
      links: ['teams'],
      next_step: 'Discuss with both team managers.',
    });
  }
  return { findings, limitations };
}
