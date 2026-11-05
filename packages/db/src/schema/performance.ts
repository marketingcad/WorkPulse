import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AchievementCategory, AchievementMetric, AchievementTier, AwardRecurrence, GoalMetric, GoalSubject, PerformancePeriod, PerformanceWeights } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';
import { memberships, organizations } from './identity';
import { clients, projects, teams } from './workforce';
import { clientPortalAccess } from './portal';

/**
 * Performance Center (docs/plan: Performance Center). Every table is tenant-owned (RLS) and keyed to
 * its organization with composite foreign keys, so a row can never point at another tenant's data.
 * Scores come only from approved and completed work; see packages/domain/src/performance.ts.
 */

/** Scoring rules, one immutable row per version: a score snapshot records the version it used. */
export const performanceRules = pgTable(
  'performance_rules',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    weights: jsonb().$type<PerformanceWeights>().notNull(),
    /** fewer approved days in a period: not ranked */
    minEligibleDays: integer().notNull(),
    createdBy: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [unique('performance_rules_org_id_uq').on(t.organizationId, t.id), unique('performance_rules_version_uq').on(t.organizationId, t.version)],
);

/** Who sees what, one row per organization (created with defaults on first use). */
export const performanceSettings = pgTable(
  'performance_settings',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** organization-wide rankings for workers: off unless an admin turns them on */
    leaderboardWorkers: boolean().notNull().default(false),
    /** team managers see rankings of the teams they manage */
    leaderboardManagers: boolean().notNull().default(true),
    /** workers see their own score in the desktop app */
    workersSeeOwnScore: boolean().notNull().default(false),
    updatedBy: uuid(),
    ...timestamps,
  },
  (t) => [unique('performance_settings_org_uq').on(t.organizationId)],
);

/** Project milestones: a dated deliverable, done or not. A source of truth for delivery and goals. */
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: pk(),
    organizationId: orgId(),
    projectId: uuid().notNull(),
    title: text().notNull(),
    description: text(),
    /** YYYY-MM-DD, like project dates */
    dueDate: text().notNull(),
    completedAt: tstz(),
    completedBy: uuid(),
    /** shown in the client portal (titles and dates only) */
    clientVisible: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    createdBy: uuid(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('project_milestones_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    index().on(t.organizationId, t.projectId, t.dueDate),
  ],
);

/** Goals for a member, team, project or the whole organization, measured from existing data. */
export const performanceGoals = pgTable(
  'performance_goals',
  {
    id: pk(),
    organizationId: orgId(),
    title: text().notNull(),
    description: text(),
    category: text(),
    subjectType: text().$type<GoalSubject>().notNull(),
    membershipId: uuid(),
    teamId: uuid(),
    projectId: uuid(),
    metric: text().$type<GoalMetric>().notNull(),
    /** tasks or milestones (count), hours (seconds) or percent */
    targetValue: integer().notNull(),
    currentValue: integer().notNull().default(0),
    startDate: text().notNull(),
    endDate: text().notNull(),
    status: text().$type<'ACTIVE' | 'COMPLETED' | 'MISSED' | 'ARCHIVED'>().notNull().default('ACTIVE'),
    completedAt: tstz(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    unique('performance_goals_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    // The subject column that matches the subject type is set, and only that one.
    check(
      'performance_goals_subject_ck',
      sql`(${t.subjectType} = 'MEMBER' and ${t.membershipId} is not null and ${t.teamId} is null and ${t.projectId} is null)
       or (${t.subjectType} = 'TEAM' and ${t.teamId} is not null and ${t.membershipId} is null and ${t.projectId} is null)
       or (${t.subjectType} = 'PROJECT' and ${t.projectId} is not null and ${t.membershipId} is null and ${t.teamId} is null)
       or (${t.subjectType} = 'ORG' and ${t.membershipId} is null and ${t.teamId} is null and ${t.projectId} is null)`,
    ),
    check('performance_goals_target_ck', sql`${t.targetValue} > 0 and ${t.endDate} >= ${t.startDate}`),
    index().on(t.organizationId, t.status, t.endDate),
    index().on(t.organizationId, t.membershipId),
  ],
);

/** Every change to a goal's progress, append-only. `sourceKey` makes event handling idempotent. */
export const performanceGoalProgress = pgTable(
  'performance_goal_progress',
  {
    id: pk(),
    organizationId: orgId(),
    goalId: uuid().notNull(),
    value: integer().notNull(),
    /** what moved it: 'task', 'milestone', 'timesheet', 'attendance', 'recalculation', 'created', 'edited' */
    source: text().notNull(),
    /** the event or record behind the change; one row per goal and source key */
    sourceKey: text().notNull(),
    actorMembershipId: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.goalId], foreignColumns: [performanceGoals.organizationId, performanceGoals.id] }).onDelete('cascade'),
    uniqueIndex('performance_goal_progress_source_uq').on(t.organizationId, t.goalId, t.sourceKey),
    index().on(t.organizationId, t.goalId, t.createdAt),
  ],
);

/** The achievement catalogue: built-ins (with a `key`) and an organization's own (key null). */
export const achievementDefinitions = pgTable(
  'achievement_definitions',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    /** built-in key (BUILTIN_ACHIEVEMENTS), null for a custom achievement */
    key: text(),
    name: text().notNull(),
    description: text().notNull(),
    category: text().$type<AchievementCategory>().notNull(),
    icon: text().notNull(),
    mode: text().$type<'AUTOMATIC' | 'MANUAL'>().notNull(),
    metric: text().$type<AchievementMetric>(),
    thresholds: jsonb().$type<number[]>(),
    recurrence: text().$type<AwardRecurrence>().notNull(),
    defaultVisibility: text().$type<'PUBLIC' | 'PRIVATE'>().notNull().default('PUBLIC'),
    createdBy: uuid(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('achievement_definitions_org_id_uq').on(t.organizationId, t.id),
    uniqueIndex('achievement_definitions_key_uq').on(t.organizationId, t.key),
    check('achievement_definitions_mode_ck', sql`(${t.mode} = 'AUTOMATIC' and ${t.metric} is not null and ${t.thresholds} is not null) or (${t.mode} = 'MANUAL' and ${t.metric} is null)`),
  ],
);

/**
 * An achievement given to a member or a team: earned automatically, awarded by a manager, or from an
 * approved client appreciation. Never deleted; revoking keeps the row. One per achievement, recipient,
 * level and eligibility period (`recipientKey` = 'm:<membership>' or 't:<team>').
 */
export const achievementAwards = pgTable(
  'achievement_awards',
  {
    id: pk(),
    organizationId: orgId(),
    definitionId: uuid().notNull(),
    membershipId: uuid(),
    teamId: uuid(),
    recipientKey: text().notNull(),
    /** BRONZE…PLATINUM, or NONE for a single-level achievement */
    tier: text().$type<AchievementTier | 'NONE'>().notNull().default('NONE'),
    periodKey: text().notNull(),
    source: text().$type<'AUTOMATIC' | 'MANAGER' | 'CLIENT'>().notNull(),
    awardedBy: uuid(),
    reason: text(),
    visibility: text().$type<'PUBLIC' | 'PRIVATE'>().notNull().default('PUBLIC'),
    /** what it was earned on (metric value, period, rule version) */
    evidence: jsonb().$type<Record<string, unknown>>(),
    revokedAt: tstz(),
    revokedBy: uuid(),
    revokeReason: text(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    unique('achievement_awards_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.definitionId], foreignColumns: [achievementDefinitions.organizationId, achievementDefinitions.id] }),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }).onDelete('cascade'),
    uniqueIndex('achievement_awards_once_uq').on(t.organizationId, t.definitionId, t.recipientKey, t.tier, t.periodKey),
    check('achievement_awards_recipient_ck', sql`(${t.membershipId} is not null and ${t.teamId} is null) or (${t.teamId} is not null and ${t.membershipId} is null)`),
    index().on(t.organizationId, t.membershipId, t.createdAt),
    index().on(t.organizationId, t.createdAt),
  ],
);

/** Manager reviews. `privateNote` is for managers and admins only, never the member or a client. */
export const performanceReviews = pgTable(
  'performance_reviews',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    reviewerMembershipId: uuid().notNull(),
    periodStart: text().notNull(),
    periodEnd: text().notNull(),
    /** 1–5; final reviews feed the quality metric */
    qualityRating: integer(),
    summary: text(),
    strengths: jsonb().$type<string[]>().notNull().default([]),
    improvements: jsonb().$type<string[]>().notNull().default([]),
    recommendations: text(),
    privateNote: text(),
    sharedWithMember: boolean().notNull().default(false),
    status: text().$type<'DRAFT' | 'FINAL'>().notNull().default('DRAFT'),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('performance_reviews_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.reviewerMembershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    check('performance_reviews_rating_ck', sql`${t.qualityRating} is null or ${t.qualityRating} between 1 and 5`),
    check('performance_reviews_period_ck', sql`${t.periodEnd} >= ${t.periodStart}`),
    index().on(t.organizationId, t.membershipId, t.periodEnd),
  ],
);

/**
 * A calculated score for one subject and period, with the rule version and the inputs it used, so it
 * can be reproduced. A final snapshot (the period is over) is never recalculated.
 */
export const performanceScoreSnapshots = pgTable(
  'performance_score_snapshots',
  {
    id: pk(),
    organizationId: orgId(),
    subjectType: text().$type<'MEMBER' | 'TEAM' | 'PROJECT' | 'ORG'>().notNull(),
    /** membership, team or project id; the organization id for ORG */
    subjectId: uuid().notNull(),
    periodType: text().$type<PerformancePeriod>().notNull(),
    periodStart: text().notNull(),
    periodEnd: text().notNull(),
    ruleId: uuid().notNull(),
    ruleVersion: integer().notNull(),
    /** null: too little measured for a score */
    score: numeric({ precision: 4, scale: 1, mode: 'number' }),
    coverage: integer().notNull(),
    /** the metric values (0–100 or null) and the raw counts they came from */
    metrics: jsonb().$type<Record<string, unknown>>().notNull(),
    /** ranked this period (enough approved days) */
    eligible: boolean().notNull(),
    /** the comparison group (role family) it is ranked in */
    rankGroup: text(),
    final: boolean().notNull().default(false),
    calculatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.ruleId], foreignColumns: [performanceRules.organizationId, performanceRules.id] }),
    uniqueIndex('performance_score_snapshots_uq').on(t.organizationId, t.subjectType, t.subjectId, t.periodType, t.periodStart),
    index().on(t.organizationId, t.periodType, t.periodStart, t.subjectType),
  ],
);

/** Appreciation a client sends from the portal. Nobody sees it until the organization approves it. */
export const clientAppreciations = pgTable(
  'client_appreciations',
  {
    id: pk(),
    organizationId: orgId(),
    clientId: uuid().notNull(),
    portalAccessId: uuid().notNull(),
    projectId: uuid().notNull(),
    /** a contributor on the project; null = the project team */
    membershipId: uuid(),
    message: text().notNull(),
    status: text().$type<'PENDING' | 'APPROVED' | 'DECLINED'>().notNull().default('PENDING'),
    decidedBy: uuid(),
    decidedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.portalAccessId], foreignColumns: [clientPortalAccess.id] }).onDelete('cascade'),
    index().on(t.organizationId, t.status, t.createdAt),
  ],
);
