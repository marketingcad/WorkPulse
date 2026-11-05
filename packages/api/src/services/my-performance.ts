import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { achievementAwards, achievementDefinitions, projectMembers, projectMilestones, projects, taskAssignees, tasks } from '@tallywork/db';
import { ACHIEVEMENT_TIERS, addDaysToDate, localDate, periodBounds, tiersReached } from '@tallywork/domain';
import type { Ctx } from './ctx';
import { awardDtos, ensureBuiltinAchievements, memberMeasure } from './achievements';
import { memberGoals } from './goals';
import { currentSettings, listMemberSnapshots, memberMetricInputs, memberScore } from './performance';
import { computeAttendance } from './operations';
import { sharedReviewsFor } from './reviews';

/**
 * "My performance" in the desktop app: the worker's own goals, badges, recognition and progress.
 * Only their own data (the device's own-data grants), never anyone else's or an organization ranking.
 * Their score shows only when the organization chose to share it (performance settings).
 */
export async function myPerformance(x: Ctx) {
  const me = x.actor.membershipId;
  const now = x.deps.now();
  const today = localDate(now, x.org.timezone);
  const week = periodBounds('WEEK', today, x.org.weekStart);
  const settings = await currentSettings(x.tx, x.org.id);
  await ensureBuiltinAchievements(x.tx, x.org.id);

  const awardRows = await x.tx.select().from(achievementAwards).where(and(eq(achievementAwards.membershipId, me), isNull(achievementAwards.revokedAt))).orderBy(desc(achievementAwards.createdAt));
  const awards = await awardDtos(x, awardRows);

  // The closest next level among automatic achievements.
  const defs = await x.tx.select().from(achievementDefinitions).where(and(eq(achievementDefinitions.mode, 'AUTOMATIC'), isNull(achievementDefinitions.archivedAt)));
  const values = new Map<string, number>();
  let next: { definition_id: string; name: string; icon: string; tier: (typeof ACHIEVEMENT_TIERS)[number] | null; value: number; target: number; pct: number } | null = null;
  for (const d of defs) {
    if (!d.metric || d.metric === 'TOP_SCORE' || !d.thresholds?.length) continue;
    if (!values.has(d.metric)) values.set(d.metric, await memberMeasure(x.tx, x.org, me, d.metric, now));
    const value = values.get(d.metric)!;
    const reached = tiersReached(d.thresholds, value).length;
    if (reached >= d.thresholds.length) continue;
    const target = d.thresholds[reached]!;
    const pct = Math.min(99, Math.floor((value / target) * 100));
    if (!next || pct > next.pct) next = { definition_id: d.id, name: d.name, icon: d.icon, tier: d.thresholds.length > 1 ? ACHIEVEMENT_TIERS[reached]! : null, value, target, pct };
  }

  // This week: approved and scheduled time, tasks, and the consistency streak.
  const inputs = await memberMetricInputs(x.tx, x.org, me, week.start, week.end, now);
  const attendance = await computeAttendance(x.tx, x.org.id, x.org.settings.lateGraceMinutes, [me], week.start, week.end, now);
  const dueThisWeek = await x.tx
    .select({ status: tasks.status, completedAt: tasks.completedAt })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(and(eq(taskAssignees.membershipId, me), isNull(tasks.archivedAt), gte(tasks.dueDate, week.start), lte(tasks.dueDate, week.end)));
  const doneThisWeek = await x.tx
    .select({ at: tasks.completedAt })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(and(eq(taskAssignees.membershipId, me), eq(tasks.status, 'DONE'), isNull(tasks.archivedAt), gte(tasks.completedAt, new Date(`${addDaysToDate(week.start, -1)}T00:00:00Z`))));

  // Milestones on the worker's projects: the next ones and the recently delivered.
  const myProjects = (await x.tx.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.membershipId, me))).map((r) => r.id);
  const ms = myProjects.length
    ? await x.tx
        .select({ id: projectMilestones.id, title: projectMilestones.title, due: projectMilestones.dueDate, at: projectMilestones.completedAt, project: projects.name })
        .from(projectMilestones)
        .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
        .where(and(inArray(projectMilestones.projectId, myProjects), isNull(projectMilestones.archivedAt), isNull(projects.archivedAt), gte(projectMilestones.dueDate, addDaysToDate(today, -45))))
        .orderBy(asc(projectMilestones.dueDate))
    : [];
  const upcoming = ms.filter((m) => !m.at).slice(0, 4);
  const delivered = ms.filter((m) => m.at).slice(-3).reverse();

  const showScore = settings.workersSeeOwnScore;
  return {
    week: {
      start: week.start,
      end: week.end,
      approved_seconds: inputs.approvedSeconds,
      scheduled_seconds: attendance.reduce((a, r) => a + r.scheduled_seconds, 0),
      tasks_done: doneThisWeek.filter((t) => t.at && localDate(t.at, x.org.timezone) >= week.start && localDate(t.at, x.org.timezone) <= week.end).length,
      tasks_due: dueThisWeek.length,
      streak_weeks: values.get('CONSISTENT_WEEKS') ?? (await memberMeasure(x.tx, x.org, me, 'CONSISTENT_WEEKS', now)),
    },
    goals: await memberGoals(x, me),
    badges: awards,
    recognition: awards.filter((a) => a.source !== 'AUTOMATIC'),
    next_badge: next,
    milestones: [...upcoming, ...delivered].map((m) => ({ id: m.id, title: m.title, project: m.project, due_date: m.due, completed_at: m.at?.toISOString() ?? null, on_time: m.at ? localDate(m.at, x.org.timezone) <= m.due : null })),
    score: showScore ? await memberScore(x, me, periodBounds('MONTH', today).start, periodBounds('MONTH', today).end) : null,
    trend: showScore ? (await listMemberSnapshots(x, me, 'MONTH')).slice(0, 6).reverse().map((s) => ({ period_start: s.period_start, score: s.score })) : [],
    reviews: await sharedReviewsFor(x.tx, me),
  };
}

