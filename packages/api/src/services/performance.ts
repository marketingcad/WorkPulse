import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  memberships,
  performanceGoals,
  performanceReviews,
  performanceRules,
  performanceScoreSnapshots,
  performanceSettings,
  projectMilestones,
  projects,
  taskAssignees,
  tasks,
  timeEntries,
  timesheets,
  type Tx,
} from '@tallywork/db';
import {
  DEFAULT_MIN_ELIGIBLE_DAYS,
  DEFAULT_PERFORMANCE_WEIGHTS,
  assertValidWeights,
  businessRule,
  can,
  computeScore,
  forbidden,
  isPeriodSettled,
  localDate,
  metricValues,
  newId,
  notFound,
  validation,
  type PerformancePeriod,
  type PerformanceWeights,
} from '@tallywork/domain';
import type { MemberScoreDto, MilestoneDto, PerformanceSettingsDto, milestoneInput, milestonePatchInput, performanceSettingsInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { computeAttendance } from './operations';
import { iso } from '../lib/http';

/**
 * Performance Center foundation: scoring rules and visibility, project milestones, and member scores
 * computed from approved and completed work only (packages/domain/src/performance.ts has the rules).
 */

type Rule = typeof performanceRules.$inferSelect;

// ─── Rules and settings ──────────────────────────────────────────────────────

/** The current scoring rules (the highest version), created with the defaults on first use. */
export async function currentRules(tx: Tx, orgId: string): Promise<Rule> {
  const [latest] = await tx.select().from(performanceRules).where(eq(performanceRules.organizationId, orgId)).orderBy(desc(performanceRules.version)).limit(1);
  if (latest) return latest;
  await tx
    .insert(performanceRules)
    .values({ id: newId(), organizationId: orgId, version: 1, weights: DEFAULT_PERFORMANCE_WEIGHTS, minEligibleDays: DEFAULT_MIN_ELIGIBLE_DAYS })
    .onConflictDoNothing();
  const [first] = await tx.select().from(performanceRules).where(eq(performanceRules.organizationId, orgId)).orderBy(desc(performanceRules.version)).limit(1);
  return first!;
}

export async function currentSettings(tx: Tx, orgId: string) {
  const [s] = await tx.select().from(performanceSettings).where(eq(performanceSettings.organizationId, orgId));
  if (s) return s;
  await tx.insert(performanceSettings).values({ id: newId(), organizationId: orgId }).onConflictDoNothing();
  const [created] = await tx.select().from(performanceSettings).where(eq(performanceSettings.organizationId, orgId));
  return created!;
}

function settingsDto(rule: Rule, s: typeof performanceSettings.$inferSelect): PerformanceSettingsDto {
  return {
    rules: { id: rule.id, version: rule.version, weights: rule.weights, min_eligible_days: rule.minEligibleDays, created_at: iso(rule.createdAt)! },
    leaderboard_workers: s.leaderboardWorkers,
    leaderboard_managers: s.leaderboardManagers,
    workers_see_own_score: s.workersSeeOwnScore,
  };
}

/** Anyone who can read performance may see how scores are made (transparency); only admins change it. */
export async function getPerformanceSettings(x: Ctx): Promise<PerformanceSettingsDto> {
  if (!x.actor.grants['performance:read']) throw forbidden();
  return settingsDto(await currentRules(x.tx, x.org.id), await currentSettings(x.tx, x.org.id));
}

const sameWeights = (a: PerformanceWeights, b: PerformanceWeights) => (Object.keys(DEFAULT_PERFORMANCE_WEIGHTS) as Array<keyof PerformanceWeights>).every((k) => a[k] === b[k]);

/**
 * Change the scoring rules and who sees rankings. New weights never edit the current rules: they
 * become a new version, so every saved score can still be reproduced with the rules it used.
 */
export async function updatePerformanceSettings(x: Ctx, input: z.infer<typeof performanceSettingsInput>): Promise<PerformanceSettingsDto> {
  if (!can(x.actor, 'performance:manage')) throw forbidden();
  const rule = await currentRules(x.tx, x.org.id);
  const settings = await currentSettings(x.tx, x.org.id);
  const weights = input.weights ?? rule.weights;
  assertValidWeights(weights);
  const minDays = input.min_eligible_days ?? rule.minEligibleDays;
  let next = rule;
  if (!sameWeights(weights, rule.weights) || minDays !== rule.minEligibleDays) {
    const [created] = await x.tx
      .insert(performanceRules)
      .values({ id: newId(), organizationId: x.org.id, version: rule.version + 1, weights, minEligibleDays: minDays, createdBy: x.actor.membershipId })
      .returning();
    next = created!;
    await emitFrom(x, 'performance.rules.changed', { version: next.version, weights, min_eligible_days: minDays });
  }
  const patch = {
    leaderboardWorkers: input.leaderboard_workers ?? settings.leaderboardWorkers,
    leaderboardManagers: input.leaderboard_managers ?? settings.leaderboardManagers,
    workersSeeOwnScore: input.workers_see_own_score ?? settings.workersSeeOwnScore,
  };
  const [saved] = await x.tx.update(performanceSettings).set({ ...patch, updatedBy: x.actor.membershipId, updatedAt: new Date() }).where(eq(performanceSettings.id, settings.id)).returning();
  await audit(x, {
    action: 'performance.settings_updated',
    targetType: 'performance_settings',
    targetId: saved!.id,
    before: { version: rule.version, weights: rule.weights, min_eligible_days: rule.minEligibleDays, leaderboard_workers: settings.leaderboardWorkers, leaderboard_managers: settings.leaderboardManagers, workers_see_own_score: settings.workersSeeOwnScore },
    after: { version: next.version, weights: next.weights, min_eligible_days: next.minEligibleDays, ...input },
  });
  return settingsDto(next, saved!);
}

// ─── Milestones ──────────────────────────────────────────────────────────────

type Milestone = typeof projectMilestones.$inferSelect;

function milestoneDto(m: Milestone, timeZone: string): MilestoneDto {
  return {
    id: m.id,
    project_id: m.projectId,
    title: m.title,
    description: m.description,
    due_date: m.dueDate,
    completed_at: iso(m.completedAt),
    completed_by: m.completedBy,
    on_time: m.completedAt ? localDate(m.completedAt, timeZone) <= m.dueDate : null,
    client_visible: m.clientVisible,
    position: m.position,
  };
}

async function projectFor(x: Ctx, projectId: string) {
  const [p] = await x.tx.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, projectId));
  // Same answer for a project that does not exist and one the actor cannot see.
  if (!p || !can(x.actor, 'projects:read', { projectId })) throw notFound('project');
  return p;
}

export async function listMilestones(x: Ctx, projectId: string): Promise<MilestoneDto[]> {
  await projectFor(x, projectId);
  const rows = await x.tx
    .select()
    .from(projectMilestones)
    .where(and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.archivedAt)))
    .orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.position), asc(projectMilestones.createdAt));
  return rows.map((m) => milestoneDto(m, x.org.timezone));
}

export async function createMilestone(x: Ctx, projectId: string, input: z.infer<typeof milestoneInput>): Promise<MilestoneDto> {
  const p = await projectFor(x, projectId);
  if (!can(x.actor, 'projects:manage', { projectId })) throw forbidden();
  if (p.archivedAt) throw businessRule('project_archived', 'This project is archived. Restore it to change its milestones.');
  const [m] = await x.tx
    .insert(projectMilestones)
    .values({ id: newId(), organizationId: x.org.id, projectId, title: input.title, description: input.description ?? null, dueDate: input.due_date, clientVisible: input.client_visible ?? true, position: input.position ?? 0, createdBy: x.actor.membershipId })
    .returning();
  await audit(x, { action: 'milestone.created', targetType: 'milestone', targetId: m!.id, after: { project_id: projectId, ...input } });
  return milestoneDto(m!, x.org.timezone);
}

async function milestoneFor(x: Ctx, id: string) {
  const [m] = await x.tx.select().from(projectMilestones).where(and(eq(projectMilestones.id, id), isNull(projectMilestones.archivedAt)));
  if (!m || !can(x.actor, 'projects:read', { projectId: m.projectId })) throw notFound('milestone');
  if (!can(x.actor, 'projects:manage', { projectId: m.projectId })) throw forbidden();
  return m;
}

/** Edit a milestone, or mark it done (`completed`); completing it emits `milestone.completed` once. */
export async function updateMilestone(x: Ctx, id: string, input: z.infer<typeof milestonePatchInput>): Promise<MilestoneDto> {
  const m = await milestoneFor(x, id);
  const patch: Partial<typeof projectMilestones.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.due_date !== undefined) {
    // The due date of delivered work is part of its record (on time or late): it is not moved after.
    if (m.completedAt && input.due_date !== m.dueDate) throw businessRule('milestone_completed', 'This milestone is done. Reopen it to change its due date.');
    patch.dueDate = input.due_date;
  }
  if (input.client_visible !== undefined) patch.clientVisible = input.client_visible;
  if (input.position !== undefined) patch.position = input.position;
  const completing = input.completed === true && !m.completedAt;
  if (completing) {
    patch.completedAt = x.deps.now();
    patch.completedBy = x.actor.membershipId;
  } else if (input.completed === false && m.completedAt) {
    patch.completedAt = null;
    patch.completedBy = null;
  }
  const [saved] = await x.tx.update(projectMilestones).set(patch).where(eq(projectMilestones.id, id)).returning();
  const dto = milestoneDto(saved!, x.org.timezone);
  if (completing) await emitFrom(x, 'milestone.completed', { milestone_id: id, project_id: m.projectId, due_date: saved!.dueDate, completed_at: dto.completed_at, on_time: dto.on_time });
  await audit(x, { action: completing ? 'milestone.completed' : input.completed === false && m.completedAt ? 'milestone.reopened' : 'milestone.updated', targetType: 'milestone', targetId: id, before: milestoneDto(m, x.org.timezone), after: dto });
  return dto;
}

export async function archiveMilestone(x: Ctx, id: string): Promise<void> {
  await milestoneFor(x, id);
  await x.tx.update(projectMilestones).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(projectMilestones.id, id));
  await audit(x, { action: 'milestone.archived', targetType: 'milestone', targetId: id });
}

// ─── Member scores ───────────────────────────────────────────────────────────

const minDate = (a: string, b: string) => (a < b ? a : b);

/**
 * The counts behind a member's score for [from, to], from server data only. Nothing in the future
 * counts against anyone: due work and shifts are only counted up to today.
 */
export async function memberMetricInputs(tx: Tx, org: Ctx['org'], membershipId: string, from: string, to: string, now: Date) {
  const today = localDate(now, org.timezone);
  const until = minDate(to, today);

  // Goals for this member that ended in the period (up to today), or were reached in it.
  const goals = await tx
    .select({ status: performanceGoals.status, current: performanceGoals.currentValue, target: performanceGoals.targetValue, end: performanceGoals.endDate })
    .from(performanceGoals)
    .where(and(eq(performanceGoals.subjectType, 'MEMBER'), eq(performanceGoals.membershipId, membershipId), sql`${performanceGoals.status} <> 'ARCHIVED'`, gte(performanceGoals.endDate, from), lte(performanceGoals.endDate, to)));
  const goalsDue = goals.filter((g) => g.status === 'COMPLETED' || g.end <= until);
  const goalsDone = goalsDue.filter((g) => g.status === 'COMPLETED').length;

  // Assigned tasks due in the period: done by their due date (in the organization's time zone)?
  const due = await tx
    .select({ dueDate: tasks.dueDate, completedAt: tasks.completedAt })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(and(eq(taskAssignees.membershipId, membershipId), isNull(tasks.archivedAt), isNotNull(tasks.dueDate), gte(tasks.dueDate, from), lte(tasks.dueDate, to)));
  const counted = due.filter((t) => t.dueDate! <= until || t.completedAt);
  const onTime = counted.filter((t) => t.completedAt && localDate(t.completedAt, org.timezone) <= t.dueDate!).length;

  // Approved days: dates with time inside an approved timesheet.
  const approvedRows = await tx
    .select({ d: timeEntries.localDate, s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
    .from(timeEntries)
    .innerJoin(timesheets, and(eq(timesheets.membershipId, timeEntries.membershipId), eq(timesheets.status, 'APPROVED'), lte(timesheets.periodStart, timeEntries.localDate), gte(timesheets.periodEnd, timeEntries.localDate)))
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), gte(timeEntries.localDate, from), lte(timeEntries.localDate, until)))
    .groupBy(timeEntries.localDate);
  const approvedSeconds = approvedRows.reduce((sum, r) => sum + Number(r.s), 0);
  const approvedDays = new Set(approvedRows.map((r) => r.d));

  // Scheduled shifts that were due (leave, holidays and days off are not counted).
  const attendance = from <= until ? await computeAttendance(tx, org.id, org.settings.lateGraceMinutes, [membershipId], from, until, now) : [];
  const dueShifts = attendance.filter((a) => a.date >= from && a.date <= until && (a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'ABSENT'));
  const scheduledDays = [...new Set(dueShifts.map((a) => a.date))];

  // Final reviews covering the period.
  const reviews = await tx
    .select({ rating: performanceReviews.qualityRating })
    .from(performanceReviews)
    .where(and(eq(performanceReviews.membershipId, membershipId), eq(performanceReviews.status, 'FINAL'), isNull(performanceReviews.archivedAt), isNotNull(performanceReviews.qualityRating), lte(performanceReviews.periodStart, to), gte(performanceReviews.periodEnd, from)));
  const ratings = reviews.map((r) => r.rating!);

  return {
    goals: { completed: goalsDone, due: goalsDue.length },
    delivery: { onTime, due: counted.length },
    consistency: { approvedDays: scheduledDays.filter((d) => approvedDays.has(d)).length, scheduledDays: scheduledDays.length },
    quality: { ratings },
    attendance: { onTime: dueShifts.filter((a) => a.status === 'PRESENT').length, scheduled: dueShifts.length },
    approvedDayCount: approvedDays.size,
    approvedSeconds,
  };
}

function scoreDto(membershipId: string, from: string, to: string, rule: Rule, inputs: Awaited<ReturnType<typeof memberMetricInputs>>): MemberScoreDto {
  const result = computeScore(metricValues(inputs), rule.weights);
  const avg = inputs.quality.ratings.length ? Math.round((inputs.quality.ratings.reduce((s, r) => s + r, 0) / inputs.quality.ratings.length) * 10) / 10 : null;
  return {
    membership_id: membershipId,
    from,
    to,
    rule_version: rule.version,
    score: result.score,
    coverage: result.coverage,
    parts: result.parts,
    inputs: {
      goals: inputs.goals,
      delivery: { on_time: inputs.delivery.onTime, due: inputs.delivery.due },
      consistency: { approved_days: inputs.consistency.approvedDays, scheduled_days: inputs.consistency.scheduledDays },
      quality: { reviews: inputs.quality.ratings.length, average_rating: avg },
      attendance: { on_time: inputs.attendance.onTime, scheduled: inputs.attendance.scheduled },
    },
    approved_days: inputs.approvedDayCount,
    eligible: inputs.approvedDayCount >= rule.minEligibleDays,
  };
}

/**
 * The member must exist in this organization and be within the actor's reach (one answer for both).
 * Someone who can only read their own performance sees their score only when the organization shares
 * scores with workers (`workers_see_own_score`), on every route, not only in the desktop app.
 */
async function assertCanSeeMember(x: Ctx, membershipId: string) {
  const [m] = await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, membershipId));
  if (!m || !can(x.actor, 'performance:read', { ownerMembershipId: membershipId })) throw notFound('member');
  if (x.actor.grants['performance:read'] === 'own' && !(await currentSettings(x.tx, x.org.id)).workersSeeOwnScore) {
    throw forbidden('Your organization does not share scores with workers.');
  }
}

/** A member's score for a date range, if the actor may see that member's performance. */
export async function memberScore(x: Ctx, membershipId: string, from: string, to: string): Promise<MemberScoreDto> {
  await assertCanSeeMember(x, membershipId);
  const rule = await currentRules(x.tx, x.org.id);
  return scoreDto(membershipId, from, to, rule, await memberMetricInputs(x.tx, x.org, membershipId, from, to, x.deps.now()));
}

/**
 * Save a member's score for a calendar period, with the rule version and the counts it came from.
 * A final snapshot (the period is over) is history: it is returned as it is and never recalculated,
 * even after the rules change.
 */
export async function snapshotMemberScore(
  tx: Tx,
  org: Ctx['org'],
  now: Date,
  q: { membershipId: string; periodType: PerformancePeriod; periodStart: string; periodEnd: string; rankGroup?: string | null },
): Promise<typeof performanceScoreSnapshots.$inferSelect> {
  if (q.periodEnd < q.periodStart) throw validation('The period must end on or after it starts');
  const [existing] = await tx.select().from(performanceScoreSnapshots).where(snapshotKey('MEMBER', q.membershipId, q.periodType, q.periodStart));
  if (existing?.final) return existing;
  const rule = await currentRules(tx, org.id);
  const inputs = await memberMetricInputs(tx, org, q.membershipId, q.periodStart, q.periodEnd, now);
  const dto = scoreDto(q.membershipId, q.periodStart, q.periodEnd, rule, inputs);
  return saveSnapshot(tx, org.id, {
    subjectType: 'MEMBER',
    subjectId: q.membershipId,
    periodType: q.periodType,
    periodStart: q.periodStart,
    periodEnd: q.periodEnd,
    ruleId: rule.id,
    ruleVersion: rule.version,
    score: dto.score,
    coverage: dto.coverage,
    metrics: { parts: dto.parts, inputs: dto.inputs, approved_days: dto.approved_days, approved_seconds: inputs.approvedSeconds },
    eligible: dto.eligible,
    rankGroup: q.rankGroup ?? null,
    final: isPeriodSettled(q.periodEnd, localDate(now, org.timezone)),
    calculatedAt: now,
  });
}

type SnapshotValues = Omit<typeof performanceScoreSnapshots.$inferInsert, 'id' | 'organizationId'>;

const snapshotKey = (subjectType: SnapshotValues['subjectType'], subjectId: string, periodType: PerformancePeriod, periodStart: string) =>
  and(eq(performanceScoreSnapshots.subjectType, subjectType), eq(performanceScoreSnapshots.subjectId, subjectId), eq(performanceScoreSnapshots.periodType, periodType), eq(performanceScoreSnapshots.periodStart, periodStart));

/**
 * Insert or update one snapshot in a single statement, so two first reads of a period (or a read and
 * the daily job) cannot both insert it. A final snapshot is never overwritten: it is returned as it is.
 */
export async function saveSnapshot(tx: Tx, orgId: string, s: SnapshotValues) {
  const { subjectType, subjectId, periodType, periodStart, periodEnd, ...values } = s;
  const [row] = await tx
    .insert(performanceScoreSnapshots)
    .values({ id: newId(), organizationId: orgId, ...s })
    .onConflictDoUpdate({
      target: [performanceScoreSnapshots.organizationId, performanceScoreSnapshots.subjectType, performanceScoreSnapshots.subjectId, performanceScoreSnapshots.periodType, performanceScoreSnapshots.periodStart],
      set: { periodEnd, ...values },
      setWhere: eq(performanceScoreSnapshots.final, false),
    })
    .returning();
  if (row) return row;
  const [kept] = await tx.select().from(performanceScoreSnapshots).where(snapshotKey(subjectType, subjectId, periodType as PerformancePeriod, periodStart));
  return kept!;
}

/** Saved scores of members the actor may see, newest period first. */
export async function listMemberSnapshots(x: Ctx, membershipId: string, periodType: PerformancePeriod) {
  await assertCanSeeMember(x, membershipId);
  const rows = await x.tx
    .select()
    .from(performanceScoreSnapshots)
    .where(and(eq(performanceScoreSnapshots.subjectType, 'MEMBER'), eq(performanceScoreSnapshots.subjectId, membershipId), eq(performanceScoreSnapshots.periodType, periodType)))
    .orderBy(desc(performanceScoreSnapshots.periodStart))
    .limit(24);
  return rows.map((r) => ({ period_start: r.periodStart, period_end: r.periodEnd, score: r.score, coverage: r.coverage, rule_version: r.ruleVersion, eligible: r.eligible, final: r.final, calculated_at: iso(r.calculatedAt) }));
}

