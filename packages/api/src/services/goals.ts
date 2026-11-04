import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  memberships,
  performanceGoalProgress,
  performanceGoals,
  projectMilestones,
  projectTeams,
  projects,
  taskAssignees,
  tasks,
  teamMembers,
  timeEntries,
  timesheets,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, businessRule, can, evaluateGoal, forbidden, localDate, newId, notFound, type GoalMetric } from '@tallywork/domain';
import type { GoalDto, goalInput, goalPatchInput } from '@tallywork/contracts';
import type { Deps, OrgInfo } from '../context';
import type { Ctx } from './ctx';
import { audit, emit, emitFrom } from './events';
import { notify } from './notify';
import { computeAttendance } from './operations';
import { canActOnTeam, canSeeTeam, orgToday, teamRoster } from './performance-access';
import { memberNames } from './timer';
import { iso } from '../lib/http';

type Goal = typeof performanceGoals.$inferSelect;

/** Approved hours are stored as seconds; every other measure as a count or a percent. */
const toStored = (metric: GoalMetric, v: number) => (metric === 'APPROVED_HOURS' ? Math.round(v * 3600) : Math.round(v));
const fromStored = (metric: GoalMetric, v: number) => (metric === 'APPROVED_HOURS' ? Math.round((v / 3600) * 10) / 10 : v);

// ─── Access ──────────────────────────────────────────────────────────────────

async function canReadGoal(x: Ctx, g: Pick<Goal, 'subjectType' | 'membershipId' | 'teamId' | 'projectId'>): Promise<boolean> {
  if (!x.actor.grants['goals:read']) return false;
  switch (g.subjectType) {
    case 'MEMBER':
      return can(x.actor, 'goals:read', { ownerMembershipId: g.membershipId! });
    case 'TEAM':
      return canSeeTeam(x, 'goals:read', g.teamId!);
    case 'PROJECT':
      return can(x.actor, 'goals:read', { projectId: g.projectId! }) && can(x.actor, 'projects:read', { projectId: g.projectId! });
    case 'ORG':
      return true;
  }
}

async function canManageGoal(x: Ctx, g: Pick<Goal, 'subjectType' | 'membershipId' | 'teamId' | 'projectId'>): Promise<boolean> {
  if (!x.actor.grants['goals:manage']) return false;
  switch (g.subjectType) {
    case 'MEMBER':
      return can(x.actor, 'goals:manage', { ownerMembershipId: g.membershipId! });
    case 'TEAM':
      return canActOnTeam(x, 'goals:manage', g.teamId!);
    case 'PROJECT':
      return x.actor.grants['goals:manage'] === 'org' || (can(x.actor, 'goals:manage', { projectId: g.projectId! }) && can(x.actor, 'projects:read', { projectId: g.projectId! }));
    case 'ORG':
      return x.actor.grants['goals:manage'] === 'org';
  }
}

// ─── Measuring ───────────────────────────────────────────────────────────────

/** Members a goal is measured over (MEMBER: one; TEAM: its members; ORG: every active member). */
async function subjectMembers(tx: Tx, g: Goal): Promise<string[] | 'project'> {
  if (g.subjectType === 'MEMBER') return [g.membershipId!];
  if (g.subjectType === 'TEAM') return (await tx.select({ m: teamMembers.membershipId }).from(teamMembers).where(eq(teamMembers.teamId, g.teamId!))).map((r) => r.m);
  if (g.subjectType === 'PROJECT') return 'project';
  return (await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.status, 'ACTIVE'))).map((r) => r.id);
}

/** A goal's current value, read from the source of truth (stored units). */
export async function measureGoal(tx: Tx, org: OrgInfo, g: Goal, now: Date): Promise<number> {
  const today = localDate(now, org.timezone);
  const until = g.endDate < today ? g.endDate : today;
  if (until < g.startDate) return 0;
  const who = await subjectMembers(tx, g);
  const inRange = (d: Date | null) => !!d && localDate(d, org.timezone) >= g.startDate && localDate(d, org.timezone) <= g.endDate;
  const since = new Date(`${addDaysToDate(g.startDate, -1)}T00:00:00Z`);
  switch (g.metric) {
    case 'TASKS_COMPLETED': {
      if (who === 'project') {
        const rows = await tx.select({ at: tasks.completedAt }).from(tasks).where(and(eq(tasks.projectId, g.projectId!), eq(tasks.status, 'DONE'), isNull(tasks.archivedAt), gte(tasks.completedAt, since)));
        return rows.filter((r) => inRange(r.at)).length;
      }
      if (!who.length) return 0;
      const rows = await tx
        .selectDistinct({ id: tasks.id, at: tasks.completedAt })
        .from(tasks)
        .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
        .where(and(inArray(taskAssignees.membershipId, who), eq(tasks.status, 'DONE'), isNull(tasks.archivedAt), gte(tasks.completedAt, since)));
      return rows.filter((r) => inRange(r.at)).length;
    }
    case 'MILESTONES_COMPLETED': {
      let projectIds: string[] | null = null;
      if (g.subjectType === 'PROJECT') projectIds = [g.projectId!];
      else if (g.subjectType === 'TEAM') projectIds = (await tx.select({ p: projectTeams.projectId }).from(projectTeams).where(eq(projectTeams.teamId, g.teamId!))).map((r) => r.p);
      if (projectIds && !projectIds.length) return 0;
      const rows = await tx
        .select({ at: projectMilestones.completedAt })
        .from(projectMilestones)
        .where(and(isNull(projectMilestones.archivedAt), isNotNull(projectMilestones.completedAt), projectIds ? inArray(projectMilestones.projectId, projectIds) : undefined));
      return rows.filter((r) => inRange(r.at)).length;
    }
    case 'APPROVED_HOURS': {
      const approved = and(eq(timesheets.membershipId, timeEntries.membershipId), eq(timesheets.status, 'APPROVED'), lte(timesheets.periodStart, timeEntries.localDate), gte(timesheets.periodEnd, timeEntries.localDate));
      const scope = who === 'project' ? eq(timeEntries.projectId, g.projectId!) : who.length ? inArray(timeEntries.membershipId, who) : sql`false`;
      const [r] = await tx
        .select({ s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
        .from(timeEntries)
        .innerJoin(timesheets, approved)
        .where(and(scope, isNull(timeEntries.deletedAt), gte(timeEntries.localDate, g.startDate), lte(timeEntries.localDate, until)));
      return Number(r?.s ?? 0);
    }
    case 'ON_TIME_PCT': {
      if (who === 'project' || !who.length) return 0;
      const rows = await computeAttendance(tx, org.id, org.settings.lateGraceMinutes, who, g.startDate, until, now);
      const due = rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'ABSENT');
      return due.length ? Math.round((due.filter((r) => r.status === 'PRESENT').length / due.length) * 100) : 0;
    }
  }
}

/** Who to tell about a goal (the member, or the team's members). */
async function goalAudience(tx: Tx, g: Goal): Promise<string[]> {
  if (g.subjectType === 'MEMBER') return [g.membershipId!];
  if (g.subjectType === 'TEAM') return (await tx.select({ m: teamMembers.membershipId }).from(teamMembers).where(eq(teamMembers.teamId, g.teamId!))).map((r) => r.m);
  return g.createdBy ? [g.createdBy] : [];
}

/**
 * Bring a goal up to date from its source data. Idempotent per `sourceKey`: a re-delivered event
 * records nothing twice. Completion is announced once.
 */
export async function recalcGoal(tx: Tx, deps: Deps, org: OrgInfo, g: Goal, now: Date, source: string, sourceKey: string): Promise<Goal> {
  if (g.status === 'ARCHIVED' || g.status === 'COMPLETED' || g.status === 'MISSED') return g;
  const value = await measureGoal(tx, org, g, now);
  const today = localDate(now, org.timezone);
  const ev = evaluateGoal({ metric: g.metric, target: g.targetValue, current: value, startDate: g.startDate, endDate: g.endDate }, today);
  if (value === g.currentValue && ev.status === g.status) return g;
  const [saved] = await tx
    .update(performanceGoals)
    .set({ currentValue: value, status: ev.status, completedAt: ev.status === 'COMPLETED' ? now : null, updatedAt: now })
    .where(eq(performanceGoals.id, g.id))
    .returning();
  await tx.insert(performanceGoalProgress).values({ id: newId(), organizationId: org.id, goalId: g.id, value, source, sourceKey }).onConflictDoNothing();
  await emit(tx, org.id, 'goal.progress.updated', { goal_id: g.id, value, status: ev.status });
  if (ev.status === 'COMPLETED') {
    await emit(tx, org.id, 'goal.completed', { goal_id: g.id, subject_type: g.subjectType, membership_id: g.membershipId, team_id: g.teamId, project_id: g.projectId });
    await notify(tx, deps, org.id, await goalAudience(tx, g), { type: 'goal.completed', title: `Goal reached: ${g.title}`, link: '/performance/goals', payload: { goal_id: g.id } });
  }
  return saved!;
}

/** Recalculate the active goals measured by `metrics` (all active goals when omitted). */
export async function recalcActiveGoals(tx: Tx, deps: Deps, org: OrgInfo, now: Date, source: string, sourceKey: string, metrics?: readonly GoalMetric[]): Promise<number> {
  const rows = await tx.select().from(performanceGoals).where(and(eq(performanceGoals.status, 'ACTIVE'), metrics ? inArray(performanceGoals.metric, [...metrics]) : undefined));
  let changed = 0;
  for (const g of rows) {
    const after = await recalcGoal(tx, deps, org, g, now, source, sourceKey);
    if (after !== g) changed++;
  }
  return changed;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

async function goalDtos(x: Ctx, rows: Goal[]): Promise<GoalDto[]> {
  const names = await memberNames(x, [...new Set(rows.map((g) => g.membershipId).filter((v): v is string => !!v))]);
  const teams = await teamRoster(x.tx, [...new Set(rows.map((g) => g.teamId).filter((v): v is string => !!v))]);
  const pids = [...new Set(rows.map((g) => g.projectId).filter((v): v is string => !!v))];
  const pnames = new Map(pids.length ? (await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pids))).map((p) => [p.id, p.name]) : []);
  const today = orgToday(x);
  return rows.map((g) => {
    const ev = g.status === 'ARCHIVED' ? null : evaluateGoal({ metric: g.metric, target: g.targetValue, current: g.currentValue, startDate: g.startDate, endDate: g.endDate }, today);
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      category: g.category,
      subject_type: g.subjectType,
      subject_id: g.membershipId ?? g.teamId ?? g.projectId ?? null,
      subject_name: g.subjectType === 'MEMBER' ? (names.get(g.membershipId!) ?? '') : g.subjectType === 'TEAM' ? (teams.get(g.teamId!)?.name ?? '') : g.subjectType === 'PROJECT' ? (pnames.get(g.projectId!) ?? '') : x.org.name,
      metric: g.metric,
      target: fromStored(g.metric, g.targetValue),
      current: fromStored(g.metric, g.currentValue),
      progress_pct: g.status === 'COMPLETED' ? 100 : (ev?.progress_pct ?? 0),
      status: g.status,
      pace: g.status === 'ACTIVE' ? (ev?.pace ?? null) : null,
      start_date: g.startDate,
      end_date: g.endDate,
      completed_at: iso(g.completedAt),
      created_by: g.createdBy,
    };
  });
}

export async function listGoals(x: Ctx, q: { status?: Goal['status']; subjectType?: Goal['subjectType']; membershipId?: string; teamId?: string; projectId?: string }): Promise<GoalDto[]> {
  if (!x.actor.grants['goals:read']) throw forbidden();
  const conds = [];
  if (q.status) conds.push(eq(performanceGoals.status, q.status));
  else conds.push(sql`${performanceGoals.status} <> 'ARCHIVED'`);
  if (q.subjectType) conds.push(eq(performanceGoals.subjectType, q.subjectType));
  if (q.membershipId) conds.push(eq(performanceGoals.membershipId, q.membershipId));
  if (q.teamId) conds.push(eq(performanceGoals.teamId, q.teamId));
  if (q.projectId) conds.push(eq(performanceGoals.projectId, q.projectId));
  const rows = await x.tx.select().from(performanceGoals).where(and(...conds)).orderBy(asc(performanceGoals.endDate), desc(performanceGoals.createdAt));
  const visible: Goal[] = [];
  for (const g of rows) if (await canReadGoal(x, g)) visible.push(g);
  return goalDtos(x, visible);
}

export async function getGoal(x: Ctx, id: string) {
  const [g] = await x.tx.select().from(performanceGoals).where(eq(performanceGoals.id, id));
  if (!g || !(await canReadGoal(x, g))) throw notFound('goal');
  const history = await x.tx.select().from(performanceGoalProgress).where(eq(performanceGoalProgress.goalId, id)).orderBy(desc(performanceGoalProgress.createdAt), desc(performanceGoalProgress.id));
  const names = await memberNames(x, [...new Set(history.map((h) => h.actorMembershipId).concat(g.createdBy).filter((v): v is string => !!v))]);
  return {
    ...(await goalDtos(x, [g]))[0]!,
    created_by_name: g.createdBy ? (names.get(g.createdBy) ?? null) : null,
    created_at: iso(g.createdAt),
    can_manage: await canManageGoal(x, g),
    history: history.map((h) => ({ value: fromStored(g.metric, h.value), source: h.source, by: h.actorMembershipId ? (names.get(h.actorMembershipId) ?? null) : null, at: iso(h.createdAt) })),
  };
}

// ─── Changing ────────────────────────────────────────────────────────────────

export async function createGoal(x: Ctx, input: z.infer<typeof goalInput>) {
  const subject = {
    subjectType: input.subject_type,
    membershipId: input.subject_type === 'MEMBER' ? input.subject_id! : null,
    teamId: input.subject_type === 'TEAM' ? input.subject_id! : null,
    projectId: input.subject_type === 'PROJECT' ? input.subject_id! : null,
  };
  // The subject must exist in this organization (one answer for missing and out of reach).
  if (subject.membershipId) {
    const [m] = await x.tx.select({ status: memberships.status }).from(memberships).where(eq(memberships.id, subject.membershipId));
    if (!m || m.status !== 'ACTIVE') throw notFound('member');
  }
  if (subject.teamId && !(await teamRoster(x.tx, [subject.teamId])).has(subject.teamId)) throw notFound('team');
  if (subject.projectId) {
    const [p] = await x.tx.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, subject.projectId));
    if (!p) throw notFound('project');
    if (p.archivedAt) throw businessRule('project_archived', 'This project is archived.');
  }
  if (!(await canManageGoal(x, subject))) throw subject.subjectType === 'ORG' || !x.actor.grants['goals:manage'] ? forbidden() : notFound(subject.subjectType.toLowerCase());
  const id = newId();
  const [g] = await x.tx
    .insert(performanceGoals)
    .values({ id, organizationId: x.org.id, title: input.title, description: input.description ?? null, category: input.category ?? null, ...subject, metric: input.metric, targetValue: toStored(input.metric, input.target), startDate: input.start_date, endDate: input.end_date, createdBy: x.actor.membershipId })
    .returning();
  await x.tx.insert(performanceGoalProgress).values({ id: newId(), organizationId: x.org.id, goalId: id, value: 0, source: 'created', sourceKey: 'created', actorMembershipId: x.actor.membershipId });
  const after = await recalcGoal(x.tx, x.deps, x.org, g!, x.deps.now(), 'recalculation', `created:${id}`);
  await audit(x, { action: 'goal.created', targetType: 'goal', targetId: id, after: input });
  await emitFrom(x, 'goal.created', { goal_id: id, subject_type: g!.subjectType, membership_id: g!.membershipId, team_id: g!.teamId, project_id: g!.projectId });
  const audience = (await goalAudience(x.tx, after)).filter((m) => m !== x.actor.membershipId);
  if (g!.subjectType !== 'PROJECT' && g!.subjectType !== 'ORG') await notify(x.tx, x.deps, x.org.id, audience, { type: 'goal.created', title: `New goal: ${input.title}`, body: `Until ${input.end_date}`, link: '/performance/goals', payload: { goal_id: id } });
  return getGoal(x, id);
}

export async function updateGoal(x: Ctx, id: string, input: z.infer<typeof goalPatchInput>) {
  const [g] = await x.tx.select().from(performanceGoals).where(eq(performanceGoals.id, id));
  if (!g || !(await canReadGoal(x, g))) throw notFound('goal');
  if (!(await canManageGoal(x, g))) throw forbidden();
  if (g.status === 'ARCHIVED' && input.archived !== false) throw businessRule('goal_archived', 'This goal is archived.');
  const patch: Partial<typeof performanceGoals.$inferInsert> = { updatedAt: x.deps.now() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.target !== undefined) {
    if (g.metric === 'ON_TIME_PCT' && input.target > 100) throw businessRule('target_too_high', 'A percentage target is at most 100.');
    patch.targetValue = toStored(g.metric, input.target);
  }
  if (input.end_date !== undefined) {
    if (input.end_date < g.startDate) throw businessRule('end_before_start', 'The end date must be on or after the start date.');
    patch.endDate = input.end_date;
  }
  // A changed target or end date re-opens the question of where the goal stands.
  if ((input.target !== undefined || input.end_date !== undefined) && g.status !== 'ARCHIVED') {
    patch.status = 'ACTIVE';
    patch.completedAt = null;
  }
  if (input.archived === true) patch.status = 'ARCHIVED';
  if (input.archived === false && g.status === 'ARCHIVED') patch.status = 'ACTIVE';
  const [saved] = await x.tx.update(performanceGoals).set(patch).where(eq(performanceGoals.id, id)).returning();
  const stamp = `edited:${x.deps.now().toISOString()}:${newId()}`;
  await x.tx.insert(performanceGoalProgress).values({ id: newId(), organizationId: x.org.id, goalId: id, value: saved!.currentValue, source: input.archived ? 'archived' : 'edited', sourceKey: stamp, actorMembershipId: x.actor.membershipId });
  if (saved!.status === 'ACTIVE') await recalcGoal(x.tx, x.deps, x.org, saved!, x.deps.now(), 'recalculation', `${stamp}:recalc`);
  await audit(x, { action: input.archived ? 'goal.archived' : 'goal.updated', targetType: 'goal', targetId: id, before: { title: g.title, target: g.targetValue, end_date: g.endDate, status: g.status }, after: input });
  return getGoal(x, id);
}

/** Goals of the member's own (desktop), with their progress. */
export async function memberGoals(x: Ctx, membershipId: string): Promise<GoalDto[]> {
  const teamIds = (await x.tx.select({ t: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.membershipId, membershipId))).map((r) => r.t);
  const rows = await x.tx
    .select()
    .from(performanceGoals)
    .where(and(sql`${performanceGoals.status} <> 'ARCHIVED'`, teamIds.length ? sql`(${performanceGoals.membershipId} = ${membershipId} or ${inArray(performanceGoals.teamId, teamIds)})` : eq(performanceGoals.membershipId, membershipId)))
    .orderBy(asc(performanceGoals.endDate));
  return goalDtos(x, rows);
}

