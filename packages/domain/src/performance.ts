/**
 * Performance Center: pure scoring, goal and achievement rules (no I/O).
 *
 * Fairness rules, enforced here so every caller gets them:
 * - A score is built only from measured outcomes: goals, delivery against due dates, approved-work
 *   consistency, manager quality reviews and attendance. Activity levels, keystrokes and screenshots are
 *   never inputs.
 * - A metric with no data is `null`, never 0. It is left out and the other weights are re-normalized;
 *   with too little measured (below MIN_SCORE_COVERAGE of the weights) there is no score at all.
 * - Every value is clamped to 0–100, so no single input can push a score out of range.
 */
import { addDaysToDate, startOfWeek } from './time';
import { validation } from './errors';

// ─── Metrics and weights ─────────────────────────────────────────────────────

export const PERFORMANCE_METRICS = ['goals', 'delivery', 'consistency', 'quality', 'attendance'] as const;
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];
export type PerformanceWeights = Record<PerformanceMetric, number>;
export type MetricValues = Record<PerformanceMetric, number | null>;

export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceWeights = { goals: 30, delivery: 25, consistency: 20, quality: 15, attendance: 10 };

/** Below this share of the weights measured, a score would rest on too little to be fair: none is given. */
export const MIN_SCORE_COVERAGE = 50;
/** Fewer approved days than this in a period: not ranked (a new starter is not compared on two days). */
export const DEFAULT_MIN_ELIGIBLE_DAYS = 10;

/** What is wrong with a set of weights (empty: valid). Weights are whole percentages adding up to 100. */
export function weightIssues(weights: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const keys = Object.keys(weights);
  for (const k of keys) if (!(PERFORMANCE_METRICS as readonly string[]).includes(k)) issues.push(`Unknown metric "${k}"`);
  let sum = 0;
  for (const m of PERFORMANCE_METRICS) {
    const v = weights[m];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) {
      issues.push(`The ${m} weight must be a whole number from 0 to 100`);
      continue;
    }
    sum += v;
  }
  if (!issues.length && sum !== 100) issues.push(`Weights must add up to 100% (they add up to ${sum}%)`);
  return issues;
}

export function assertValidWeights(weights: Record<string, unknown>): asserts weights is PerformanceWeights {
  const issues = weightIssues(weights);
  if (issues.length) throw validation(issues[0]!, { issues });
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `part` of `whole` on a 0–100 scale; null when there was nothing to measure (whole ≤ 0). */
export function ratioScore(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return round1((clamp(part, 0, whole) / whole) * 100);
}

/** Review ratings (1–5) on a 0–100 scale: 1 → 0, 3 → 50, 5 → 100. No ratings: null. */
export function ratingScore(ratings: readonly number[]): number | null {
  const valid = ratings.filter((r) => Number.isFinite(r));
  if (!valid.length) return null;
  const avg = valid.reduce((s, r) => s + clamp(r, 1, 5), 0) / valid.length;
  return round1(((avg - 1) / 4) * 100);
}

/** The raw counts a member's (or team's) metrics come from, all from server data. */
export interface MetricInputs {
  /** goals that ended in the period, and how many of them were reached */
  goals: { completed: number; due: number };
  /** tasks and milestones due in the period, and how many were done by their due date */
  delivery: { onTime: number; due: number };
  /** scheduled workdays in the period, and how many have approved time */
  consistency: { approvedDays: number; scheduledDays: number };
  /** quality ratings (1–5) from final reviews covering the period */
  quality: { ratings: readonly number[] };
  /** scheduled shifts that started on time, out of shifts that were due (leave and holidays excluded) */
  attendance: { onTime: number; scheduled: number };
}

export function metricValues(i: MetricInputs): MetricValues {
  return {
    goals: ratioScore(i.goals.completed, i.goals.due),
    delivery: ratioScore(i.delivery.onTime, i.delivery.due),
    consistency: ratioScore(i.consistency.approvedDays, i.consistency.scheduledDays),
    quality: ratingScore(i.quality.ratings),
    attendance: ratioScore(i.attendance.onTime, i.attendance.scheduled),
  };
}

export interface ScorePart {
  value: number | null;
  weight: number;
  /** the weight it carried after unmeasured metrics were left out (0 when unmeasured) */
  effective_weight: number;
}
export interface ScoreResult {
  /** 0–100 with one decimal, or null when too little was measured */
  score: number | null;
  /** share of the weights that was measured (0–100) */
  coverage: number;
  parts: Record<PerformanceMetric, ScorePart>;
}

export function computeScore(values: MetricValues, weights: PerformanceWeights, minCoverage = MIN_SCORE_COVERAGE): ScoreResult {
  assertValidWeights(weights);
  let coverage = 0;
  let weighted = 0;
  for (const m of PERFORMANCE_METRICS) {
    const v = values[m];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    coverage += weights[m];
    weighted += clamp(v, 0, 100) * weights[m];
  }
  const measured = coverage > 0 && coverage >= minCoverage;
  const parts = Object.fromEntries(
    PERFORMANCE_METRICS.map((m) => {
      const v = values[m];
      const has = v !== null && v !== undefined && Number.isFinite(v);
      return [m, { value: has ? clamp(v, 0, 100) : null, weight: weights[m], effective_weight: has && coverage > 0 ? round1((weights[m] * 100) / coverage) : 0 }];
    }),
  ) as Record<PerformanceMetric, ScorePart>;
  return { score: measured ? round1(weighted / coverage) : null, coverage, parts };
}

// ─── Periods ─────────────────────────────────────────────────────────────────

export const PERFORMANCE_PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

const pad = (n: number) => String(n).padStart(2, '0');
function lastDayOfMonth(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** The calendar period of `type` that contains `date` (YYYY-MM-DD), as inclusive dates. */
export function periodBounds(type: PerformancePeriod, date: string, weekStart = 1): { start: string; end: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  switch (type) {
    case 'WEEK': {
      const start = startOfWeek(date, weekStart);
      return { start, end: addDaysToDate(start, 6) };
    }
    case 'MONTH':
      return { start: `${y}-${pad(m)}-01`, end: lastDayOfMonth(y, m) };
    case 'QUARTER': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { start: `${y}-${pad(q0)}-01`, end: lastDayOfMonth(y, q0 + 2) };
    }
    case 'YEAR':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
}

/**
 * Days after a period ends before its scores are final. Timesheets for the last days of a period are
 * approved, and reviews for it written, after it ends; until then its scores keep being recalculated
 * so that work counts. After it they are history and never change.
 */
export const SCORE_SETTLE_DAYS = 14;

/** Whether a period that ends on `periodEnd` is final on `today` (both YYYY-MM-DD, org time zone). */
export function isPeriodSettled(periodEnd: string, today: string): boolean {
  return today > addDaysToDate(periodEnd, SCORE_SETTLE_DAYS);
}

export const AWARD_RECURRENCES = ['ONCE', ...PERFORMANCE_PERIODS] as const;
export type AwardRecurrence = (typeof AWARD_RECURRENCES)[number];

/**
 * The eligibility period an award belongs to, for duplicate prevention: one award per achievement,
 * recipient, level and period. A once-only achievement has a single period for ever.
 */
export function awardPeriodKey(recurrence: AwardRecurrence, date: string, weekStart = 1): string {
  if (recurrence === 'ONCE') return 'once';
  const { start } = periodBounds(recurrence, date, weekStart);
  const [y, m] = start.split('-').map(Number) as [number, number];
  switch (recurrence) {
    case 'WEEK':
      return `week:${start}`;
    case 'MONTH':
      return `${y}-${pad(m)}`;
    case 'QUARTER':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'YEAR':
      return String(y);
  }
}

// ─── Achievements ────────────────────────────────────────────────────────────

export const ACHIEVEMENT_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];

export const ACHIEVEMENT_CATEGORIES = ['PRODUCTIVITY', 'ATTENDANCE', 'CONSISTENCY', 'PROJECT_COMPLETION', 'QUALITY', 'TEAMWORK', 'MILESTONES', 'RECOGNITION'] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/** What an automatic achievement is measured on. Every one comes from approved or completed work. */
export const ACHIEVEMENT_METRICS = ['TASKS_COMPLETED', 'ON_TIME_MONTHS', 'MILESTONES_ON_TIME', 'CONSISTENT_WEEKS', 'APPROVED_HOURS', 'TOP_SCORE'] as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

/** Thresholds must be 1–4 positive values, strictly increasing (Bronze < Silver < Gold < Platinum). */
export function thresholdIssues(thresholds: readonly number[]): string[] {
  if (thresholds.length < 1 || thresholds.length > ACHIEVEMENT_TIERS.length) return ['Give 1 to 4 levels'];
  if (thresholds.some((t) => !Number.isFinite(t) || t <= 0)) return ['Each level needs a positive target'];
  for (let i = 1; i < thresholds.length; i++) if (thresholds[i]! <= thresholds[i - 1]!) return ['Each level must need more than the one before'];
  return [];
}

/** Every level reached by `value`, lowest first (Bronze at thresholds[0], and so on). */
export function tiersReached(thresholds: readonly number[], value: number): AchievementTier[] {
  if (thresholdIssues(thresholds).length || !Number.isFinite(value)) return [];
  return thresholds.flatMap((t, i) => (value >= t ? [ACHIEVEMENT_TIERS[i]!] : []));
}

export interface AchievementDefinitionSpec {
  key: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  mode: 'AUTOMATIC' | 'MANUAL';
  /** automatic only: the measure and the level targets (a single target: one level) */
  metric?: AchievementMetric;
  thresholds?: readonly number[];
  recurrence: AwardRecurrence;
}

/** The built-in catalogue every organization starts with (custom ones are added per organization). */
export const BUILTIN_ACHIEVEMENTS: readonly AchievementDefinitionSpec[] = [
  { key: 'productivity_champion', name: 'Productivity Champion', description: 'Assigned tasks completed in a quarter, counted when they are marked done.', category: 'PRODUCTIVITY', icon: 'check-circle', mode: 'AUTOMATIC', metric: 'TASKS_COMPLETED', thresholds: [25, 50, 100, 200], recurrence: 'QUARTER' },
  { key: 'perfect_attendance', name: 'Perfect Attendance', description: 'Months in a row with every scheduled shift started on time. Approved time off never breaks a run.', category: 'ATTENDANCE', icon: 'calendar-check', mode: 'AUTOMATIC', metric: 'ON_TIME_MONTHS', thresholds: [1, 3, 6, 12], recurrence: 'ONCE' },
  { key: 'project_finisher', name: 'Project Finisher', description: 'Project milestones delivered on or before their due date.', category: 'PROJECT_COMPLETION', icon: 'flag', mode: 'AUTOMATIC', metric: 'MILESTONES_ON_TIME', thresholds: [1, 3, 5, 10], recurrence: 'ONCE' },
  { key: 'consistency_star', name: 'Consistency Star', description: 'Weeks in a row with approved time on every scheduled workday.', category: 'CONSISTENCY', icon: 'repeat', mode: 'AUTOMATIC', metric: 'CONSISTENT_WEEKS', thresholds: [4, 8, 13, 26], recurrence: 'ONCE' },
  { key: 'first_100_hours', name: 'First 100 Hours', description: 'Approved hours since joining. Only approved timesheets count.', category: 'MILESTONES', icon: 'clock', mode: 'AUTOMATIC', metric: 'APPROVED_HOURS', thresholds: [100, 500, 1000, 2500], recurrence: 'ONCE' },
  { key: 'monthly_top_performer', name: 'Monthly Top Performer', description: 'Highest score in their role for the month.', category: 'RECOGNITION', icon: 'crown', mode: 'AUTOMATIC', metric: 'TOP_SCORE', thresholds: [1], recurrence: 'MONTH' },
  { key: 'team_player', name: 'Team Player', description: 'Given by a manager, with a reason, for helping others succeed.', category: 'TEAMWORK', icon: 'heart', mode: 'MANUAL', recurrence: 'MONTH' },
  { key: 'outstanding_contributor', name: 'Outstanding Contributor', description: 'For work that changed a project or a client relationship.', category: 'RECOGNITION', icon: 'star', mode: 'MANUAL', recurrence: 'MONTH' },
  { key: 'quality_craft', name: 'Quality Craft', description: 'Work a reviewer marked as exemplary in a performance review.', category: 'QUALITY', icon: 'gem', mode: 'MANUAL', recurrence: 'QUARTER' },
  // Given when the organization approves a client's appreciation (never by the client directly).
  { key: 'client_hero', name: 'Client Hero', description: 'Appreciation from a client, approved by the organization.', category: 'RECOGNITION', icon: 'smile', mode: 'MANUAL', recurrence: 'ONCE' },
];

/** Built-in keys that only the system gives (a manager cannot award them by hand). */
export const SYSTEM_ONLY_ACHIEVEMENTS: readonly string[] = ['client_hero'];

/** Icons an achievement may use (lucide names the web and desktop apps both draw). */
export const ACHIEVEMENT_ICONS = ['award', 'check-circle', 'calendar-check', 'flag', 'repeat', 'clock', 'crown', 'heart', 'star', 'gem', 'smile', 'trophy', 'target', 'zap', 'rocket', 'shield-check', 'users', 'sparkles'] as const;

// ─── Goals ───────────────────────────────────────────────────────────────────

export const GOAL_SUBJECTS = ['MEMBER', 'TEAM', 'PROJECT', 'ORG'] as const;
export type GoalSubject = (typeof GOAL_SUBJECTS)[number];

/** How a goal's progress is measured. Every one is read from existing data, never typed in. */
export const GOAL_METRICS = ['TASKS_COMPLETED', 'MILESTONES_COMPLETED', 'APPROVED_HOURS', 'ON_TIME_PCT'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

const GOAL_SUBJECTS_FOR: Record<GoalMetric, readonly GoalSubject[]> = {
  TASKS_COMPLETED: ['MEMBER', 'TEAM', 'PROJECT', 'ORG'],
  // Milestones belong to projects, not to one person.
  MILESTONES_COMPLETED: ['TEAM', 'PROJECT', 'ORG'],
  APPROVED_HOURS: ['MEMBER', 'TEAM', 'PROJECT', 'ORG'],
  // Attendance is about people's schedules.
  ON_TIME_PCT: ['MEMBER', 'TEAM', 'ORG'],
};

export function goalMetricAllowed(metric: GoalMetric, subject: GoalSubject): boolean {
  return GOAL_SUBJECTS_FOR[metric].includes(subject);
}

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'MISSED';
export type GoalPace = 'AHEAD' | 'ON_TRACK' | 'AT_RISK';

export interface GoalEvaluation {
  status: GoalStatus;
  /** 0–100 */
  progress_pct: number;
  /** only for an active goal with a measurable pace */
  pace: GoalPace | null;
}

/**
 * Where a goal stands on `today`. A count goal is reached the moment `current` hits `target`; a
 * percentage goal (ON_TIME_PCT) can rise and fall, so it is only settled once its end date has passed.
 */
export function evaluateGoal(g: { metric: GoalMetric; target: number; current: number; startDate: string; endDate: string }, today: string): GoalEvaluation {
  if (!(g.target > 0)) throw validation('A goal needs a target above zero');
  const pct = round1(clamp((g.current / g.target) * 100, 0, 100));
  const reached = g.current >= g.target;
  const over = today > g.endDate;
  const isRate = g.metric === 'ON_TIME_PCT';
  if (reached && (!isRate || over)) return { status: 'COMPLETED', progress_pct: 100, pace: null };
  if (over) return { status: 'MISSED', progress_pct: pct, pace: null };
  if (isRate) return { status: 'ACTIVE', progress_pct: pct, pace: reached ? 'ON_TRACK' : 'AT_RISK' };
  if (today < g.startDate) return { status: 'ACTIVE', progress_pct: pct, pace: null };
  const span = dayDiff(g.startDate, g.endDate) + 1;
  const elapsed = clamp(dayDiff(g.startDate, today) + 1, 0, span);
  const expected = elapsed / span;
  const actual = g.current / g.target;
  return { status: 'ACTIVE', progress_pct: pct, pace: actual >= expected + 0.1 ? 'AHEAD' : actual >= expected - 0.1 ? 'ON_TRACK' : 'AT_RISK' };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// ─── Rankings ────────────────────────────────────────────────────────────────

export interface RankInput {
  id: string;
  score: number | null;
  /** false: not ranked this period (e.g. too few approved days) */
  eligible: boolean;
  /** people are only ranked against others in the same group (role family); omitted: one group */
  group?: string;
  /** tie-break for display order only; tied scores share a rank */
  name?: string;
}
export type Ranked<T extends RankInput> = T & { rank: number | null };

/**
 * Standard competition ranking ("1, 2, 2, 4") within each group. Entries without a score or not
 * eligible get no rank and sort after the ranked ones.
 */
export function rankEntries<T extends RankInput>(entries: readonly T[]): Ranked<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const e of entries) {
    const g = e.group ?? '';
    byGroup.set(g, [...(byGroup.get(g) ?? []), e]);
  }
  const out: Ranked<T>[] = [];
  for (const g of [...byGroup.keys()].sort()) {
    const list = byGroup.get(g)!;
    const ranked = list.filter((e) => e.eligible && e.score !== null).sort((a, b) => b.score! - a.score! || (a.name ?? a.id).localeCompare(b.name ?? b.id));
    let prev: number | null = null;
    let rank = 0;
    ranked.forEach((e, i) => {
      if (e.score !== prev) rank = i + 1;
      prev = e.score;
      out.push({ ...e, rank });
    });
    const unranked = list.filter((e) => !(e.eligible && e.score !== null)).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    for (const e of unranked) out.push({ ...e, rank: null });
  }
  return out;
}
