import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  achievementAwards,
  performanceGoals,
  performanceScoreSnapshots,
  projectMembers,
  projectMilestones,
  projectTeams,
  projects,
  taskAssignees,
  tasks,
  timeEntries,
  timesheets,
  type Tx,
} from '@tallywork/db';
import {
  addDaysToDate,
  can,
  forbidden,
  localDate,
  newId,
  notFound,
  periodBounds,
  rankEntries,
  ratioScore,
  type PerformancePeriod,
} from '@tallywork/domain';
import type { OrgInfo } from '../context';
import type { Ctx } from './ctx';
import { listAwards } from './achievements';
import { memberGoals } from './goals';
import { currentRules, currentSettings, listMemberSnapshots, memberScore, snapshotMemberScore } from './performance';
import { activeMembers, canSeeTeam, orgToday, teamRoster, visibleActiveMembers, visibleTeamIds } from './performance-access';

type Snapshot = typeof performanceScoreSnapshots.$inferSelect;
type Inputs = { goals: { completed: number; due: number }; delivery: { on_time: number; due: number }; consistency: { approved_days: number; scheduled_days: number }; quality: { reviews: number; average_rating: number | null }; attendance: { on_time: number; scheduled: number } };
const inputsOf = (s: Snapshot | undefined) => (s?.metrics as { inputs?: Inputs } | undefined)?.inputs;
const approvedSecondsOf = (s: Snapshot | undefined) => Number((s?.metrics as { approved_seconds?: number } | undefined)?.approved_seconds ?? 0);
const approvedDaysOf = (s: Snapshot | undefined) => Number((s?.metrics as { approved_days?: number } | undefined)?.approved_days ?? 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The `n` periods of `type` ending with the one that contains `date`, oldest first. */
export function recentPeriods(type: PerformancePeriod, date: string, n: number, weekStart: number) {
  const out: Array<{ start: string; end: string }> = [];
  let d = date;
  for (let i = 0; i < n; i++) {
    const p = periodBounds(type, d, weekStart);
    out.unshift(p);
    d = addDaysToDate(p.start, -1);
  }
  return out;
}

/** Weighted average of member scores (by approved days, at least 1 each), or null with none scored. */
function averageScore(snaps: Snapshot[]): number | null {
  const scored = snaps.filter((s) => s.score !== null);
  if (!scored.length) return null;
  const w = scored.map((s) => Math.max(1, approvedDaysOf(s)));
  return round1(scored.reduce((sum, s, i) => sum + s.score! * w[i]!, 0) / w.reduce((a, b) => a + b, 0));
}

async function upsertSnapshot(tx: Tx, orgId: string, s: Omit<typeof performanceScoreSnapshots.$inferInsert, 'id' | 'organizationId'>) {
  const key = and(eq(performanceScoreSnapshots.subjectType, s.subjectType), eq(performanceScoreSnapshots.subjectId, s.subjectId), eq(performanceScoreSnapshots.periodType, s.periodType), eq(performanceScoreSnapshots.periodStart, s.periodStart));
  const [existing] = await tx.select().from(performanceScoreSnapshots).where(key);
  if (existing?.final) return existing;
  if (existing) return (await tx.update(performanceScoreSnapshots).set(s).where(eq(performanceScoreSnapshots.id, existing.id)).returning())[0]!;
  return (await tx.insert(performanceScoreSnapshots).values({ id: newId(), organizationId: orgId, ...s }).returning())[0]!;
}

/**
 * Save the period's scores for every active member, then each team, project and the organization.
 * The daily job runs this; a closed period's snapshots are never changed again.
 */
export async function refreshPerformance(tx: Tx, org: OrgInfo, periodType: PerformancePeriod, date: string, now: Date): Promise<{ members: number }> {
  const p = periodBounds(periodType, date, org.weekStart);
  const today = localDate(now, org.timezone);
  if (p.start > today) return { members: 0 };
  const final = today > p.end;
  const rule = await currentRules(tx, org.id);
  const people = await activeMembers(tx);
  const memberSnaps = new Map<string, Snapshot>();
  for (const m of people) memberSnaps.set(m.id, await snapshotMemberScore(tx, org, now, { membershipId: m.id, periodType, periodStart: p.start, periodEnd: p.end, rankGroup: m.rankGroup }));
  const base = { periodType, periodStart: p.start, periodEnd: p.end, ruleId: rule.id, ruleVersion: rule.version, final, calculatedAt: now };

  // Teams: their members' scores, plus team goals and the milestones of the team's projects.
  const roster = await teamRoster(tx);
  for (const [teamId, t] of roster) {
    const snaps = t.members.map((m) => memberSnaps.get(m)).filter((s): s is Snapshot => !!s);
    const goals = await tx.select({ status: performanceGoals.status, end: performanceGoals.endDate }).from(performanceGoals).where(and(eq(performanceGoals.teamId, teamId), gte(performanceGoals.endDate, p.start), lte(performanceGoals.endDate, p.end), sql`${performanceGoals.status} <> 'ARCHIVED'`));
    const due = goals.filter((g) => g.status === 'COMPLETED' || g.end <= today);
    const projectIds = (await tx.select({ p: projectTeams.projectId }).from(projectTeams).where(eq(projectTeams.teamId, teamId))).map((r) => r.p);
    const ms = await milestoneCounts(tx, org, projectIds, p.start, p.end, today);
    const sum = (f: (i: Inputs) => number) => snaps.reduce((a, s) => a + (inputsOf(s) ? f(inputsOf(s)!) : 0), 0);
    await upsertSnapshot(tx, org.id, {
      ...base,
      subjectType: 'TEAM',
      subjectId: teamId,
      score: averageScore(snaps),
      coverage: snaps.length ? Math.round(snaps.reduce((a, s) => a + s.coverage, 0) / snaps.length) : 0,
      metrics: {
        members: t.members.length,
        scored_members: snaps.filter((s) => s.score !== null).length,
        approved_seconds: snaps.reduce((a, s) => a + approvedSecondsOf(s), 0),
        goals: { completed: due.filter((g) => g.status === 'COMPLETED').length, due: due.length },
        milestones: ms,
        attendance: { on_time: sum((i) => i.attendance.on_time), scheduled: sum((i) => i.attendance.scheduled) },
        delivery: { on_time: sum((i) => i.delivery.on_time), due: sum((i) => i.delivery.due) },
      },
      eligible: snaps.some((s) => s.score !== null),
      rankGroup: null,
    });
  }

  // Projects: delivery only (milestones and tasks done by their due dates). No money.
  const live = await tx.select({ id: projects.id }).from(projects).where(and(isNull(projects.archivedAt)));
  for (const pr of live) {
    const ms = await milestoneCounts(tx, org, [pr.id], p.start, p.end, today);
    const ts = await taskCounts(tx, org, pr.id, p.start, p.end, today);
    const due = ms.due + ts.due;
    await upsertSnapshot(tx, org.id, { ...base, subjectType: 'PROJECT', subjectId: pr.id, score: ratioScore(ms.on_time + ts.on_time, due), coverage: due ? 100 : 0, metrics: { milestones: ms, tasks: ts }, eligible: due > 0, rankGroup: null });
  }

  // The organization: everyone's scores.
  const all = [...memberSnaps.values()];
  await upsertSnapshot(tx, org.id, { ...base, subjectType: 'ORG', subjectId: org.id, score: averageScore(all), coverage: all.length ? Math.round(all.reduce((a, s) => a + s.coverage, 0) / all.length) : 0, metrics: { members: all.length, scored_members: all.filter((s) => s.score !== null).length }, eligible: true, rankGroup: null });
  return { members: people.length };
}

async function milestoneCounts(tx: Tx, org: OrgInfo, projectIds: string[], from: string, to: string, today: string) {
  if (!projectIds.length) return { on_time: 0, due: 0, done: 0, total: 0 };
  const rows = await tx.select({ due: projectMilestones.dueDate, at: projectMilestones.completedAt }).from(projectMilestones).where(and(inArray(projectMilestones.projectId, projectIds), isNull(projectMilestones.archivedAt), gte(projectMilestones.dueDate, from), lte(projectMilestones.dueDate, to)));
  const counted = rows.filter((r) => r.due <= today || r.at);
  return { on_time: counted.filter((r) => r.at && localDate(r.at, org.timezone) <= r.due).length, due: counted.length, done: rows.filter((r) => r.at).length, total: rows.length };
}

async function taskCounts(tx: Tx, org: OrgInfo, projectId: string, from: string, to: string, today: string) {
  const rows = await tx.select({ due: tasks.dueDate, at: tasks.completedAt }).from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), isNotNull(tasks.dueDate), gte(tasks.dueDate, from), lte(tasks.dueDate, to)));
  const counted = rows.filter((r) => r.due! <= today || r.at);
  return { on_time: counted.filter((r) => r.at && localDate(r.at, org.timezone) <= r.due!).length, due: counted.length, done: rows.filter((r) => r.at).length, total: rows.length };
}

async function snapshotsFor(tx: Tx, subjectType: Snapshot['subjectType'], periodType: PerformancePeriod, starts: string[]) {
  if (!starts.length) return [];
  return tx.select().from(performanceScoreSnapshots).where(and(eq(performanceScoreSnapshots.subjectType, subjectType), eq(performanceScoreSnapshots.periodType, periodType), inArray(performanceScoreSnapshots.periodStart, starts)));
}

/** Make sure a period has snapshots before it is read (filled once; the daily job keeps them current). */
async function ensurePeriod(x: Ctx, periodType: PerformancePeriod, start: string) {
  const [any] = await x.tx.select({ id: performanceScoreSnapshots.id }).from(performanceScoreSnapshots).where(and(eq(performanceScoreSnapshots.subjectType, 'ORG'), eq(performanceScoreSnapshots.periodType, periodType), eq(performanceScoreSnapshots.periodStart, start))).limit(1);
  if (!any) await refreshPerformance(x.tx, x.org, periodType, start, x.deps.now());
}

/** An admin recalculates the current period now (otherwise the daily job does it). */
export async function recalculatePerformance(x: Ctx, periodType: PerformancePeriod, date?: string) {
  if (!can(x.actor, 'performance:manage')) throw forbidden();
  return refreshPerformance(x.tx, x.org, periodType, date ?? orgToday(x), x.deps.now());
}

// ─── Leaderboards ────────────────────────────────────────────────────────────

export interface LeaderboardRow {
  id: string;
  name: string;
  sub: string | null;
  rank: number | null;
  /** change in rank since the previous period (positive: climbed), null when not ranked in both */
  movement: number | null;
  score: number | null;
  eligible: boolean;
  goals: { completed: number; due: number } | null;
  delivery: { on_time: number; due: number } | null;
  achievements: number;
  /** scores of the last six periods, oldest first (null where none) */
  trend: Array<number | null>;
}

/**
 * Rankings for a period. Who sees them: admins (everyone); team managers (the people and teams they
 * manage) when the organization allows it; workers only when the organization turned it on.
 * People are ranked within their role family, never on hours, activity or screenshots.
 */
export async function leaderboard(x: Ctx, q: { type: 'workers' | 'teams' | 'projects'; period: PerformancePeriod; date?: string; compare?: 'role' | 'everyone' }) {
  const scope = x.actor.grants['performance:read'];
  if (!scope) throw forbidden();
  const settings = await currentSettings(x.tx, x.org.id);
  if (scope === 'team' && !settings.leaderboardManagers) throw forbidden('Leaderboards are turned off for managers in this organization.');
  if (scope === 'own' && !settings.leaderboardWorkers) throw forbidden('Leaderboards are not shared with workers in this organization.');
  const today = orgToday(x);
  const date = q.date ?? today;
  const periods = recentPeriods(q.period, date, 6, x.org.weekStart);
  const current = periods.at(-1)!;
  await ensurePeriod(x, q.period, current.start);
  const rule = await currentRules(x.tx, x.org.id);
  // Workers with the board turned on see the organization-wide ranking, and only names and scores.
  const summaryOnly = scope === 'own';
  const subjectType = q.type === 'workers' ? 'MEMBER' : q.type === 'teams' ? 'TEAM' : 'PROJECT';
  const snaps = await snapshotsFor(x.tx, subjectType, q.period, periods.map((p) => p.start));
  const byPeriod = (start: string) => snaps.filter((s) => s.periodStart === start);

  let subjects: Array<{ id: string; name: string; sub: string | null; group: string }>;
  if (q.type === 'workers') {
    const people = summaryOnly ? await activeMembers(x.tx) : await visibleActiveMembers(x, 'performance:read');
    subjects = people.map((m) => ({ id: m.id, name: m.name, sub: m.title ?? m.role, group: q.compare === 'everyone' ? '' : m.rankGroup }));
  } else if (q.type === 'teams') {
    const visible = summaryOnly ? 'all' : await visibleTeamIds(x, 'performance:read');
    const roster = await teamRoster(x.tx);
    subjects = [...roster.entries()].filter(([id]) => visible === 'all' || visible.has(id)).map(([id, t]) => ({ id, name: t.name, sub: `${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}`, group: '' }));
  } else {
    const rows = await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(isNull(projects.archivedAt));
    subjects = rows.filter((p) => summaryOnly || can(x.actor, 'projects:read', { projectId: p.id })).map((p) => ({ id: p.id, name: p.name, sub: null, group: '' }));
  }
  const ids = new Set(subjects.map((s) => s.id));
  const rank = (start: string) => {
    const list = byPeriod(start).filter((s) => ids.has(s.subjectId));
    const group = new Map(subjects.map((s) => [s.id, s.group]));
    return new Map(rankEntries(list.map((s) => ({ id: s.subjectId, score: s.score, eligible: s.eligible, group: group.get(s.subjectId) ?? '' }))).map((r) => [r.id, r.rank]));
  };
  const now = rank(current.start);
  const before = periods.length > 1 ? rank(periods.at(-2)!.start) : new Map<string, number | null>();
  const awardCounts = await awardsInPeriod(x.tx, q.type === 'teams' ? 'team' : 'member', current.start, current.end, x.org.timezone);
  const rows: LeaderboardRow[] = subjects.map((s) => {
    const snap = byPeriod(current.start).find((v) => v.subjectId === s.id);
    const r = now.get(s.id) ?? null;
    const prev = before.get(s.id) ?? null;
    const m = snap?.metrics as Record<string, any> | undefined;
    return {
      id: s.id,
      name: s.name,
      sub: s.sub,
      rank: r,
      movement: r !== null && prev !== null ? prev - r : null,
      score: snap?.score ?? null,
      eligible: snap?.eligible ?? false,
      goals: summaryOnly ? null : q.type === 'workers' ? (m?.inputs?.goals ?? null) : (m?.goals ?? null),
      delivery: summaryOnly ? null : q.type === 'workers' ? (m?.inputs?.delivery ?? null) : q.type === 'teams' ? (m?.milestones ? { on_time: m.milestones.on_time, due: m.milestones.due } : null) : m ? { on_time: m.milestones.on_time + m.tasks.on_time, due: m.milestones.due + m.tasks.due } : null,
      achievements: q.type === 'projects' ? 0 : (awardCounts.get(s.id) ?? 0),
      trend: periods.map((p) => byPeriod(p.start).find((v) => v.subjectId === s.id)?.score ?? null),
    };
  });
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  return {
    type: q.type,
    period: q.period,
    start: current.start,
    end: current.end,
    rule_version: rule.version,
    min_eligible_days: rule.minEligibleDays,
    compare: q.compare ?? 'role',
    summary_only: summaryOnly,
    ranked: rows.filter((r) => r.rank !== null).length,
    rows: summaryOnly ? rows.filter((r) => r.rank !== null).map((r) => ({ ...r, trend: [], movement: null })) : rows,
  };
}

/** Public, unrevoked awards in a period, per recipient (member or team). */
async function awardsInPeriod(tx: Tx, kind: 'member' | 'team', from: string, to: string, timeZone: string) {
  const rows = await tx.select({ m: achievementAwards.membershipId, t: achievementAwards.teamId, at: achievementAwards.createdAt }).from(achievementAwards).where(and(isNull(achievementAwards.revokedAt), eq(achievementAwards.visibility, 'PUBLIC'), gte(achievementAwards.createdAt, new Date(`${addDaysToDate(from, -1)}T00:00:00Z`))));
  const out = new Map<string, number>();
  for (const r of rows) {
    const d = localDate(r.at, timeZone);
    if (d < from || d > to) continue;
    const id = kind === 'team' ? r.t : r.m;
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

// ─── Team performance ────────────────────────────────────────────────────────

export async function teamPerformance(x: Ctx, q: { period: PerformancePeriod; date?: string; teamIds?: string[] }) {
  if (!x.actor.grants['performance:read'] || x.actor.grants['performance:read'] === 'own') throw forbidden();
  const periods = recentPeriods(q.period, q.date ?? orgToday(x), 6, x.org.weekStart);
  const current = periods.at(-1)!;
  await ensurePeriod(x, q.period, current.start);
  const visible = await visibleTeamIds(x, 'performance:read');
  const roster = await teamRoster(x.tx);
  const teamIds = [...roster.keys()].filter((id) => (visible === 'all' || visible.has(id)) && (!q.teamIds?.length || q.teamIds.includes(id)));
  const snaps = await snapshotsFor(x.tx, 'TEAM', q.period, periods.map((p) => p.start));
  const ranks = new Map(rankEntries(snaps.filter((s) => s.periodStart === current.start && (visible === 'all' || visible.has(s.subjectId))).map((s) => ({ id: s.subjectId, score: s.score, eligible: s.eligible }))).map((r) => [r.id, r.rank]));
  const memberSnaps = await snapshotsFor(x.tx, 'MEMBER', q.period, [current.start]);
  const awards = await awardsInPeriod(x.tx, 'team', current.start, current.end, x.org.timezone);
  const memberAwards = await awardsInPeriod(x.tx, 'member', current.start, current.end, x.org.timezone);
  const people = new Map((await activeMembers(x.tx)).map((m) => [m.id, m]));
  return {
    period: q.period,
    start: current.start,
    end: current.end,
    periods: periods.map((p) => p.start),
    teams: teamIds.map((id) => {
      const t = roster.get(id)!;
      const snap = snaps.find((s) => s.subjectId === id && s.periodStart === current.start);
      const m = (snap?.metrics ?? {}) as Record<string, any>;
      return {
        id,
        name: t.name,
        members: t.members.length,
        rank: ranks.get(id) ?? null,
        score: snap?.score ?? null,
        approved_seconds: Number(m.approved_seconds ?? 0),
        goals: m.goals ?? { completed: 0, due: 0 },
        milestones: m.milestones ?? { on_time: 0, due: 0, done: 0, total: 0 },
        attendance: m.attendance ?? { on_time: 0, scheduled: 0 },
        achievements: (awards.get(id) ?? 0) + t.members.reduce((a, mid) => a + (memberAwards.get(mid) ?? 0), 0),
        history: periods.map((p) => snaps.find((s) => s.subjectId === id && s.periodStart === p.start)?.score ?? null),
        people: t.members
          .map((mid) => {
            const s = memberSnaps.find((v) => v.subjectId === mid);
            const info = people.get(mid);
            return { id: mid, name: info?.name ?? '', title: info?.title ?? null, manager: t.managers.includes(mid), score: s?.score ?? null, approved_seconds: approvedSecondsOf(s), eligible: s?.eligible ?? false };
          })
          .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      };
    }),
  };
}

// ─── Overview ────────────────────────────────────────────────────────────────

/** The Performance overview for the people and teams the actor may see. */
export async function performanceOverview(x: Ctx, q: { period: PerformancePeriod; date?: string; teamId?: string; projectId?: string }) {
  const scope = x.actor.grants['performance:read'];
  if (!scope || scope === 'own') throw forbidden();
  if (q.teamId && !(await canSeeTeam(x, 'performance:read', q.teamId))) throw notFound('team');
  if (q.projectId && !can(x.actor, 'projects:read', { projectId: q.projectId })) throw notFound('project');
  const today = orgToday(x);
  const periods = recentPeriods(q.period, q.date ?? today, 6, x.org.weekStart);
  const current = periods.at(-1)!;
  const previous = periods.at(-2)!;
  await ensurePeriod(x, q.period, current.start);
  let people = await visibleActiveMembers(x, 'performance:read');
  const roster = await teamRoster(x.tx);
  if (q.teamId) {
    const inTeam = new Set(roster.get(q.teamId)?.members ?? []);
    people = people.filter((p) => inTeam.has(p.id));
  }
  const ids = new Set(people.map((p) => p.id));
  const memberSnaps = (await snapshotsFor(x.tx, 'MEMBER', q.period, periods.map((p) => p.start))).filter((s) => ids.has(s.subjectId));
  const at = (start: string) => memberSnaps.filter((s) => s.periodStart === start);
  const visibleTeams = await visibleTeamIds(x, 'performance:read');
  const teamIds = [...roster.keys()].filter((id) => (visibleTeams === 'all' || visibleTeams.has(id)) && (!q.teamId || id === q.teamId));
  const teamSnaps = await snapshotsFor(x.tx, 'TEAM', q.period, [current.start]);

  // Goals and milestones in the period, among what the actor may see.
  const goals = (await memberAndTeamGoals(x, current.start, current.end)).filter((g) => (g.membershipId ? ids.has(g.membershipId) : teamIds.includes(g.teamId!)));
  const due = goals.filter((g) => g.status === 'COMPLETED' || g.endDate <= today);
  const teamDue = due.filter((g) => g.subjectType === 'TEAM');
  const projectRows = await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(isNull(projects.archivedAt));
  const visibleProjects = projectRows.filter((p) => can(x.actor, 'projects:read', { projectId: p.id }) && (!q.projectId || p.id === q.projectId));
  const milestones = visibleProjects.length
    ? await x.tx.select().from(projectMilestones).where(and(inArray(projectMilestones.projectId, visibleProjects.map((p) => p.id)), isNull(projectMilestones.archivedAt), gte(projectMilestones.dueDate, current.start), lte(projectMilestones.dueDate, current.end)))
    : [];
  const msDue = milestones.filter((m) => m.dueDate <= today || m.completedAt);
  const msOnTime = msDue.filter((m) => m.completedAt && localDate(m.completedAt, x.org.timezone) <= m.dueDate);

  const awards = await listAwards(x, { from: periods[0]!.start, to: current.end, limit: 500 });
  const inPeriod = (d: string, p: { start: string; end: string }) => d >= p.start && d <= p.end;
  const awardsNow = awards.filter((a) => inPeriod(localDate(new Date(a.created_at), x.org.timezone), current));
  const months = recentPeriods('MONTH', current.end, 6, x.org.weekStart);
  const monthAwards = months.map((m) => {
    const list = awards.filter((a) => inPeriod(localDate(new Date(a.created_at), x.org.timezone), m));
    return { month: m.start, bronze: list.filter((a) => a.tier === 'BRONZE').length, silver: list.filter((a) => a.tier === 'SILVER').length, gold: list.filter((a) => a.tier === 'GOLD' || a.tier === null).length, platinum: list.filter((a) => a.tier === 'PLATINUM').length };
  });
  const allGoals = await memberAndTeamGoals(x, months[0]!.start, months.at(-1)!.end);
  const goalMonths = months.map((m) => {
    const list = allGoals.filter((g) => inPeriod(g.endDate, m) && (g.membershipId ? ids.has(g.membershipId) : teamIds.includes(g.teamId!)) && (g.status === 'COMPLETED' || g.endDate <= today));
    return { month: m.start, due: list.length, completed: list.filter((g) => g.status === 'COMPLETED').length };
  });

  return {
    period: q.period,
    start: current.start,
    end: current.end,
    kpis: {
      active_workers: people.length,
      active_teams: teamIds.length,
      score: averageScore(at(current.start)),
      previous_score: averageScore(at(previous.start)),
      achievements: awardsNow.length,
      achievements_automatic: awardsNow.filter((a) => a.source === 'AUTOMATIC').length,
      goals_completed: due.filter((g) => g.status === 'COMPLETED').length,
      goals_due: due.length,
      team_goal_completion: ratioScore(teamDue.filter((g) => g.status === 'COMPLETED').length, teamDue.length),
      project_delivery: ratioScore(msOnTime.length, msDue.length),
      milestones_on_time: msOnTime.length,
      milestones_due: msDue.length,
    },
    score_trend: periods.map((p) => ({ start: p.start, score: averageScore(at(p.start)), lowest_team: null as number | null, highest_team: null as number | null })),
    parts: partsAverage(at(current.start)),
    teams: teamIds
      .map((id) => {
        const s = teamSnaps.find((v) => v.subjectId === id);
        const m = (s?.metrics ?? {}) as Record<string, any>;
        return { id, name: roster.get(id)!.name, members: roster.get(id)!.members.length, score: s?.score ?? null, attendance: m.attendance ?? { on_time: 0, scheduled: 0 } };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    achievements_by_month: monthAwards,
    goals_by_month: goalMonths,
    projects: visibleProjects
      .map((p) => {
        const list = milestones.filter((m) => m.projectId === p.id).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
        const late = list.some((m) => !m.completedAt && m.dueDate < today) || list.some((m) => m.completedAt && localDate(m.completedAt, x.org.timezone) > m.dueDate);
        const next = list.find((m) => !m.completedAt);
        return { id: p.id, name: p.name, total: list.length, done: list.filter((m) => m.completedAt).length, status: !list.length ? null : list.every((m) => m.completedAt) ? 'DONE' : late ? 'AT_RISK' : 'ON_TRACK', next: next ? { title: next.title, due_date: next.dueDate } : null, steps: list.map((m) => (m.completedAt ? (localDate(m.completedAt, x.org.timezone) <= m.dueDate ? 'ON_TIME' : 'LATE') : m.dueDate < today ? 'OVERDUE' : 'OPEN')) };
      })
      .filter((p) => p.total > 0),
    recognition: awards.slice(0, 6),
  };
}

/** Average of each score part across members (measured values only). */
function partsAverage(snaps: Snapshot[]) {
  const keys = ['goals', 'delivery', 'consistency', 'quality', 'attendance'] as const;
  return Object.fromEntries(
    keys.map((k) => {
      const vals = snaps.map((s) => (s.metrics as { parts?: Record<string, { value: number | null; weight: number }> }).parts?.[k]).filter((v): v is { value: number; weight: number } => !!v && v.value !== null);
      const weight = (snaps[0]?.metrics as { parts?: Record<string, { weight: number }> } | undefined)?.parts?.[k]?.weight ?? null;
      return [k, { value: vals.length ? round1(vals.reduce((a, v) => a + v.value, 0) / vals.length) : null, weight, measured_for: vals.length }];
    }),
  );
}

async function memberAndTeamGoals(x: Ctx, from: string, to: string) {
  return x.tx.select().from(performanceGoals).where(and(inArray(performanceGoals.subjectType, ['MEMBER', 'TEAM']), sql`${performanceGoals.status} <> 'ARCHIVED'`, gte(performanceGoals.endDate, from), lte(performanceGoals.endDate, to)));
}

// ─── Worker performance ──────────────────────────────────────────────────────

/** People the actor may see, with this period's score (for the Worker performance list). */
export async function memberPerformanceList(x: Ctx, q: { period: PerformancePeriod; date?: string }) {
  const scope = x.actor.grants['performance:read'];
  if (!scope || scope === 'own') throw forbidden();
  const current = periodBounds(q.period, q.date ?? orgToday(x), x.org.weekStart);
  await ensurePeriod(x, q.period, current.start);
  const people = await visibleActiveMembers(x, 'performance:read');
  const snaps = await snapshotsFor(x.tx, 'MEMBER', q.period, [current.start]);
  const roster = await teamRoster(x.tx);
  const teamOf = new Map<string, string[]>();
  for (const [, t] of roster) for (const m of t.members) teamOf.set(m, [...(teamOf.get(m) ?? []), t.name]);
  return {
    start: current.start,
    end: current.end,
    rows: people
      .map((p) => {
        const s = snaps.find((v) => v.subjectId === p.id);
        const i = inputsOf(s);
        return { id: p.id, name: p.name, title: p.title, role: p.role, teams: teamOf.get(p.id) ?? [], score: s?.score ?? null, eligible: s?.eligible ?? false, approved_seconds: approvedSecondsOf(s), goals: i?.goals ?? null, attendance: i?.attendance ?? null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** One person's performance profile (managers and admins; the worker sees theirs in the desktop app). */
export async function memberProfile(x: Ctx, membershipId: string, q: { period: PerformancePeriod; date?: string }) {
  const p = periodBounds(q.period, q.date ?? orgToday(x), x.org.weekStart);
  const score = await memberScore(x, membershipId, p.start, p.end);
  const [info] = await activeMembers(x.tx, [membershipId]);
  const roster = await teamRoster(x.tx);
  const teams = [...roster.entries()].filter(([, t]) => t.members.includes(membershipId)).map(([id, t]) => ({ id, name: t.name }));
  const projectRows = await x.tx.select({ id: projects.id, name: projects.name }).from(projects).innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.membershipId, membershipId))).where(isNull(projects.archivedAt));
  // Approved time per project in the period (no money).
  const today = orgToday(x);
  const until = p.end < today ? p.end : today;
  const perProject = await x.tx
    .select({ project: timeEntries.projectId, s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
    .from(timeEntries)
    .innerJoin(timesheets, and(eq(timesheets.membershipId, timeEntries.membershipId), eq(timesheets.status, 'APPROVED'), lte(timesheets.periodStart, timeEntries.localDate), gte(timesheets.periodEnd, timeEntries.localDate)))
    .where(and(eq(timeEntries.membershipId, membershipId), isNull(timeEntries.deletedAt), gte(timeEntries.localDate, p.start), lte(timeEntries.localDate, until)))
    .groupBy(timeEntries.projectId);
  const pnames = new Map((await x.tx.select({ id: projects.id, name: projects.name }).from(projects)).map((r) => [r.id, r.name]));
  const doneTasks = await x.tx
    .select({ project: tasks.projectId, at: tasks.completedAt })
    .from(tasks)
    .innerJoin(taskAssignees, and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.membershipId, membershipId)))
    .where(and(eq(tasks.status, 'DONE'), isNull(tasks.archivedAt), gte(tasks.completedAt, new Date(`${addDaysToDate(p.start, -1)}T00:00:00Z`))));
  const tasksIn = doneTasks.filter((t) => t.at && localDate(t.at, x.org.timezone) >= p.start && localDate(t.at, x.org.timezone) <= p.end);
  const projectIdsSeen = [...new Set([...perProject.map((r) => r.project).filter((v): v is string => !!v), ...tasksIn.map((t) => t.project)])];
  const milestones = projectRows.length ? await x.tx.select().from(projectMilestones).where(and(inArray(projectMilestones.projectId, projectRows.map((r) => r.id)), isNull(projectMilestones.archivedAt), isNotNull(projectMilestones.completedAt))) : [];
  const msIn = milestones.filter((m) => { const d = localDate(m.completedAt!, x.org.timezone); return d >= p.start && d <= p.end; });
  const rule = await currentRules(x.tx, x.org.id);
  const snaps = await snapshotsFor(x.tx, 'MEMBER', q.period, [p.start]);
  const mine = snaps.find((s) => s.subjectId === membershipId);
  const group = rankEntries(snaps.filter((s) => s.rankGroup === (mine?.rankGroup ?? info?.rankGroup)).map((s) => ({ id: s.subjectId, score: s.score, eligible: s.eligible })));
  const myRank = group.find((r) => r.id === membershipId);
  return {
    member: { id: membershipId, name: info?.name ?? '', title: info?.title ?? null, role: info?.role ?? '', teams, projects: projectRows },
    period: { type: q.period, start: p.start, end: p.end },
    score,
    rank: myRank?.rank ?? null,
    rank_group_size: group.filter((r) => r.rank !== null).length,
    rank_group: mine?.rankGroup ?? info?.rankGroup ?? null,
    rule_version: rule.version,
    kpis: {
      approved_seconds: perProject.reduce((a, r) => a + Number(r.s), 0),
      attendance: score.inputs.attendance,
      goals: score.inputs.goals,
      milestones_on_time: msIn.filter((m) => localDate(m.completedAt!, x.org.timezone) <= m.dueDate).length,
      milestones_done: msIn.length,
      tasks_done: tasksIn.length,
    },
    contributions: projectIdsSeen
      .map((id) => ({ project_id: id, name: pnames.get(id) ?? '', approved_seconds: Number(perProject.find((r) => r.project === id)?.s ?? 0), tasks_done: tasksIn.filter((t) => t.project === id).length, milestones_done: msIn.filter((m) => m.projectId === id).length }))
      .sort((a, b) => b.approved_seconds - a.approved_seconds),
    goals: (await memberGoals(x, membershipId)).filter((g) => g.subject_type === 'MEMBER'),
    achievements: await listAwards(x, { membershipId, limit: 50 }),
    history: await listMemberSnapshots(x, membershipId, q.period),
  };
}

