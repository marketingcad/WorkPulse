import type { NavTargetKey } from '../assistant/navigation';

/**
 * WorkPulse AI Insights: findings computed from data the person may already see. The AI explains
 * them; it never produces their numbers.
 *
 * - `fact`: read from stored records (a timesheet is missing, a budget is exceeded).
 * - `observation`: a computed comparison (hours rose 30 % against the previous period).
 * - `estimate`: a projection, never a guarantee (at the current pace the budget runs out).
 */
export type Basis = 'fact' | 'observation' | 'estimate';
export type Severity = 'info' | 'attention' | 'warning';
export type InsightSection = 'workforce' | 'timesheets' | 'projects' | 'workflow';

export interface Metric {
  label: string;
  value: number;
  unit: 'hours' | 'percent' | 'count' | 'days';
  /** The same measure in the previous period; null when there is none to compare with. */
  previous?: number | null;
}

export interface InsightRef {
  type: 'member' | 'team' | 'project' | 'timesheet' | 'task';
  id: string;
  name: string;
}

export interface Period {
  from: string;
  to: string;
}

export interface Finding {
  id: string;
  section: InsightSection;
  category: string;
  severity: Severity;
  basis: Basis;
  title: string;
  summary: string;
  period: Period;
  metrics: Metric[];
  refs: InsightRef[];
  links: NavTargetKey[];
  next_step: string;
}

export interface InsightResult {
  section: InsightSection | 'overview';
  period: Period;
  previous: Period;
  findings: Finding[];
  /** What could not be analysed and why (missing access, no earlier data). Never silently empty. */
  limitations: string[];
}
