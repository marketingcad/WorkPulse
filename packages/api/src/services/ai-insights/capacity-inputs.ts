import { addDaysToDate } from '@tallywork/domain';
import type { Period, TeamCapacity } from '@tallywork/domain/insights';
import type { Ctx } from '../ctx';
import { listShifts, listTimeOffRequests } from '../operations';
import { canSeeMembership } from '../scope';
import { timeEntryTotals } from '../timesheets';
import { listTasks, listTeams } from '../work';

/**
 * Capacity inputs per team for the next two weeks, through scoped services only: the teams the
 * person manages (all, for organization scope), their members' scheduled shifts, approved time off,
 * their recent pace (last 4 weeks), and the remaining estimates on open tasks assigned to them.
 */
const has = (x: Ctx, p: string) => x.actor.grants[p as keyof typeof x.actor.grants] !== undefined;
const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

export const mayReadCapacity = (x: Ctx) => {
  const s = x.actor.grants['schedules:read'];
  const t = x.actor.grants['time:read'];
  return (s === 'team' || s === 'org') && (t === 'team' || t === 'org');
};

export const capacityPeriod = (today: string): Period => ({ from: today, to: addDaysToDate(today, 13) });

export async function capacityInputs(x: Ctx, period: Period, today: string): Promise<{ teams: TeamCapacity[] }> {
  const orgWide = x.actor.grants['schedules:read'] === 'org';
  const teams = has(x, 'teams:read') ? (await listTeams(x)).filter((t) => !t.archived_at && (orgWide || x.actor.managedTeamIds.includes(t.id))) : [];
  const members = (t: (typeof teams)[number]) => t.members.map((m) => m.membership_id).filter((id) => canSeeMembership(x.actor, 'schedules:read', id));
  const all = [...new Set(teams.flatMap(members))];
  if (!all.length) return { teams: [] };

  const shifts = await listShifts(x, period.from, period.to, all);
  const shiftSeconds = new Map<string, number>();
  for (const s of shifts) shiftSeconds.set(s.membership_id, (shiftSeconds.get(s.membership_id) ?? 0) + Math.max(0, (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 1000));

  // Approved time off in the period: a request's hours, prorated by the days inside the period.
  const away = new Map<string, number>();
  if (has(x, 'time_off:read')) {
    for (const r of await listTimeOffRequests(x, { status: 'APPROVED', from: period.from, to: period.to })) {
      const total = days(r.start_date, r.end_date);
      const inside = days(r.start_date < period.from ? period.from : r.start_date, r.end_date > period.to ? period.to : r.end_date);
      if (inside > 0 && total > 0) away.set(r.membership_id, (away.get(r.membership_id) ?? 0) + (Number(r.hours) * 3600 * inside) / total);
    }
  }

  const recentFrom = addDaysToDate(today, -28);
  const recent = new Map<string, number>();
  for (const r of await timeEntryTotals(x, { from: recentFrom, to: addDaysToDate(today, -1), membershipIds: all })) recent.set(r.membership_id, (recent.get(r.membership_id) ?? 0) + r.seconds);

  const tasks = has(x, 'tasks:read') ? (await listTasks(x, {})).filter((t) => t.status !== 'DONE') : [];

  return {
    teams: teams.map((t) => {
      const ids = members(t);
      const scheduled = ids.reduce((s, id) => s + (shiftSeconds.get(id) ?? 0), 0);
      const open = tasks.filter((task) => task.assignee_ids.some((a) => ids.includes(a))).reduce((s, task) => s + Math.max(0, (task.estimate_seconds ?? 0) - (task.tracked_seconds ?? 0)), 0);
      return {
        id: t.id,
        name: t.name,
        // No shifts at all means no schedules: capacity cannot be estimated (never assumed to be zero).
        scheduledSeconds: scheduled > 0 ? scheduled : null,
        timeOffSeconds: Math.round(ids.reduce((s, id) => s + (away.get(id) ?? 0), 0)),
        recentWeeklySeconds: Math.round(ids.reduce((s, id) => s + (recent.get(id) ?? 0), 0) / 4),
        openEstimateSeconds: open,
      };
    }),
  };
}
