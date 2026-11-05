import type { Tx } from '@tallywork/db';
import { addDaysToDate, localDate, periodBounds, type PerformancePeriod } from '@tallywork/domain';
import type { Deps } from '../context';
import { loadOrg } from '../middleware/tenant';
import { evaluateMemberAchievements, monthlyTopPerformers, projectMemberIds } from './achievements';
import { recalcActiveGoals } from './goals';
import { refreshPerformance } from './leaderboards';
import { activeMembers } from './performance-access';

/**
 * The Performance Center reacts to work as it happens (outbox events) and once a day (snapshots,
 * period close, streaks and monthly recognition). Every step is idempotent: awards and goal progress
 * have unique keys, and a closed period's snapshots never change, so a retried or repeated run gives
 * the same result.
 */
export async function handlePerformanceEvent(tx: Tx, deps: Deps, e: { event_id: string; event_type: string; organization_id: string; payload: Record<string, unknown> }): Promise<void> {
  const p = e.payload;
  switch (e.event_type) {
    case 'task.completed': {
      const org = await loadOrg(tx, e.organization_id);
      for (const m of (p.assignee_ids as string[] | undefined) ?? []) await evaluateMemberAchievements(tx, deps, org, m, ['TASKS_COMPLETED'], deps.now());
      await recalcActiveGoals(tx, deps, org, deps.now(), 'task', `event:${e.event_id}`, ['TASKS_COMPLETED']);
      break;
    }
    case 'milestone.completed': {
      const org = await loadOrg(tx, e.organization_id);
      if (p.on_time) for (const m of await projectMemberIds(tx, p.project_id as string)) await evaluateMemberAchievements(tx, deps, org, m, ['MILESTONES_ON_TIME'], deps.now());
      await recalcActiveGoals(tx, deps, org, deps.now(), 'milestone', `event:${e.event_id}`, ['MILESTONES_COMPLETED']);
      break;
    }
    case 'timesheet.approved': {
      const org = await loadOrg(tx, e.organization_id);
      await evaluateMemberAchievements(tx, deps, org, p.membership_id as string, ['APPROVED_HOURS', 'CONSISTENT_WEEKS'], deps.now());
      await recalcActiveGoals(tx, deps, org, deps.now(), 'timesheet', `event:${e.event_id}`, ['APPROVED_HOURS']);
      break;
    }
    default:
      break;
  }
}

/** Upper bound on periods walked back per type (weeks: the current one plus up to three settling). */
const MAX_OPEN_PERIODS = 5;

/** Once a day per organization. */
export async function performanceDaily(tx: Tx, deps: Deps, orgId: string): Promise<Record<string, number>> {
  const org = await loadOrg(tx, orgId);
  const now = deps.now();
  const today = localDate(now, org.timezone);
  let members = 0;
  // This period and every earlier one that has not settled yet (SCORE_SETTLE_DAYS after it ends), so
  // timesheets approved and reviews written after a period ends still count. The walk stops at the
  // first settled period, which is saved as final the first time it is reached and never changes after.
  for (const type of ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as PerformancePeriod[]) {
    let date = today;
    for (let i = 0; i < MAX_OPEN_PERIODS; i++) {
      const r = await refreshPerformance(tx, org, type, date, now);
      if (i === 0) members = r.members;
      if (r.final) break;
      date = addDaysToDate(periodBounds(type, date, org.weekStart).start, -1);
    }
  }
  const lastMonth = periodBounds('MONTH', addDaysToDate(periodBounds('MONTH', today).start, -1)).start;
  const top = await monthlyTopPerformers(tx, deps, org, lastMonth);
  const goals = await recalcActiveGoals(tx, deps, org, now, 'daily', `daily:${today}`);
  let streaks = 0;
  for (const m of await activeMembers(tx)) streaks += await evaluateMemberAchievements(tx, deps, org, m.id, ['ON_TIME_MONTHS', 'CONSISTENT_WEEKS', 'APPROVED_HOURS'], now);
  return { members, top_performers: top, goals_updated: goals, streak_awards: streaks };
}
