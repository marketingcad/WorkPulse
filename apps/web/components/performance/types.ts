import type { AchievementAwardDto, GoalDto, MemberScoreDto } from '@tallywork/contracts';
import type { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_METRICS, PerformancePeriod } from '@tallywork/domain';
import type { MetricKey } from './ui';

/**
 * Response shapes of the Performance Center endpoints that have no DTO in @tallywork/contracts.
 * They mirror the service return values in packages/api/src/services/leaderboards.ts.
 */

/** GET /performance/achievements (AchievementDefinitionDto in services/achievements.ts) */
export interface AchievementDefinition {
  id: string;
  key: string | null;
  name: string;
  description: string;
  category: (typeof ACHIEVEMENT_CATEGORIES)[number];
  icon: string;
  mode: 'AUTOMATIC' | 'MANUAL';
  metric: (typeof ACHIEVEMENT_METRICS)[number] | null;
  thresholds: number[] | null;
  recurrence: 'ONCE' | PerformancePeriod;
  default_visibility: 'PUBLIC' | 'PRIVATE';
  custom: boolean;
  awardable: boolean;
  archived: boolean;
  earned_count: number;
  people_count: number;
  last_awarded_at: string | null;
}

/** GET /performance/appreciations (services/portal-insights.ts) */
export interface Appreciation {
  id: string;
  client: { id: string; name: string };
  project: { id: string; name: string };
  member: { id: string; name: string } | null;
  message: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/** GET /performance/leaderboard (services/leaderboards.ts `leaderboard`) */
export interface LeaderboardRow {
  id: string;
  name: string;
  sub: string | null;
  rank: number | null;
  /** places climbed since the previous period (negative: dropped); null when not ranked in both */
  movement: number | null;
  score: number | null;
  eligible: boolean;
  goals: { completed: number; due: number } | null;
  delivery: { on_time: number; due: number } | null;
  achievements: number;
  trend: Array<number | null>;
}
export interface Leaderboard {
  type: 'workers' | 'teams' | 'projects';
  period: PerformancePeriod;
  start: string;
  end: string;
  rule_version: number;
  min_eligible_days: number;
  compare: 'role' | 'everyone';
  summary_only: boolean;
  ranked: number;
  rows: LeaderboardRow[];
}

/** GET /performance/teams (services/leaderboards.ts `teamPerformance`) */
export interface TeamPerformance {
  period: PerformancePeriod;
  start: string;
  end: string;
  /** the six period starts the histories cover, oldest first */
  periods: string[];
  ranks_hidden: boolean;
  teams: Array<{
    id: string;
    name: string;
    members: number;
    rank: number | null;
    score: number | null;
    approved_seconds: number;
    goals: { completed: number; due: number };
    milestones: { on_time: number; due: number; done: number; total: number };
    attendance: { on_time: number; scheduled: number };
    achievements: number;
    history: Array<number | null>;
    people: Array<{ id: string; name: string; title: string | null; manager: boolean; score: number | null; approved_seconds: number; eligible: boolean }>;
  }>;
}

/** GET /performance/members (services/leaderboards.ts `memberPerformanceList`) */
export interface MemberPerformanceList {
  start: string;
  end: string;
  rows: Array<{ id: string; name: string; title: string | null; role: string; teams: string[]; score: number | null; eligible: boolean; approved_seconds: number; goals: { completed: number; due: number } | null; attendance: { on_time: number; scheduled: number } | null }>;
}

/** GET /performance/members/:id/profile (services/leaderboards.ts `memberProfile`) */
export interface MemberProfile {
  member: { id: string; name: string; title: string | null; role: string; teams: Array<{ id: string; name: string }>; projects: Array<{ id: string; name: string }> };
  period: { type: PerformancePeriod; start: string; end: string };
  score: MemberScoreDto;
  ranks_hidden: boolean;
  rank: number | null;
  rank_group_size: number | null;
  rank_group: string | null;
  rule_version: number;
  kpis: { approved_seconds: number; attendance: { on_time: number; scheduled: number }; goals: { completed: number; due: number }; milestones_on_time: number; milestones_done: number; tasks_done: number };
  contributions: Array<{ project_id: string; name: string; approved_seconds: number; tasks_done: number; milestones_done: number }>;
  goals: GoalDto[];
  achievements: AchievementAwardDto[];
  history: Array<{ period_start: string; period_end: string; score: number | null; coverage: number; rule_version: number; eligible: boolean; final: boolean; calculated_at: string | null }>;
}

/** GET /performance/members/:id/reviews (services/reviews.ts) */
export interface Review {
  id: string;
  membership_id: string;
  reviewer: { id: string; name: string };
  period_start: string;
  period_end: string;
  quality_rating: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  recommendations: string | null;
  /** only for people with reviews:read over the member; never for the member */
  private_note?: string | null;
  shared_with_member: boolean;
  status: 'DRAFT' | 'FINAL';
  created_at: string;
  updated_at: string;
}

export interface ScorePart {
  value: number | null;
  weight: number | null;
  /** how many people the average is made of */
  measured_for: number;
}

export type MilestoneStep = 'ON_TIME' | 'LATE' | 'OVERDUE' | 'OPEN';

/** GET /performance/overview */
export interface PerformanceOverview {
  period: PerformancePeriod;
  start: string;
  end: string;
  kpis: {
    active_workers: number;
    active_teams: number;
    score: number | null;
    previous_score: number | null;
    achievements: number;
    achievements_automatic: number;
    goals_completed: number;
    goals_due: number;
    team_goal_completion: number | null;
    project_delivery: number | null;
    milestones_on_time: number;
    milestones_due: number;
  };
  score_trend: Array<{ start: string; score: number | null }>;
  parts: Record<MetricKey, ScorePart>;
  teams: Array<{ id: string; name: string; members: number; score: number | null; attendance: { on_time: number; scheduled: number } }>;
  achievements_by_month: Array<{ month: string; bronze: number; silver: number; gold: number; platinum: number }>;
  goals_by_month: Array<{ month: string; due: number; completed: number }>;
  projects: Array<{ id: string; name: string; total: number; done: number; status: 'DONE' | 'AT_RISK' | 'ON_TRACK' | null; next: { title: string; due_date: string } | null; steps: MilestoneStep[] }>;
  recognition: AchievementAwardDto[];
}
