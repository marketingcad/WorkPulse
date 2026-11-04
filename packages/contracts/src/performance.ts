import { z } from 'zod';
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_METRICS,
  ACHIEVEMENT_TIERS,
  AWARD_RECURRENCES,
  GOAL_METRICS,
  GOAL_SUBJECTS,
  PERFORMANCE_PERIODS,
  goalMetricAllowed,
  thresholdIssues,
  weightIssues,
  type AchievementTier,
  type GoalPace,
  type PerformanceMetric,
  type PerformanceWeights,
} from '@tallywork/domain';
import { id, isoDate, nonEmpty, optionalText } from './common';

/**
 * Performance Center requests and responses. Money never appears here: no rates, pay or billing, so
 * nothing in this module can leak financial data to a worker or a client.
 */

const dateOrder = <T extends { start_date?: string; end_date?: string }>(v: T) => !v.start_date || !v.end_date || v.start_date <= v.end_date;

// ─── Settings and scoring rules ─────────────────────────────────────────────
export const performanceWeightsInput = z
  .object({ goals: z.number().int(), delivery: z.number().int(), consistency: z.number().int(), quality: z.number().int(), attendance: z.number().int() })
  .strict()
  .superRefine((w, c) => {
    for (const message of weightIssues(w)) c.addIssue({ code: 'custom', message });
  });

export const performanceSettingsInput = z
  .object({
    weights: performanceWeightsInput.optional(),
    min_eligible_days: z.number().int().min(0).max(60).optional(),
    leaderboard_workers: z.boolean().optional(),
    leaderboard_managers: z.boolean().optional(),
    workers_see_own_score: z.boolean().optional(),
  })
  .strict();

export interface PerformanceSettingsDto {
  rules: { id: string; version: number; weights: PerformanceWeights; min_eligible_days: number; created_at: string };
  leaderboard_workers: boolean;
  leaderboard_managers: boolean;
  workers_see_own_score: boolean;
}

// ─── Milestones ──────────────────────────────────────────────────────────────
export const milestoneInput = z.object({
  title: nonEmpty(200),
  description: optionalText(2000),
  due_date: isoDate,
  client_visible: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export const milestonePatchInput = milestoneInput.partial().extend({ completed: z.boolean().optional() }).strict();

export interface MilestoneDto {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string;
  completed_at: string | null;
  completed_by: string | null;
  /** done on or before its due date (null while open) */
  on_time: boolean | null;
  client_visible: boolean;
  position: number;
}

// ─── Scores ──────────────────────────────────────────────────────────────────
export const scoreQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: '`from` must be on or before `to`', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 400, { message: 'Date range is limited to 400 days', path: ['to'] });

export interface ScorePartDto {
  /** 0–100, or null when not measured (never treated as zero) */
  value: number | null;
  weight: number;
  effective_weight: number;
}
export interface MemberScoreDto {
  membership_id: string;
  from: string;
  to: string;
  rule_version: number;
  /** 0–100 with one decimal; null when too little was measured */
  score: number | null;
  coverage: number;
  parts: Record<PerformanceMetric, ScorePartDto>;
  /** the counts behind each metric */
  inputs: {
    goals: { completed: number; due: number };
    delivery: { on_time: number; due: number };
    consistency: { approved_days: number; scheduled_days: number };
    quality: { reviews: number; average_rating: number | null };
    attendance: { on_time: number; scheduled: number };
  };
  approved_days: number;
  eligible: boolean;
}

// ─── Goals ───────────────────────────────────────────────────────────────────
export const goalInput = z
  .object({
    title: nonEmpty(200),
    description: optionalText(2000),
    category: optionalText(60),
    subject_type: z.enum(GOAL_SUBJECTS),
    subject_id: id.nullable().optional(),
    metric: z.enum(GOAL_METRICS),
    /** count, hours (for APPROVED_HOURS) or percent (ON_TIME_PCT, 1–100) */
    target: z.number().positive().max(1_000_000),
    start_date: isoDate,
    end_date: isoDate,
  })
  .refine(dateOrder, { message: 'The end date must be on or after the start date', path: ['end_date'] })
  .refine((v) => goalMetricAllowed(v.metric, v.subject_type), { message: 'This measure does not apply to that kind of goal', path: ['metric'] })
  .refine((v) => (v.subject_type === 'ORG' ? !v.subject_id : !!v.subject_id), { message: 'Choose who the goal is for', path: ['subject_id'] })
  .refine((v) => v.metric !== 'ON_TIME_PCT' || v.target <= 100, { message: 'A percentage target is at most 100', path: ['target'] });
export const goalPatchInput = z.object({ title: nonEmpty(200), description: optionalText(2000), category: optionalText(60), target: z.number().positive().max(1_000_000), end_date: isoDate, archived: z.boolean() }).partial().strict();

export interface GoalDto {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  subject_type: (typeof GOAL_SUBJECTS)[number];
  subject_id: string | null;
  subject_name: string;
  metric: (typeof GOAL_METRICS)[number];
  target: number;
  current: number;
  progress_pct: number;
  status: 'ACTIVE' | 'COMPLETED' | 'MISSED' | 'ARCHIVED';
  pace: GoalPace | null;
  start_date: string;
  end_date: string;
  completed_at: string | null;
  created_by: string | null;
}

// ─── Achievements ────────────────────────────────────────────────────────────
export const achievementDefinitionInput = z
  .object({
    name: nonEmpty(80),
    description: nonEmpty(400),
    category: z.enum(ACHIEVEMENT_CATEGORIES),
    icon: z.enum(ACHIEVEMENT_ICONS),
    mode: z.enum(['AUTOMATIC', 'MANUAL']),
    metric: z.enum(ACHIEVEMENT_METRICS).optional(),
    thresholds: z.array(z.number().int().positive().max(1_000_000)).optional(),
    recurrence: z.enum(AWARD_RECURRENCES),
    default_visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  })
  .superRefine((v, c) => {
    if (v.mode === 'AUTOMATIC') {
      if (!v.metric) c.addIssue({ code: 'custom', path: ['metric'], message: 'Choose what it is measured on' });
      for (const message of thresholdIssues(v.thresholds ?? [])) c.addIssue({ code: 'custom', path: ['thresholds'], message });
    } else if (v.metric || v.thresholds) c.addIssue({ code: 'custom', path: ['metric'], message: 'A manager-awarded achievement has no measure' });
  });

export const awardInput = z
  .object({
    definition_id: id,
    membership_id: id.optional(),
    team_id: id.optional(),
    tier: z.enum(ACHIEVEMENT_TIERS).optional(),
    reason: nonEmpty(1000),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    notify: z.boolean().optional(),
  })
  .refine((v) => !!v.membership_id !== !!v.team_id, { message: 'Choose one person or one team', path: ['membership_id'] });

export interface AchievementAwardDto {
  id: string;
  definition_id: string;
  name: string;
  icon: string;
  category: (typeof ACHIEVEMENT_CATEGORIES)[number];
  tier: AchievementTier | null;
  recipient: { type: 'MEMBER' | 'TEAM'; id: string; name: string };
  source: 'AUTOMATIC' | 'MANAGER' | 'CLIENT';
  awarded_by: string | null;
  reason: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  period_key: string;
  created_at: string;
}

// ─── Reviews ─────────────────────────────────────────────────────────────────
const shortList = z.array(nonEmpty(80)).max(12);
export const reviewInput = z
  .object({
    membership_id: id,
    period_start: isoDate,
    period_end: isoDate,
    quality_rating: z.number().int().min(1).max(5).nullable().optional(),
    summary: optionalText(4000),
    strengths: shortList.optional(),
    improvements: shortList.optional(),
    recommendations: optionalText(4000),
    private_note: optionalText(4000),
    shared_with_member: z.boolean().optional(),
    status: z.enum(['DRAFT', 'FINAL']).optional(),
  })
  .refine((v) => v.period_start <= v.period_end, { message: 'The period must end on or after it starts', path: ['period_end'] });

// ─── Filters ─────────────────────────────────────────────────────────────────
export const performanceFilter = z.object({
  period: z.enum(PERFORMANCE_PERIODS).default('MONTH'),
  date: isoDate.optional(),
  team_id: id.optional(),
  project_id: id.optional(),
});

// ─── Client appreciation ─────────────────────────────────────────────────────
export const appreciationInput = z.object({ project_id: id, membership_id: id.nullable().optional(), message: nonEmpty(1000) });
