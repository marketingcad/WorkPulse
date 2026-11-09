import { localDate, addDaysToDate } from '@tallywork/domain';
import { endedPayPeriods, previousPayPeriod, type EntrySpan, type GroupHours, type Period, type ProjectFacts, type SheetSummary } from '@tallywork/domain/insights';
import type { Ctx } from '../ctx';
import { getOvertimeRules, listTimeOffRequests } from '../operations';
import { listMemberOptions } from '../org';
import { overtimeInRange } from '../pay-figures';
import { listMilestones } from '../performance';
import { runReport } from '../reports';
import { canSeeMembership } from '../scope';
import { approvalQueue, listManualTime, listTimeEntries, pageApprovalQueue, timeEntryTotals, timeEntryTotalsByProject } from '../timesheets';
import { listBudgets, listExpenses } from '../finance';
import { listProjects, listTasks, listTeams } from '../work';

/**
 * Inputs for the insight rules, gathered only through the existing scoped services: each one
 * narrows to what this person may see (time:read, timesheets:read, projects:read …). Nothing here
 * reads another member's data without that narrowing, and nothing reads activity, screenshots,
 * rates or review notes.
 */

const has = (x: Ctx, p: Parameters<typeof canSeeMembership>[1]) => x.actor.grants[p] !== undefined;
const ENTRY_LIMIT = 5000;
const MAX_PROJECTS = 50;
const MAX_PERIODS = 5;

async function memberNames(x: Ctx): Promise<Map<string, { name: string; active: boolean; tracked: boolean }>> {
  if (!has(x, 'members:read')) return new Map();
  const rows = await listMemberOptions(x, { includeRemoved: true });
  return new Map(rows.map((m) => [m.id, { name: m.name, active: m.status === 'ACTIVE', tracked: !!m.tracking_enabled }]));
}

function sumBy<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + value(r));
  return out;
}

/** Tracked members in scope without a submitted timesheet for a pay period that has ended. */
export async function missingTimesheets(x: Ctx, period: Period, today: string, names: Awaited<ReturnType<typeof memberNames>>): Promise<Array<{ membershipId: string; memberName: string }> | null> {
  if (!has(x, 'timesheets:read') || !has(x, 'reports:read') || !has(x, 'members:read')) return null;
  // The latest pay periods in the range that have ended (a timesheet is due for each).
  const periods = endedPayPeriods(period.from, period.to, today, x.org.payPeriod, x.org.weekStart, MAX_PERIODS);
  if (!periods.length) return [];
  const report = await runReport(x, 'timesheet-approval', { from: periods[0]!.start, to: periods[periods.length - 1]!.end, billable: 'all' });
  const submitted = new Set(report.rows.filter((r) => r.status !== 'DRAFT').map((r) => `${r.membership_id}|${r.period_start}`));
  const out: Array<{ membershipId: string; memberName: string }> = [];
  for (const [id, m] of names) {
    if (!m.active || !m.tracked || !canSeeMembership(x.actor, 'timesheets:read', id)) continue;
    if (periods.some((p) => !submitted.has(`${id}|${p.start}`))) out.push({ membershipId: id, memberName: m.name });
  }
  return out.sort((a, b) => a.memberName.localeCompare(b.memberName));
}

export async function workforceInputs(x: Ctx, period: Period, previous: Period, today: string) {
  const [cur, prev] = await Promise.all([timeEntryTotals(x, period), timeEntryTotals(x, previous)]);
  const curBy = sumBy(cur, (r) => r.membership_id, (r) => r.seconds);
  const prevBy = sumBy(prev, (r) => r.membership_id, (r) => r.seconds);
  const ids = [...new Set([...curBy.keys(), ...prevBy.keys()])];
  const rules = await getOvertimeRules(x);
  const [ot, prevOt] = await Promise.all([
    overtimeInRange(x.tx, x.org.weekStart, rules, ids, period.from, period.to),
    overtimeInRange(x.tx, x.org.weekStart, rules, ids, previous.from, previous.to),
  ]);
  const otOf = (m: Map<string, { overtime: number }>, id: string) => m.get(id)?.overtime ?? 0;
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  // Teams: only those with at least one member this person may see under time:read, and only
  // those members' hours. A team made only of people outside their scope is not named at all.
  const groups: GroupHours[] = [];
  if (has(x, 'teams:read')) {
    // A manager sees their own teams only (being a plain member of another team does not count).
    const orgWide = x.actor.grants['time:read'] === 'org';
    for (const team of await listTeams(x)) {
      if (team.archived_at || (!orgWide && !x.actor.managedTeamIds.includes(team.id))) continue;
      const members = team.members.map((m) => m.membership_id).filter((id) => canSeeMembership(x.actor, 'time:read', id));
      if (!members.length) continue;
      const sum = (m: Map<string, number>) => members.reduce((s, id) => s + (m.get(id) ?? 0), 0);
      groups.push({
        id: team.id,
        name: team.name,
        type: 'team',
        seconds: sum(curBy),
        previousSeconds: sum(prevBy),
        overtimeSeconds: members.reduce((s, id) => s + otOf(ot, id), 0),
        previousOvertimeSeconds: members.reduce((s, id) => s + otOf(prevOt, id), 0),
        approvedSeconds: 0,
      });
    }
  }

  let approvedSeconds: number | null = null;
  if (has(x, 'timesheets:read') && has(x, 'reports:read')) {
    // Time inside the period that sits on an approved timesheet (a sheet can run past the period's edges).
    const report = await runReport(x, 'timesheet-approval', { from: period.from, to: period.to, billable: 'all', status: 'APPROVED' });
    const approved = report.rows.map((r) => ({ m: String(r.membership_id), start: String(r.period_start), end: String(r.period_end) }));
    approvedSeconds = cur.filter((r) => approved.some((a) => a.m === r.membership_id && r.date >= a.start && r.date <= a.end)).reduce((s2, r) => s2 + r.seconds, 0);
  }
  const pending = has(x, 'timesheets:approve') ? (await pageApprovalQueue(x, { page: 1, pageSize: 1 })).total : 0;
  const names = await memberNames(x);
  const missing = (await missingTimesheets(x, period, today, names))?.length ?? 0;

  let timeOff = { peopleAway: 0, pendingRequests: 0 };
  if (has(x, 'time_off:read')) {
    const reqs = await listTimeOffRequests(x, { from: period.from, to: period.to });
    const away = new Set(reqs.filter((q) => q.status === 'APPROVED').map((q) => q.membership_id));
    timeOff = { peopleAway: away.size, pendingRequests: reqs.filter((q) => q.status === 'PENDING').length };
  }

  return {
    totals: {
      seconds: total(curBy),
      previousSeconds: total(prevBy),
      approvedSeconds,
      overtimeSeconds: ids.reduce((s, id) => s + otOf(ot, id), 0),
      previousOvertimeSeconds: ids.reduce((s, id) => s + otOf(prevOt, id), 0),
    },
    groups,
    pending,
    missing,
    timeOff,
  };
}

export async function timesheetInputs(x: Ctx, period: Period, previous: Period, today: string) {
  const names = await memberNames(x);
  const nameOf = (id: string) => names.get(id)?.name ?? 'A member';
  const limitations: string[] = [];
  let entries: EntrySpan[] = [];
  if (has(x, 'time:read')) {
    const rows = await listTimeEntries(x, period);
    if (rows.length >= ENTRY_LIMIT) limitations.push(`Only the first ${ENTRY_LIMIT} entries were checked for overlaps; choose a shorter period.`);
    entries = rows.map((e) => ({ id: e.id, membershipId: e.membership_id, memberName: nameOf(e.membership_id), projectId: e.project_id, start: e.started_at, end: e.ended_at, source: e.source }));
  } else limitations.push('Overlap checks need access to time entries.');

  let sheets: SheetSummary[] = [];
  if (has(x, 'timesheets:approve')) {
    const queue = (await approvalQueue(x, {})).filter((s) => s.period_start <= period.to && s.period_end >= period.from);
    // Each sheet is compared with the same member's previous pay period (not the whole previous range).
    const prevByPeriod = new Map<string, Map<string, number>>();
    if (has(x, 'time:read')) {
      for (const start of new Set(queue.map((s2) => s2.period_start))) {
        const p = previousPayPeriod(start, x.org.payPeriod, x.org.weekStart);
        prevByPeriod.set(start, sumBy(await timeEntryTotals(x, { from: p.start, to: p.end }), (r) => r.membership_id, (r) => r.seconds));
      }
    }
    sheets = queue.map((s) => ({
      timesheetId: s.timesheet_id,
      membershipId: s.membership_id,
      memberName: s.worker_name,
      periodStart: s.period_start,
      status: s.status,
      totalSeconds: s.total_seconds,
      manualSeconds: s.manual_seconds,
      previousTotalSeconds: prevByPeriod.get(s.period_start)?.get(s.membership_id) ?? null,
      flags: s.flags,
    }));
  } else limitations.push('Timesheets waiting for approval are shown to people who approve them.');

  const missing = await missingTimesheets(x, period, today, names);
  if (missing === null) limitations.push('Missing timesheets need access to members, timesheets and reports.');
  return { entries, sheets, missing: missing ?? [], limitations, dayOf: (iso: string) => localDate(new Date(iso), x.org.timezone) };
}

export async function projectInputs(x: Ctx, period: Period, previous: Period, today: string): Promise<{ projects: ProjectFacts[]; limitations: string[] }> {
  const limitations: string[] = [];
  let projects = await listProjects(x);
  if (projects.length > MAX_PROJECTS) {
    limitations.push(`Only the first ${MAX_PROJECTS} projects were analysed.`);
    projects = projects.slice(0, MAX_PROJECTS);
  }
  const budgets = new Map<string, ProjectFacts['budget']>();
  if (has(x, 'budgets:read')) {
    for (const b of await listBudgets(x)) {
      if (b.subject_type !== 'PROJECT') continue;
      budgets.set(b.subject_id, { kind: b.kind, pctUsed: b.pct_used, state: b.state, projectedPct: b.projected !== null && b.amount > 0 ? Math.round((b.projected / b.amount) * 100) : null });
    }
  } else limitations.push('Budget checks need access to budgets.');

  const in14 = addDaysToDate(today, 14);
  const tasks = has(x, 'tasks:read') ? await listTasks(x, {}) : [];
  if (!has(x, 'tasks:read')) limitations.push('Task checks need access to tasks.');

  let hoursNow = new Map<string, number>();
  let hoursBefore = new Map<string, number>();
  if (has(x, 'time:read')) {
    [hoursNow, hoursBefore] = await Promise.all([timeEntryTotalsByProject(x, period), timeEntryTotalsByProject(x, previous)]);
  }
  const h = (s: number) => Math.round(s / 36) / 100;

  const out: ProjectFacts[] = [];
  for (const p of projects) {
    const mine = tasks.filter((t) => t.project_id === p.id);
    const open = mine.filter((t) => t.status !== 'DONE');
    const milestones = await listMilestones(x, p.id);
    const nextMs = milestones.filter((m) => !m.completed_at && m.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    out.push({
      id: p.id,
      name: p.name,
      budget: budgets.get(p.id) ?? null,
      tasks: {
        open: open.length,
        overdue: open.filter((t) => t.due_date && t.due_date < today).length,
        dueNext14: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in14).length,
        done: mine.length - open.length,
      },
      milestones: {
        late: milestones.filter((m) => m.on_time === false).length,
        overdue: milestones.filter((m) => !m.completed_at && m.due_date < today).length,
        next: nextMs ? { name: nextMs.title, due: nextMs.due_date } : null,
      },
      hoursThisPeriod: h(hoursNow.get(p.id) ?? 0),
      hoursPreviousPeriod: has(x, 'time:read') ? h(hoursBefore.get(p.id) ?? 0) : null,
    });
  }
  return { projects: out, limitations };
}

/** Flags from the approval queue that count as "something to check". Never activity (monitoring data). */
const CONCERN_FLAGS = new Set(['high_manual', 'under_expected', 'over_expected', 'late_time', 'needs_review']);
const APPROVE_PERMS = ['timesheets:approve', 'manual_time:approve', 'time_off:approve', 'expenses:approve'] as const;

/** Average days from submission to decision for timesheets decided in [from..to]; null when none were. */
async function averageDecisionDays(x: Ctx, p: Period): Promise<number | null> {
  const r = await runReport(x, 'timesheet-approval', { from: p.from, to: p.to, billable: 'all' });
  const days = r.rows
    .filter((row) => (row.status === 'APPROVED' || row.status === 'REJECTED') && row.submitted_at && row.decided_at && String(row.decided_at).slice(0, 10) >= p.from && String(row.decided_at).slice(0, 10) <= p.to)
    .map((row) => (Date.parse(String(row.decided_at)) - Date.parse(String(row.submitted_at))) / 86_400_000);
  if (!days.length) return null;
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

/**
 * What waits for this person's decision, within what they may decide (never their own requests),
 * and how quickly timesheets get decided.
 */
export async function workflowInputs(x: Ctx, period: Period, previous: Period, today: string) {
  const limitations: string[] = [];
  const waiting: Array<{ kind: 'timesheet' | 'manual_time' | 'time_off' | 'expense'; id: string; memberName: string; submittedOn: string; concerns: number }> = [];
  if (!APPROVE_PERMS.some((p) => has(x, p))) {
    limitations.push('Workflow insights are for people who approve timesheets, time off or expenses.');
    return { waiting, decisionDays: { current: null, previous: null }, limitations };
  }
  const mine = (id: string) => id === x.actor.membershipId;
  const dayOf = (iso: string | null | undefined) => (iso ? localDate(new Date(iso), x.org.timezone) : today);
  if (has(x, 'timesheets:approve')) {
    for (const s of await approvalQueue(x, {})) {
      if (s.status !== 'SUBMITTED' || mine(s.membership_id)) continue;
      waiting.push({ kind: 'timesheet', id: s.timesheet_id, memberName: s.worker_name, submittedOn: dayOf(s.submitted_at), concerns: s.flags.filter((f) => CONCERN_FLAGS.has(f)).length });
    }
  }
  if (has(x, 'manual_time:approve')) {
    for (const r of await listManualTime(x, { status: 'PENDING' })) {
      if (mine(r.membership_id) || !canSeeMembership(x.actor, 'manual_time:approve', r.membership_id)) continue;
      waiting.push({ kind: 'manual_time', id: r.id, memberName: r.worker_name, submittedOn: dayOf(r.created_at), concerns: 0 });
    }
  }
  if (has(x, 'time_off:approve')) {
    for (const r of await listTimeOffRequests(x, { status: 'PENDING' })) {
      if (mine(r.membership_id) || !canSeeMembership(x.actor, 'time_off:approve', r.membership_id)) continue;
      waiting.push({ kind: 'time_off', id: r.id, memberName: r.worker_name, submittedOn: dayOf(r.created_at), concerns: 0 });
    }
  }
  if (has(x, 'expenses:approve')) {
    for (const e of await listExpenses(x, { status: 'SUBMITTED' })) {
      if (mine(e.membership_id) || !canSeeMembership(x.actor, 'expenses:approve', e.membership_id)) continue;
      waiting.push({ kind: 'expense', id: e.id, memberName: e.worker_name, submittedOn: dayOf(e.created_at), concerns: 0 });
    }
  }
  let decisionDays: { current: number | null; previous: number | null } = { current: null, previous: null };
  if (has(x, 'timesheets:read') && has(x, 'reports:read')) decisionDays = { current: await averageDecisionDays(x, period), previous: await averageDecisionDays(x, previous) };
  else limitations.push('Decision times need access to timesheets and reports.');
  return { waiting, decisionDays, limitations };
}
