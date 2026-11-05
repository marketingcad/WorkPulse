import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  achievementAwards,
  achievementDefinitions,
  memberships,
  performanceScoreSnapshots,
  projectMembers,
  projectMilestones,
  taskAssignees,
  tasks,
  teamMembers,
  timeEntries,
  timesheets,
  type Tx,
} from '@tallywork/db';
import {
  BUILTIN_ACHIEVEMENTS,
  SYSTEM_ONLY_ACHIEVEMENTS,
  addDaysToDate,
  awardPeriodKey,
  businessRule,
  can,
  conflict,
  forbidden,
  localDate,
  newId,
  notFound,
  periodBounds,
  rankEntries,
  tiersReached,
  type AchievementMetric,
  type AchievementTier,
} from '@tallywork/domain';
import type { AchievementAwardDto, achievementDefinitionInput, awardInput } from '@tallywork/contracts';
import type { Deps, OrgInfo } from '../context';
import type { Ctx } from './ctx';
import { audit, auditSystem, emit, emitFrom } from './events';
import { notify } from './notify';
import { computeAttendance } from './operations';
import { canActOnTeam, canSeeTeam, ownTeamIds, managedTeamIds, orgToday, teamRoster } from './performance-access';
import { memberNames } from './timer';
import { iso } from '../lib/http';

type Definition = typeof achievementDefinitions.$inferSelect;
type Award = typeof achievementAwards.$inferSelect;

// ─── Catalogue ───────────────────────────────────────────────────────────────

/** Make sure the organization has every built-in achievement (idempotent). */
export async function ensureBuiltinAchievements(tx: Tx, orgId: string): Promise<void> {
  const have = new Set((await tx.select({ key: achievementDefinitions.key }).from(achievementDefinitions).where(isNotNull(achievementDefinitions.key))).map((r) => r.key));
  const missing = BUILTIN_ACHIEVEMENTS.filter((a) => !have.has(a.key));
  if (!missing.length) return;
  await tx
    .insert(achievementDefinitions)
    .values(
      missing.map((a) => ({
        id: newId(),
        organizationId: orgId,
        key: a.key,
        name: a.name,
        description: a.description,
        category: a.category,
        icon: a.icon,
        mode: a.mode,
        metric: a.metric ?? null,
        thresholds: a.thresholds ? [...a.thresholds] : null,
        recurrence: a.recurrence,
      })),
    )
    .onConflictDoNothing();
}

export interface AchievementDefinitionDto {
  id: string;
  key: string | null;
  name: string;
  description: string;
  category: Definition['category'];
  icon: string;
  mode: Definition['mode'];
  metric: Definition['metric'];
  thresholds: number[] | null;
  recurrence: Definition['recurrence'];
  default_visibility: Definition['defaultVisibility'];
  custom: boolean;
  /** a manager can give it by hand */
  awardable: boolean;
  archived: boolean;
  /** awards the actor can see */
  earned_count: number;
  people_count: number;
  last_awarded_at: string | null;
}

export async function listAchievementDefinitions(x: Ctx, opts: { includeArchived?: boolean } = {}): Promise<AchievementDefinitionDto[]> {
  if (!x.actor.grants['achievements:read']) throw forbidden();
  await ensureBuiltinAchievements(x.tx, x.org.id);
  const defs = await x.tx.select().from(achievementDefinitions).orderBy(achievementDefinitions.createdAt);
  const awards = await visibleAwards(x, {});
  return defs
    .filter((d) => opts.includeArchived || !d.archivedAt)
    .map((d) => {
      const mine = awards.filter((a) => a.definitionId === d.id);
      return {
        id: d.id,
        key: d.key,
        name: d.name,
        description: d.description,
        category: d.category,
        icon: d.icon,
        mode: d.mode,
        metric: d.metric,
        thresholds: d.thresholds,
        recurrence: d.recurrence,
        default_visibility: d.defaultVisibility,
        custom: d.key === null,
        awardable: d.mode === 'MANUAL' && !SYSTEM_ONLY_ACHIEVEMENTS.includes(d.key ?? ''),
        archived: !!d.archivedAt,
        earned_count: mine.length,
        people_count: new Set(mine.map((a) => a.recipientKey)).size,
        last_awarded_at: iso(mine[0]?.createdAt ?? null),
      };
    });
}

export async function createAchievementDefinition(x: Ctx, input: z.infer<typeof achievementDefinitionInput>) {
  if (!can(x.actor, 'achievements:manage')) throw forbidden();
  const id = newId();
  await x.tx.insert(achievementDefinitions).values({
    id,
    organizationId: x.org.id,
    key: null,
    name: input.name,
    description: input.description,
    category: input.category,
    icon: input.icon,
    mode: input.mode,
    metric: input.mode === 'AUTOMATIC' ? input.metric! : null,
    thresholds: input.mode === 'AUTOMATIC' ? input.thresholds! : null,
    recurrence: input.recurrence,
    defaultVisibility: input.default_visibility ?? 'PUBLIC',
    createdBy: x.actor.membershipId,
  });
  await audit(x, { action: 'achievement.definition_created', targetType: 'achievement_definition', targetId: id, after: input });
  return (await listAchievementDefinitions(x, { includeArchived: true })).find((d) => d.id === id)!;
}

/** Archive (or bring back) a custom achievement. Built-ins stay; past awards always stay. */
export async function setAchievementArchived(x: Ctx, id: string, archived: boolean) {
  if (!can(x.actor, 'achievements:manage')) throw forbidden();
  const [d] = await x.tx.select().from(achievementDefinitions).where(eq(achievementDefinitions.id, id));
  if (!d) throw notFound('achievement');
  if (d.key) throw businessRule('builtin_achievement', 'Built-in achievements cannot be archived.');
  await x.tx.update(achievementDefinitions).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(achievementDefinitions.id, id));
  await audit(x, { action: archived ? 'achievement.definition_archived' : 'achievement.definition_restored', targetType: 'achievement_definition', targetId: id });
}

// ─── Awards: visibility ──────────────────────────────────────────────────────

/**
 * Awards the actor may see, newest first. Member awards follow achievements:read on the member; a
 * private one is seen only by the member and by whoever may award them. Team awards: the team's
 * members and managers, and org scope.
 */
async function visibleAwards(x: Ctx, q: { membershipId?: string; teamId?: string; from?: Date; to?: Date; includeRevoked?: boolean; limit?: number }): Promise<Award[]> {
  const conds = [];
  if (!q.includeRevoked) conds.push(isNull(achievementAwards.revokedAt));
  if (q.membershipId) conds.push(eq(achievementAwards.membershipId, q.membershipId));
  if (q.teamId) conds.push(eq(achievementAwards.teamId, q.teamId));
  if (q.from) conds.push(gte(achievementAwards.createdAt, q.from));
  if (q.to) conds.push(lte(achievementAwards.createdAt, q.to));
  const rows = await x.tx
    .select()
    .from(achievementAwards)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(achievementAwards.createdAt));
  const myTeams = await ownTeamIds(x);
  const managed = await managedTeamIds(x);
  const orgScope = x.actor.grants['achievements:read'] === 'org';
  const out: Award[] = [];
  for (const a of rows) {
    let ok: boolean;
    if (a.membershipId) {
      ok = can(x.actor, 'achievements:read', { ownerMembershipId: a.membershipId });
      if (ok && a.visibility === 'PRIVATE' && a.membershipId !== x.actor.membershipId) ok = can(x.actor, 'achievements:award', { ownerMembershipId: a.membershipId });
    } else ok = !!x.actor.grants['achievements:read'] && (orgScope || myTeams.has(a.teamId!) || managed.has(a.teamId!));
    if (ok) out.push(a);
    if (q.limit && out.length >= q.limit) break;
  }
  return out;
}

export async function awardDtos(x: Pick<Ctx, 'tx'>, rows: Award[]): Promise<AchievementAwardDto[]> {
  if (!rows.length) return [];
  const defs = new Map((await x.tx.select().from(achievementDefinitions).where(inArray(achievementDefinitions.id, [...new Set(rows.map((r) => r.definitionId))]))).map((d) => [d.id, d]));
  const names = await memberNames(x, [...new Set(rows.flatMap((r) => [r.membershipId, r.awardedBy]).filter((v): v is string => !!v))]);
  const teams = await teamRoster(x.tx, [...new Set(rows.map((r) => r.teamId).filter((v): v is string => !!v))]);
  return rows.map((r) => {
    const d = defs.get(r.definitionId)!;
    return {
      id: r.id,
      definition_id: r.definitionId,
      name: d.name,
      icon: d.icon,
      category: d.category,
      tier: r.tier === 'NONE' ? null : r.tier,
      recipient: r.membershipId ? { type: 'MEMBER', id: r.membershipId, name: names.get(r.membershipId) ?? '' } : { type: 'TEAM', id: r.teamId!, name: teams.get(r.teamId!)?.name ?? '' },
      source: r.source,
      awarded_by: r.awardedBy ? (names.get(r.awardedBy) ?? null) : null,
      reason: r.reason,
      visibility: r.visibility,
      period_key: r.periodKey,
      created_at: iso(r.createdAt)!,
    };
  });
}

export async function listAwards(x: Ctx, q: { membershipId?: string; teamId?: string; from?: string; to?: string; limit?: number }): Promise<AchievementAwardDto[]> {
  if (!x.actor.grants['achievements:read']) throw forbidden();
  if (q.membershipId) {
    const [m] = await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, q.membershipId));
    if (!m || !can(x.actor, 'achievements:read', { ownerMembershipId: q.membershipId })) throw notFound('member');
  }
  if (q.teamId && !(await canSeeTeam(x, 'achievements:read', q.teamId))) throw notFound('team');
  const rows = await visibleAwards(x, {
    membershipId: q.membershipId,
    teamId: q.teamId,
    from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
    to: q.to ? new Date(`${addDaysToDate(q.to, 1)}T00:00:00Z`) : undefined,
    limit: q.limit ?? 200,
  });
  return awardDtos(x, rows);
}

// ─── Awards: by a manager ────────────────────────────────────────────────────

/**
 * A manager recognizes someone (or a team) with a manager-awarded achievement and a reason. Once per
 * recipient and eligibility period; audited, announced in the app, and never self-given.
 */
export async function awardAchievement(x: Ctx, input: z.infer<typeof awardInput>): Promise<AchievementAwardDto> {
  if (!x.actor.grants['achievements:award']) throw forbidden();
  await ensureBuiltinAchievements(x.tx, x.org.id);
  const [d] = await x.tx.select().from(achievementDefinitions).where(eq(achievementDefinitions.id, input.definition_id));
  if (!d || d.archivedAt) throw notFound('achievement');
  if (d.mode !== 'MANUAL' || SYSTEM_ONLY_ACHIEVEMENTS.includes(d.key ?? '')) throw businessRule('not_awardable', 'This achievement is earned automatically and cannot be given by hand.');
  let recipients: string[];
  if (input.membership_id) {
    const [m] = await x.tx.select({ id: memberships.id, status: memberships.status }).from(memberships).where(eq(memberships.id, input.membership_id));
    if (!m || !can(x.actor, 'achievements:award', { ownerMembershipId: m.id })) throw notFound('member');
    if (m.id === x.actor.membershipId) throw forbidden('You cannot recognize yourself.');
    if (m.status !== 'ACTIVE') throw businessRule('member_inactive', 'Only active members can be recognized.');
    recipients = [m.id];
  } else {
    const roster = await teamRoster(x.tx, [input.team_id!]);
    if (!roster.has(input.team_id!) || !(await canActOnTeam(x, 'achievements:award', input.team_id!))) throw notFound('team');
    recipients = roster.get(input.team_id!)!.members;
  }
  const periodKey = awardPeriodKey(d.recurrence, orgToday(x), x.org.weekStart);
  const recipientKey = input.membership_id ? `m:${input.membership_id}` : `t:${input.team_id}`;
  const [row] = await x.tx
    .insert(achievementAwards)
    .values({
      id: newId(),
      organizationId: x.org.id,
      definitionId: d.id,
      membershipId: input.membership_id ?? null,
      teamId: input.team_id ?? null,
      recipientKey,
      tier: 'NONE',
      periodKey,
      source: 'MANAGER',
      awardedBy: x.actor.membershipId,
      reason: input.reason,
      visibility: input.visibility ?? d.defaultVisibility,
      evidence: { period: periodKey },
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict('already_awarded', `${d.name} was already given for this period.`, { period: periodKey });
  await audit(x, { action: 'achievement.awarded', targetType: 'achievement_award', targetId: row.id, after: { definition: d.name, recipient: recipientKey, reason: input.reason, visibility: row.visibility, period: periodKey } });
  await emitFrom(x, 'recognition.awarded', { award_id: row.id, definition_id: d.id, membership_id: row.membershipId, team_id: row.teamId, period_key: periodKey });
  if (input.notify !== false) {
    await notify(x.tx, x.deps, x.org.id, recipients.filter((r) => r !== x.actor.membershipId), { type: 'recognition.awarded', title: `You were recognized: ${d.name}`, body: input.reason, link: '/performance', payload: { award_id: row.id } });
  }
  return (await awardDtos(x, [row]))[0]!;
}

/** Take back an award given by mistake. The row stays (who, when and why it was revoked). */
export async function revokeAward(x: Ctx, id: string, reason: string): Promise<void> {
  const [a] = await x.tx.select().from(achievementAwards).where(eq(achievementAwards.id, id));
  if (!a) throw notFound('award');
  const allowed = a.membershipId ? can(x.actor, 'achievements:award', { ownerMembershipId: a.membershipId }) : await canActOnTeam(x, 'achievements:award', a.teamId!);
  if (!allowed) throw notFound('award');
  if (a.revokedAt) return;
  await x.tx.update(achievementAwards).set({ revokedAt: x.deps.now(), revokedBy: x.actor.membershipId, revokeReason: reason }).where(eq(achievementAwards.id, id));
  await audit(x, { action: 'achievement.revoked', targetType: 'achievement_award', targetId: id, metadata: { reason } });
}

// ─── Awards: automatic ───────────────────────────────────────────────────────

/**
 * Give an earned achievement level once. Returns false when it was already given (a re-delivered event
 * or a repeated daily run changes nothing).
 */
export async function grantAutomatic(
  tx: Tx,
  deps: Deps,
  orgId: string,
  g: { definition: Definition; membershipId: string; tier: AchievementTier | 'NONE'; periodKey: string; evidence: Record<string, unknown>; source?: 'AUTOMATIC' | 'CLIENT'; reason?: string | null; awardedBy?: string | null },
): Promise<boolean> {
  const [row] = await tx
    .insert(achievementAwards)
    .values({
      id: newId(),
      organizationId: orgId,
      definitionId: g.definition.id,
      membershipId: g.membershipId,
      recipientKey: `m:${g.membershipId}`,
      tier: g.tier,
      periodKey: g.periodKey,
      source: g.source ?? 'AUTOMATIC',
      awardedBy: g.awardedBy ?? null,
      reason: g.reason ?? null,
      visibility: g.definition.defaultVisibility,
      evidence: g.evidence,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return false;
  const level = g.tier === 'NONE' ? '' : ` · ${g.tier[0]}${g.tier.slice(1).toLowerCase()}`;
  await auditSystem(tx, orgId, { action: 'achievement.unlocked', targetType: 'achievement_award', targetId: row.id, metadata: { definition: g.definition.name, membership_id: g.membershipId, tier: g.tier, period: g.periodKey, ...g.evidence } });
  await emit(tx, orgId, 'achievement.unlocked', { award_id: row.id, definition_id: g.definition.id, membership_id: g.membershipId, tier: g.tier, period_key: g.periodKey }, { workerId: g.membershipId });
  await notify(tx, deps, orgId, [g.membershipId], { type: 'achievement.unlocked', title: `You earned ${g.definition.name}${level}`, body: g.definition.description, link: '/performance', payload: { award_id: row.id } });
  return true;
}

/** Approved days and approved seconds for a member in [from, to] (time inside approved timesheets). */
async function approvedTime(tx: Tx, membershipId: string, from: string | null, to: string) {
  const rows = await tx
    .select({ d: timeEntries.localDate, s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
    .from(timeEntries)
    .innerJoin(timesheets, and(eq(timesheets.membershipId, timeEntries.membershipId), eq(timesheets.status, 'APPROVED'), lte(timesheets.periodStart, timeEntries.localDate), gte(timesheets.periodEnd, timeEntries.localDate)))
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), from ? gte(timeEntries.localDate, from) : undefined, lte(timeEntries.localDate, to)))
    .groupBy(timeEntries.localDate);
  return { days: new Set(rows.map((r) => r.d)), seconds: rows.reduce((s, r) => s + Number(r.s), 0) };
}

/** The value of an automatic achievement's measure for a member today. */
export async function memberMeasure(tx: Tx, org: OrgInfo, membershipId: string, metric: AchievementMetric, now: Date): Promise<number> {
  const today = localDate(now, org.timezone);
  switch (metric) {
    case 'TASKS_COMPLETED': {
      const q = periodBounds('QUARTER', today);
      const rows = await tx
        .select({ at: tasks.completedAt })
        .from(tasks)
        .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
        .where(and(eq(taskAssignees.membershipId, membershipId), eq(tasks.status, 'DONE'), isNull(tasks.archivedAt), gte(tasks.completedAt, new Date(`${addDaysToDate(q.start, -1)}T00:00:00Z`))));
      return rows.filter((r) => r.at && localDate(r.at, org.timezone) >= q.start && localDate(r.at, org.timezone) <= q.end).length;
    }
    case 'MILESTONES_ON_TIME': {
      const rows = await tx
        .select({ due: projectMilestones.dueDate, at: projectMilestones.completedAt })
        .from(projectMilestones)
        .innerJoin(projectMembers, and(eq(projectMembers.projectId, projectMilestones.projectId), eq(projectMembers.membershipId, membershipId)))
        .where(and(isNull(projectMilestones.archivedAt), isNotNull(projectMilestones.completedAt)));
      return rows.filter((r) => localDate(r.at!, org.timezone) <= r.due).length;
    }
    case 'APPROVED_HOURS':
      return Math.floor((await approvedTime(tx, membershipId, null, today)).seconds / 3600);
    case 'CONSISTENT_WEEKS':
      return streak(tx, org, membershipId, now, 'WEEK', 26, (row) => row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'ABSENT', true);
    case 'ON_TIME_MONTHS':
      return streak(tx, org, membershipId, now, 'MONTH', 12, (row) => row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'ABSENT', false);
    case 'TOP_SCORE':
      return 0; // given when a month closes (monthlyTopPerformers)
  }
}

/**
 * Completed periods in a row, counting back from the last finished one. A period with no scheduled
 * days (leave, holidays) is skipped: it neither counts nor breaks the run. Weeks need approved time on
 * every scheduled day; months need every scheduled shift started on time.
 */
async function streak(tx: Tx, org: OrgInfo, membershipId: string, now: Date, type: 'WEEK' | 'MONTH', max: number, due: (r: { status: string }) => boolean, approvedRule: boolean): Promise<number> {
  const today = localDate(now, org.timezone);
  const current = periodBounds(type, today, org.weekStart);
  const lastEnd = addDaysToDate(current.start, -1);
  // Earliest day considered: `max` periods back.
  let start = periodBounds(type, lastEnd, org.weekStart).start;
  for (let i = 1; i < max; i++) start = periodBounds(type, addDaysToDate(start, -1), org.weekStart).start;
  const rows = await computeAttendance(tx, org.id, org.settings.lateGraceMinutes, [membershipId], start, lastEnd, now);
  const approved = approvedRule ? (await approvedTime(tx, membershipId, start, lastEnd)).days : new Set<string>();
  let count = 0;
  let end = lastEnd;
  for (let i = 0; i < max; i++) {
    const p = periodBounds(type, end, org.weekStart);
    const dueRows = rows.filter((r) => r.date >= p.start && r.date <= p.end && due(r));
    if (dueRows.length) {
      const ok = approvedRule ? dueRows.every((r) => approved.has(r.date)) : dueRows.every((r) => r.status === 'PRESENT');
      if (!ok) break;
      count++;
    }
    end = addDaysToDate(p.start, -1);
  }
  return count;
}

/** Check a member's automatic achievements for the given measures, and give every new level reached. */
export async function evaluateMemberAchievements(tx: Tx, deps: Deps, org: OrgInfo, membershipId: string, metrics: readonly AchievementMetric[], now: Date): Promise<number> {
  await ensureBuiltinAchievements(tx, org.id);
  const defs = (await tx.select().from(achievementDefinitions).where(and(eq(achievementDefinitions.mode, 'AUTOMATIC'), isNull(achievementDefinitions.archivedAt)))).filter((d) => d.metric && metrics.includes(d.metric) && d.metric !== 'TOP_SCORE');
  if (!defs.length) return 0;
  const [m] = await tx.select({ status: memberships.status }).from(memberships).where(eq(memberships.id, membershipId));
  if (m?.status !== 'ACTIVE') return 0;
  const today = localDate(now, org.timezone);
  const values = new Map<AchievementMetric, number>();
  let given = 0;
  for (const d of defs) {
    if (!values.has(d.metric!)) values.set(d.metric!, await memberMeasure(tx, org, membershipId, d.metric!, now));
    const value = values.get(d.metric!)!;
    const levels = tiersReached(d.thresholds ?? [], value);
    const single = (d.thresholds ?? []).length === 1;
    for (const tier of levels) {
      const ok = await grantAutomatic(tx, deps, org.id, { definition: d, membershipId, tier: single ? 'NONE' : tier, periodKey: awardPeriodKey(d.recurrence, today, org.weekStart), evidence: { metric: d.metric, value, on: today } });
      if (ok) given++;
    }
  }
  return given;
}

/**
 * When a month closes: the highest eligible score in each role is Monthly Top Performer. Ties share it.
 * Reads the month's final snapshots, so it gives the same answer however often it runs.
 */
export async function monthlyTopPerformers(tx: Tx, deps: Deps, org: OrgInfo, monthStart: string): Promise<number> {
  await ensureBuiltinAchievements(tx, org.id);
  const defs = (await tx.select().from(achievementDefinitions).where(and(eq(achievementDefinitions.metric, 'TOP_SCORE'), isNull(achievementDefinitions.archivedAt))));
  if (!defs.length) return 0;
  const snaps = await tx
    .select()
    .from(performanceScoreSnapshots)
    .where(and(eq(performanceScoreSnapshots.subjectType, 'MEMBER'), eq(performanceScoreSnapshots.periodType, 'MONTH'), eq(performanceScoreSnapshots.periodStart, monthStart), eq(performanceScoreSnapshots.final, true)));
  const ranked = rankEntries(snaps.map((s) => ({ id: s.subjectId, score: s.score, eligible: s.eligible, group: s.rankGroup ?? '' })));
  let given = 0;
  for (const d of defs) {
    for (const r of ranked.filter((e) => e.rank === 1)) {
      if (await grantAutomatic(tx, deps, org.id, { definition: d, membershipId: r.id, tier: 'NONE', periodKey: awardPeriodKey('MONTH', monthStart), evidence: { metric: 'TOP_SCORE', score: r.score, group: r.group, month: monthStart } })) given++;
    }
  }
  return given;
}

/** Members who worked on a project (direct members), for milestone achievements. */
export async function projectMemberIds(tx: Tx, projectId: string): Promise<string[]> {
  return (await tx.select({ m: projectMembers.membershipId }).from(projectMembers).where(eq(projectMembers.projectId, projectId))).map((r) => r.m);
}

/** Team member ids (for notifications to a whole team). */
export async function teamMemberIds(tx: Tx, teamId: string): Promise<string[]> {
  return (await tx.select({ m: teamMembers.membershipId }).from(teamMembers).where(eq(teamMembers.teamId, teamId))).map((r) => r.m);
}
