import type { HelpArticle } from '@tallywork/domain/help';
import type { ApprovalQueueItemDto, BudgetStatusDto, LiveWorkerDto, ManualTimeDto, MemberOptionDto, ProjectDto, TeamDto } from '@tallywork/contracts';

/*
 * Output allowlists for the organization data tools. Each one builds a new object from the fields
 * the product owner allowed to reach the AI provider (names and aggregates): never emails, rates,
 * money the service removed, screenshots, activity, apps, URLs, reasons or review notes.
 */

const hrs = (seconds: number) => Math.round(seconds / 36) / 100;

/** Keep only the named fields; never spread a DTO into tool output. */
export function pick<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Output allowlist for the documentation tool: only these fields reach the model. */
export function redactArticle(a: HelpArticle, links: string[]) {
  return {
    title: a.title,
    summary: a.summary,
    steps: a.steps ?? [],
    points: a.points ?? [],
    tip: a.tip ?? null,
    links,
  };
}

/** getOrganizationOverview: organization name and time zone, and scoped counts. */
export function redactOverview(o: { name: string; timezone: string }, counts: { activeByRole: Record<string, number> | null; teams: number | null; projects: number | null }) {
  return { name: o.name, timezone: o.timezone, active_members_by_role: counts.activeByRole, team_count: counts.teams, project_count: counts.projects };
}

/** getEmployeeSummary: name, role name, status, title, tracking on/off, expected weekly hours. No email. */
export function redactEmployee(m: MemberOptionDto) {
  return {
    name: m.name,
    role: m.role_name,
    status: m.status,
    title: m.title,
    tracking: m.tracking_enabled,
    expected_weekly_hours: m.weekly_expected_seconds == null ? null : hrs(m.weekly_expected_seconds),
  };
}

/**
 * getLiveTrackingSummary: name, working or paused, project, task, and the session's age in minutes
 * (since it started, pauses included). No activity or device data.
 */
export function redactLiveWorker(w: LiveWorkerDto, now: Date) {
  const started = w.started_at ? Date.parse(w.started_at) : now.getTime();
  return {
    name: w.name,
    status: w.status === 'WORKING' ? 'working' : 'paused',
    project: w.project_name,
    task: w.task_title,
    session_age_minutes: Math.max(0, Math.floor((now.getTime() - started) / 60_000)),
  };
}

/** getHoursSummary: the group label (member name, date or project name) and its hours. */
export function redactHours(label: { member: string } | { date: string } | { project: string }, t: { seconds: number; billable: number; manual: number }) {
  const key = 'member' in label ? { member: label.member } : 'date' in label ? { date: label.date } : { project: label.project };
  return { ...key, hours: hrs(t.seconds), billable_hours: hrs(t.billable), manual_hours: hrs(t.manual) };
}

/** getPendingApprovals, timesheets queue: name and period. No totals, flags or activity. */
export function redactApprovalTimesheet(i: ApprovalQueueItemDto) {
  return { name: i.worker_name, period_start: i.period_start, period_end: i.period_end };
}

/** getPendingApprovals, manual time queue: name, local date and hours. No reason or note. */
export function redactApprovalManualTime(m: ManualTimeDto, localDate: string) {
  return { name: m.worker_name, date: localDate, hours: hrs(m.duration_seconds) };
}

/** getPendingApprovals, time-off queue: name, policy and dates. No reason. */
export function redactApprovalTimeOff(r: { worker_name: string; policy_name: string; start_date: string; end_date: string }) {
  return { name: r.worker_name, policy: r.policy_name, start_date: r.start_date, end_date: r.end_date };
}

export type TimesheetState = 'not_submitted' | 'draft' | 'submitted' | 'approved' | 'rejected';

/** getTimesheetStatus: name, period and status. No hours, decider or comments. */
export function redactTimesheetStatus(name: string, status: TimesheetState, period: { start: string; end: string } | null) {
  return { name, status, period_start: period?.start ?? null, period_end: period?.end ?? null };
}

/** getProjectSummary: name, client name, status, tracked hours. No rates or members. */
export function redactProject(p: ProjectDto) {
  return { name: p.name, client: p.client_name, status: p.status, tracked_hours: hrs(p.tracked_seconds ?? 0) };
}

/** Minor units (cents) to major units, as the rest of the codebase prints money (amount / 100). */
const major = (minor: number) => Math.round(minor) / 100;

/**
 * getProjectBudgetSummary: subject name, percent used and threshold state. Money only when the
 * service left it in (the actor holds billing:read or rates:read), in major units with its
 * currency (100000 = 100,000.00 USD) so the model never quotes cents as dollars. Hours budgets
 * carry no amounts.
 */
export function redactBudget(b: BudgetStatusDto) {
  const base = { name: b.subject_name, subject: b.subject_type === 'PROJECT' ? 'project' : 'client', kind: b.kind === 'MONEY' ? 'money' : 'hours', percent_used: b.pct_used, state: b.state };
  if (b.kind !== 'MONEY' || b.amounts_hidden) return base;
  return { ...base, amount: major(b.amount), spent: major(b.spent), remaining: major(b.remaining), currency: b.currency };
}

/** getTeamSummary: team name, manager names, member count. */
export function redactTeam(t: TeamDto) {
  return { name: t.name, managers: t.members.filter((m) => m.role === 'MANAGER').map((m) => m.name), member_count: t.members.length };
}

/** getTimeOffSummary: name, policy name, dates, status. Never the reason or decision comment. */
export function redactTimeOff(r: { worker_name: string; policy_name: string; start_date: string; end_date: string; half_day: boolean; status: string }) {
  return { name: r.worker_name, policy: r.policy_name, start_date: r.start_date, end_date: r.end_date, half_day: r.half_day, status: r.status };
}
