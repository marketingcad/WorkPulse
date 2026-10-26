import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditLogs,
  billingEntries,
  clients,
  holidays,
  memberships,
  overtimeRuleSets,
  projects,
  rollupWorkerDay,
  tasks,
  teamMembers,
  timeOffPolicies,
  timeOffRequests,
  timeSegments,
  timesheets,
  trackingSessions,
  users,
} from '@tallywork/db';
import { DEFAULT_OVERTIME, addDaysToDate, dayOfWeek, eachDate, forbidden, notFound, startOfLocalDay, startOfWeek, type Permission } from '@tallywork/domain';
import type { reportQueryInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { narrowMemberships } from './scope';
import { memberNames } from './timer';
import { overtimeInRange, paidHolidayHours, priceEntries } from './pay-figures';
import { listAttendance } from './operations';
import { amountsOwed, listBudgets, listExpenses, listInvoices, listPayments } from './finance';
import { listManualTime } from './timesheets';
import { usage } from './activity';
import { listTimeOffRequests } from './operations';
import { localDate } from '@tallywork/domain';

export type ColumnType = 'text' | 'duration' | 'money' | 'percent' | 'date' | 'datetime' | 'number' | 'status';
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
export interface ReportResult {
  columns: Column[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, number>;
  summary: Array<{ label: string; value: number | string; type: ColumnType }>;
  chart?: { type: 'bar' | 'stacked-bar' | 'line'; x: string; series: Array<{ key: string; label: string }>; data: Array<Record<string, string | number>> };
  currency?: string;
}

export type ReportParams = z.infer<typeof reportQueryInput>;

export type ReportFilter = 'dates' | 'members' | 'teams' | 'projects' | 'clients' | 'billable';
const ALL_FILTERS: ReportFilter[] = ['dates', 'members', 'teams', 'projects', 'clients', 'billable'];

export interface ReportDefinition {
  key: string;
  title: string;
  question: string;
  category: 'Time' | 'Activity' | 'People' | 'Finance' | 'Compliance';
  permission: Permission;
  /** The data permission the report is scoped by (any of). Listed only when the viewer holds one, so it never 403s on run. */
  requires?: Permission[];
  /** Filters the report actually applies; the runner shows only these. Defaults to all. */
  filters?: ReportFilter[];
  /** Kept for saved and scheduled reports, but not offered in the catalogue (another report covers it). */
  hidden?: boolean;
  groupings?: string[];
  run(x: Ctx, p: ReportParams): Promise<ReportResult>;
}

async function scopedMembers(x: Ctx, permission: Permission, p: ReportParams): Promise<string[] | 'all'> {
  let requested = p.membership_ids;
  if (p.team_ids?.length) {
    const ids = (await x.tx.select({ id: teamMembers.membershipId }).from(teamMembers).where(inArray(teamMembers.teamId, p.team_ids))).map((r) => r.id);
    requested = requested?.length ? requested.filter((r) => ids.includes(r)) : ids;
    if (!requested.length) requested = ['00000000-0000-7000-8000-000000000000'];
  }
  return narrowMemberships(x.actor, permission, requested);
}

const inOrAll = (col: Parameters<typeof inArray>[0], v: string[] | 'all') => (v === 'all' ? undefined : inArray(col, v.length ? v : ['00000000-0000-7000-8000-000000000000']));

async function rollupRows(x: Ctx, p: ReportParams, permission: Permission = 'time:read') {
  const members = await scopedMembers(x, permission, p);
  let projectIds = p.project_ids;
  if (p.client_ids?.length) {
    const ids = (await x.tx.select({ id: projects.id }).from(projects).where(inArray(projects.clientId, p.client_ids))).map((r) => r.id);
    projectIds = projectIds?.length ? projectIds.filter((id) => ids.includes(id)) : ids;
  }
  return x.tx
    .select({ r: rollupWorkerDay, projectName: projects.name, clientId: projects.clientId, clientName: clients.name })
    .from(rollupWorkerDay)
    .innerJoin(projects, eq(projects.id, rollupWorkerDay.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        gte(rollupWorkerDay.localDate, p.from),
        lte(rollupWorkerDay.localDate, p.to),
        inOrAll(rollupWorkerDay.membershipId, members),
        projectIds ? inArray(rollupWorkerDay.projectId, projectIds.length ? projectIds : ['00000000-0000-7000-8000-000000000000']) : undefined,
        p.billable === 'billable' ? eq(rollupWorkerDay.billable, true) : p.billable === 'non_billable' ? eq(rollupWorkerDay.billable, false) : undefined,
      ),
    );
}

const GROUP_LABEL: Record<string, string> = { worker: 'Member', project: 'Project', task: 'Task', client: 'Client', date: 'Date', week: 'Week' };

async function timeAndActivity(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await rollupRows(x, p);
  const groupBy = (p.group_by?.length ? p.group_by : ['worker', 'project']).filter((g) => g in GROUP_LABEL).slice(0, 3);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.r.membershipId))]);
  const taskIds = [...new Set(rows.map((r) => r.r.taskKey).filter(Boolean))];
  const taskNames = new Map((taskIds.length ? await x.tx.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds)) : []).map((t) => [t.id, t.title]));
  const weekStart = x.org.weekStart;
  const label = (g: string, r: (typeof rows)[number]) =>
    g === 'worker' ? (names.get(r.r.membershipId) ?? '') : g === 'project' ? r.projectName : g === 'task' ? (r.r.taskKey ? (taskNames.get(r.r.taskKey) ?? '') : '(no task)') : g === 'client' ? (r.clientName ?? '(no client)') : g === 'week' ? startOfWeek(r.r.localDate, weekStart) : r.r.localDate;
  interface Agg {
    labels: Record<string, string>;
    t: number;
    m: number;
    a: number;
    at: number;
    b: number;
  }
  const agg = new Map<string, Agg>();
  for (const r of rows) {
    const key = groupBy.map((g) => label(g, r)).join('\u0000');
    let a = agg.get(key);
    if (!a) {
      a = { labels: Object.fromEntries(groupBy.map((g) => [g, label(g, r)])), t: 0, m: 0, a: 0, at: 0, b: 0 };
      agg.set(key, a);
    }
    a.t += r.r.trackedSeconds;
    a.m += r.r.manualSeconds;
    a.a += r.r.activeSeconds;
    a.at += r.r.activityTrackedSeconds;
    if (r.r.billable) a.b += r.r.trackedSeconds + r.r.manualSeconds;
  }
  const out: Array<Record<string, string | number | null>> = [...agg.values()].map((a) => ({
    ...a.labels,
    tracked: a.t,
    manual: a.m,
    total: a.t + a.m,
    billable: a.b,
    activity: a.at > 0 ? Math.round((a.a / a.at) * 100) : null,
  }));
  out.sort((a, b) => groupBy.map((g) => String(a[g] ?? '')).join('|').localeCompare(groupBy.map((g) => String(b[g] ?? '')).join('|')));
  const tot = (k: 'tracked' | 'manual' | 'total' | 'billable') => out.reduce((s, r) => s + (r[k] as number), 0);
  const act = rows.reduce((s, r) => s + r.r.activeSeconds, 0);
  const actT = rows.reduce((s, r) => s + r.r.activityTrackedSeconds, 0);
  // Chart: hours per day stacked by first grouping dimension (top 6).
  const byDay = new Map<string, Record<string, number>>();
  const seriesTotals = new Map<string, number>();
  const seriesDim = groupBy.find((g) => g !== 'date') ?? 'project';
  for (const r of rows) {
    const s = label(seriesDim, r);
    const d = byDay.get(r.r.localDate) ?? {};
    d[s] = (d[s] ?? 0) + r.r.trackedSeconds + r.r.manualSeconds;
    byDay.set(r.r.localDate, d);
    seriesTotals.set(s, (seriesTotals.get(s) ?? 0) + r.r.trackedSeconds + r.r.manualSeconds);
  }
  const top = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  const dates = eachDate(p.from, p.to);
  return {
    columns: [...groupBy.map((g) => ({ key: g, label: GROUP_LABEL[g]!, type: (g === 'date' || g === 'week' ? 'date' : 'text') as ColumnType })), { key: 'tracked', label: 'Tracked', type: 'duration' }, { key: 'manual', label: 'Manual', type: 'duration' }, { key: 'total', label: 'Total', type: 'duration' }, { key: 'billable', label: 'Billable', type: 'duration' }, { key: 'activity', label: 'Activity', type: 'percent' }],
    rows: out,
    totals: { tracked: tot('tracked'), manual: tot('manual'), total: tot('total'), billable: tot('billable') },
    summary: [
      { label: 'Total time', value: tot('total'), type: 'duration' },
      { label: 'Billable', value: tot('billable'), type: 'duration' },
      { label: 'Manual', value: tot('manual'), type: 'duration' },
      { label: 'Avg activity', value: actT > 0 ? Math.round((act / actT) * 100) : 0, type: 'percent' },
    ],
    chart: dates.length <= 62 ? { type: 'stacked-bar', x: 'date', series: [...top.map((t) => ({ key: t, label: t })), ...(seriesTotals.size > 6 ? [{ key: 'Other', label: 'Other' }] : [])], data: dates.map((d) => {
      const v = byDay.get(d) ?? {};
      const row: Record<string, string | number> = { date: d };
      let other = 0;
      for (const [k, s] of Object.entries(v)) if (top.includes(k)) row[k] = s; else other += s;
      if (seriesTotals.size > 6) row.Other = other;
      return row;
    }) } : undefined,
  };
}

async function dailyTotals(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await rollupRows(x, p);
  const dates = eachDate(p.from, p.to).slice(0, 62);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.r.membershipId))]);
  const byWorker = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const w = byWorker.get(r.r.membershipId) ?? {};
    w[r.r.localDate] = (w[r.r.localDate] ?? 0) + r.r.trackedSeconds + r.r.manualSeconds;
    byWorker.set(r.r.membershipId, w);
  }
  const out = [...byWorker.entries()].map(([m, d]) => ({ worker: names.get(m) ?? '', ...Object.fromEntries(dates.map((dt) => [dt, d[dt] ?? 0])), total: Object.values(d).reduce((s, v) => s + v, 0) })).sort((a, b) => String(a.worker).localeCompare(String(b.worker)));
  const totals: Record<string, number> = { total: out.reduce((s, r) => s + r.total, 0) };
  for (const d of dates) totals[d] = out.reduce((s, r) => s + ((r as Record<string, unknown>)[d] as number), 0);
  return {
    columns: [{ key: 'worker', label: 'Member', type: 'text' }, ...dates.map((d) => ({ key: d, label: d.slice(5), type: 'duration' as ColumnType })), { key: 'total', label: 'Total', type: 'duration' }],
    rows: out,
    totals,
    summary: [{ label: 'Total time', value: totals.total!, type: 'duration' }, { label: 'Members', value: out.length, type: 'number' }, { label: 'Avg per member', value: out.length ? Math.round(totals.total! / out.length) : 0, type: 'duration' }],
  };
}

async function workSessions(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'tracking:read', p);
  const from = startOfLocalDay(p.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(p.to, 1), x.org.timezone);
  const ss = await x.tx
    .select({ s: trackingSessions, projectName: projects.name, taskTitle: tasks.title })
    .from(trackingSessions)
    .innerJoin(projects, eq(projects.id, trackingSessions.projectId))
    .leftJoin(tasks, eq(tasks.id, trackingSessions.taskId))
    .where(and(gte(trackingSessions.startedAt, from), sql`${trackingSessions.startedAt} < ${to}`, inOrAll(trackingSessions.membershipId, members), p.project_ids?.length ? inArray(trackingSessions.projectId, p.project_ids) : undefined))
    .orderBy(desc(trackingSessions.startedAt))
    .limit(5000);
  const segs = ss.length ? await x.tx.select().from(timeSegments).where(and(inArray(timeSegments.sessionId, ss.map((s) => s.s.id)))) : [];
  const names = await memberNames(x, [...new Set(ss.map((s) => s.s.membershipId))]);
  const now = x.deps.now();
  const out = ss.map(({ s, projectName, taskTitle }) => {
    const mine = segs.filter((g) => g.sessionId === s.id);
    const dur = (k: string) => mine.filter((g) => g.kind === k).reduce((t, g) => t + Math.round(((g.endedAt ?? now).getTime() - g.startedAt.getTime()) / 1000), 0);
    return { worker: names.get(s.membershipId) ?? '', project: projectName, task: taskTitle ?? '', source: s.source, started_at: s.startedAt.toISOString(), ended_at: s.endedAt?.toISOString() ?? null, worked: dur('WORK'), idle: dur('IDLE'), breaks: dur('BREAK'), state: s.state, end_reason: s.endReason ?? '' };
  });
  return {
    columns: [
      { key: 'worker', label: 'Member', type: 'text' },
      { key: 'project', label: 'Project', type: 'text' },
      { key: 'task', label: 'Task', type: 'text' },
      { key: 'source', label: 'Source', type: 'status' },
      { key: 'started_at', label: 'Start', type: 'datetime' },
      { key: 'ended_at', label: 'End', type: 'datetime' },
      { key: 'worked', label: 'Worked', type: 'duration' },
      { key: 'idle', label: 'Idle', type: 'duration' },
      { key: 'breaks', label: 'Breaks', type: 'duration' },
      { key: 'end_reason', label: 'Ended by', type: 'status' },
    ],
    rows: out,
    totals: { worked: out.reduce((s, r) => s + r.worked, 0), idle: out.reduce((s, r) => s + r.idle, 0), breaks: out.reduce((s, r) => s + r.breaks, 0) },
    summary: [{ label: 'Sessions', value: out.length, type: 'number' }, { label: 'Worked', value: out.reduce((s, r) => s + r.worked, 0), type: 'duration' }, { label: 'Idle', value: out.reduce((s, r) => s + r.idle, 0), type: 'duration' }],
  };
}

async function workBreaks(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const r = await workSessions(x, p);
  const rows = r.rows.filter((row) => (row.breaks as number) > 0 || (row.idle as number) > 0).map((row) => ({ worker: row.worker ?? null, started_at: row.started_at ?? null, project: row.project ?? null, breaks: row.breaks ?? 0, idle: row.idle ?? 0 }));
  return {
    columns: [{ key: 'worker', label: 'Member', type: 'text' }, { key: 'started_at', label: 'Session start', type: 'datetime' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'breaks', label: 'Breaks', type: 'duration' }, { key: 'idle', label: 'Idle', type: 'duration' }],
    rows,
    totals: { breaks: rows.reduce((s, x2) => s + (x2.breaks as number), 0), idle: rows.reduce((s, x2) => s + (x2.idle as number), 0) },
    summary: [{ label: 'Total breaks', value: rows.reduce((s, x2) => s + (x2.breaks as number), 0), type: 'duration' }, { label: 'Total idle', value: rows.reduce((s, x2) => s + (x2.idle as number), 0), type: 'duration' }],
  };
}

async function appsUrls(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'apps:read', p);
  const q = { from: p.from, to: p.to, membershipIds: members === 'all' ? undefined : members, groupBy: 'name' as const };
  const apps = (await usage(x, 'APP', q)) as Array<{ name: string; seconds: number; pct: number; workers: number }>;
  const urls = (await usage(x, 'URL', q)) as Array<{ name: string; seconds: number; pct: number; workers: number }>;
  const rows = [...apps.map((a) => ({ type: 'App', ...a })), ...urls.map((u) => ({ type: 'URL', ...u }))].sort((a, b) => b.seconds - a.seconds);
  return {
    columns: [{ key: 'type', label: 'Type', type: 'status' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'seconds', label: 'Time', type: 'duration' }, { key: 'pct', label: 'Share', type: 'percent' }, { key: 'workers', label: 'Members', type: 'number' }],
    rows,
    summary: [{ label: 'Apps', value: apps.length, type: 'number' }, { label: 'Sites', value: urls.length, type: 'number' }, { label: 'Top app', value: apps[0]?.name ?? '—', type: 'text' }],
    chart: { type: 'bar', x: 'name', series: [{ key: 'seconds', label: 'Time' }], data: apps.slice(0, 10).map((a) => ({ name: a.name, seconds: a.seconds })) },
  };
}

async function manualTimeReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'time:read', p);
  const rows = (await listManualTime(x, { membershipIds: members === 'all' ? undefined : members, status: p.status })).filter((r) => r.started_at.slice(0, 10) >= p.from && r.started_at.slice(0, 10) <= p.to);
  return {
    columns: [{ key: 'worker_name', label: 'Member', type: 'text' }, { key: 'project_name', label: 'Project', type: 'text' }, { key: 'started_at', label: 'Start', type: 'datetime' }, { key: 'ended_at', label: 'End', type: 'datetime' }, { key: 'duration_seconds', label: 'Duration', type: 'duration' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'status', label: 'Status', type: 'status' }],
    rows: rows.map((r) => ({ ...r })) as ReportResult['rows'],
    totals: { duration_seconds: rows.reduce((s, r) => s + r.duration_seconds, 0) },
    summary: [{ label: 'Requests', value: rows.length, type: 'number' }, { label: 'Manual time', value: rows.reduce((s, r) => s + r.duration_seconds, 0), type: 'duration' }, { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length, type: 'number' }],
  };
}

async function timesheetApproval(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'timesheets:read', p);
  const rows = await x.tx.select().from(timesheets).where(and(gte(timesheets.periodEnd, p.from), lte(timesheets.periodStart, p.to), inOrAll(timesheets.membershipId, members), p.status ? eq(timesheets.status, p.status as 'DRAFT') : undefined)).orderBy(desc(timesheets.periodStart));
  const names = await memberNames(x, [...new Set(rows.flatMap((r) => [r.membershipId, ...(r.decidedBy ? [r.decidedBy] : [])]))]);
  const out = rows.map((r) => ({ worker: names.get(r.membershipId) ?? '', period_start: r.periodStart, period_end: r.periodEnd, status: r.status, total: r.totalSeconds, manual: r.manualSeconds, submitted_at: r.submittedAt?.toISOString() ?? null, decided_by: r.decidedBy ? (names.get(r.decidedBy) ?? '') : '', decided_at: r.decidedAt?.toISOString() ?? null }));
  return {
    columns: [{ key: 'worker', label: 'Member', type: 'text' }, { key: 'period_start', label: 'Period start', type: 'date' }, { key: 'period_end', label: 'Period end', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'total', label: 'Total', type: 'duration' }, { key: 'manual', label: 'Manual', type: 'duration' }, { key: 'submitted_at', label: 'Submitted', type: 'datetime' }, { key: 'decided_by', label: 'Decided by', type: 'text' }, { key: 'decided_at', label: 'Decided', type: 'datetime' }],
    rows: out,
    summary: ['SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => ({ label: s[0] + s.slice(1).toLowerCase(), value: out.filter((r) => r.status === s).length, type: 'number' as ColumnType })),
  };
}

async function expensesReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await listExpenses(x, { from: p.from, to: p.to, status: p.status }, null);
  return {
    columns: [{ key: 'spent_on', label: 'Date', type: 'date' }, { key: 'worker_name', label: 'Member', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'project_name', label: 'Project', type: 'text' }, { key: 'client_name', label: 'Client', type: 'text' }, { key: 'amount_minor', label: 'Amount', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }],
    rows: rows as unknown as ReportResult['rows'],
    totals: { amount_minor: rows.reduce((s, r) => s + r.amount_minor, 0) },
    summary: [{ label: 'Expenses', value: rows.length, type: 'number' }, { label: 'Total', value: rows.reduce((s, r) => s + r.amount_minor, 0), type: 'money' }, { label: 'Billable', value: rows.filter((r) => r.billable).reduce((s, r) => s + r.amount_minor, 0), type: 'money' }],
    currency: x.org.currency,
  };
}

async function amountsOwedReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await amountsOwed(x, p.from, p.to);
  return {
    columns: [{ key: 'worker_name', label: 'Member', type: 'text' }, { key: 'tracked_seconds', label: 'Tracked', type: 'duration' }, { key: 'approved_seconds', label: 'Approved', type: 'duration' }, { key: 'estimated_amount_minor', label: 'Owed (estimate)', type: 'money' }, { key: 'approved_amount_minor', label: 'Owed (approved)', type: 'money' }],
    rows: rows as unknown as ReportResult['rows'],
    totals: { tracked_seconds: rows.reduce((s, r) => s + r.tracked_seconds, 0), approved_seconds: rows.reduce((s, r) => s + r.approved_seconds, 0), estimated_amount_minor: rows.reduce((s, r) => s + r.estimated_amount_minor, 0), approved_amount_minor: rows.reduce((s, r) => s + r.approved_amount_minor, 0) },
    summary: [{ label: 'Estimated', value: rows.reduce((s, r) => s + r.estimated_amount_minor, 0), type: 'money' }, { label: 'Approved', value: rows.reduce((s, r) => s + r.approved_amount_minor, 0), type: 'money' }],
    currency: x.org.currency,
  };
}

async function paymentsReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await listPayments(x, { from: p.from, to: p.to }, null);
  return {
    columns: [{ key: 'received_on', label: 'Date', type: 'date' }, { key: 'client_name', label: 'Client', type: 'text' }, { key: 'provider', label: 'Method', type: 'status' }, { key: 'provider_ref', label: 'Reference', type: 'text' }, { key: 'amount_minor', label: 'Amount', type: 'money' }],
    rows: rows.map(({ allocations: _a, ...r }) => r) as unknown as ReportResult['rows'],
    totals: { amount_minor: rows.reduce((s, r) => s + r.amount_minor, 0) },
    summary: [{ label: 'Payments', value: rows.length, type: 'number' }, { label: 'Received', value: rows.reduce((s, r) => s + r.amount_minor, 0), type: 'money' }],
    currency: x.org.currency,
  };
}

function budgetReport(kind: 'PROJECT' | 'CLIENT' | null) {
  return async (x: Ctx): Promise<ReportResult> => {
    // The same budgets the Budgets page shows this person (a team manager: their assigned projects).
    const rows = (await listBudgets(x)).filter((b) => !kind || b.subject_type === kind).map((b) => ({ ...b, subject: b.subject_type === 'PROJECT' ? 'Project' : 'Client', ...(b.amounts_hidden ? { amount: null, spent: null, remaining: null } : {}) }));
    return {
      columns: [{ key: 'subject_name', label: kind === 'PROJECT' ? 'Project' : kind === 'CLIENT' ? 'Client' : 'Budget for', type: 'text' }, ...(kind ? [] : [{ key: 'subject', label: 'Subject', type: 'status' as const }]), { key: 'kind', label: 'Type', type: 'status' }, { key: 'amount', label: 'Budget', type: 'number' }, { key: 'spent', label: 'Spent', type: 'number' }, { key: 'remaining', label: 'Remaining', type: 'number' }, { key: 'pct_used', label: 'Used', type: 'percent' }, { key: 'state', label: 'Status', type: 'status' }],
      rows: rows as unknown as ReportResult['rows'],
      summary: [{ label: 'Budgets', value: rows.length, type: 'number' }, { label: 'Warning', value: rows.filter((r) => r.state === 'warning').length, type: 'number' }, { label: 'Exceeded', value: rows.filter((r) => r.state === 'exceeded').length, type: 'number' }],
      currency: x.org.currency,
    };
  };
}

async function attendanceReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'attendance:read', p);
  const rows = await listAttendance(x, p.from, p.to, members === 'all' ? undefined : members);
  return {
    columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'worker_name', label: 'Member', type: 'text' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'scheduled_start', label: 'Scheduled', type: 'datetime' }, { key: 'first_in', label: 'First in', type: 'datetime' }, { key: 'last_out', label: 'Last out', type: 'datetime' }, { key: 'worked_seconds', label: 'Worked', type: 'duration' }, { key: 'late_seconds', label: 'Late by', type: 'duration' }, { key: 'overtime_seconds', label: 'Overtime', type: 'duration' }],
    rows: rows as unknown as ReportResult['rows'],
    summary: [{ label: 'Late', value: rows.filter((r) => r.status === 'LATE').length, type: 'number' }, { label: 'Absent', value: rows.filter((r) => r.status === 'ABSENT').length, type: 'number' }, { label: 'Overtime', value: rows.reduce((s, r) => s + r.overtime_seconds, 0), type: 'duration' }],
  };
}

async function timeOffReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const members = await scopedMembers(x, 'time_off:read', p);
  const rows = await listTimeOffRequests(x, { from: p.from, to: p.to, status: p.status, membershipIds: members === 'all' ? undefined : members });
  return {
    columns: [{ key: 'worker_name', label: 'Member', type: 'text' }, { key: 'policy_name', label: 'Policy', type: 'text' }, { key: 'start_date', label: 'From', type: 'date' }, { key: 'end_date', label: 'To', type: 'date' }, { key: 'hours', label: 'Hours', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }],
    rows: rows as unknown as ReportResult['rows'],
    totals: { hours: rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.hours, 0) },
    summary: [{ label: 'Requests', value: rows.length, type: 'number' }, { label: 'Approved hours', value: rows.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.hours, 0), type: 'number' }],
  };
}

/**
 * Billable time per client and project. Approved and invoiced amounts come from billing entries
 * (priced at approval and never repriced), so they reconcile exactly with invoices; time not yet
 * approved is estimated at current rates. The same member scope and filters apply to both.
 */
async function billingReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await rollupRows(x, { ...p, billable: 'billable' }, 'time:read');
  const members = await scopedMembers(x, 'time:read', p);
  let projectIds = p.project_ids;
  if (p.client_ids?.length) {
    const ids = (await x.tx.select({ id: projects.id }).from(projects).where(inArray(projects.clientId, p.client_ids))).map((r) => r.id);
    projectIds = projectIds?.length ? projectIds.filter((id) => ids.includes(id)) : ids;
  }
  const entries = await x.tx
    .select({ b: billingEntries, projectName: projects.name, clientName: clients.name })
    .from(billingEntries)
    .innerJoin(projects, eq(projects.id, billingEntries.projectId))
    .leftJoin(clients, eq(clients.id, billingEntries.clientId))
    .where(
      and(
        isNull(billingEntries.voidedAt),
        eq(billingEntries.billable, true),
        gte(billingEntries.localDate, p.from),
        lte(billingEntries.localDate, p.to),
        inOrAll(billingEntries.membershipId, members),
        // Approved time belongs to the client it was billed to, even if its project has moved since.
        p.project_ids?.length ? inArray(billingEntries.projectId, p.project_ids) : undefined,
        p.client_ids?.length ? inArray(billingEntries.clientId, p.client_ids) : undefined,
      ),
    );
  type Row = { client: string; project: string; seconds: number; approved_seconds: number; approved: number; invoiced: number; unapproved_estimate: number };
  const agg = new Map<string, Row>();
  // One row per project and client: a project that moved shows its approved work under the client it
  // was billed to, and its current work under its current client.
  const row = (projectId: string, clientId: string | null, client: string | null, project: string) => {
    const key = `${projectId}|${clientId ?? ''}`;
    let a = agg.get(key);
    if (!a) agg.set(key, (a = { client: client ?? '(no client)', project, seconds: 0, approved_seconds: 0, approved: 0, invoiced: 0, unapproved_estimate: 0 }));
    return a;
  };
  for (const { b, projectName, clientName } of entries) {
    const a = row(b.projectId, b.clientId, clientName, projectName);
    a.approved_seconds += b.seconds;
    a.approved += b.billAmountMinor;
    if (b.invoiceLineId) a.invoiced += b.billAmountMinor;
  }
  for (const r of rows) row(r.r.projectId, r.clientId, r.clientName, r.projectName).seconds += r.r.trackedSeconds + r.r.manualSeconds;
  // Time not approved yet, priced per entry as approving it now would (see priceEntries).
  for (const e of await priceEntries(x.tx, x.org.currency, p.from, p.to, members)) {
    if (e.approved || !e.billable || (projectIds && !projectIds.includes(e.projectId))) continue;
    const a = agg.get(`${e.projectId}|${e.clientId ?? ''}`);
    if (a) a.unapproved_estimate += e.billMinor;
  }
  const out = [...agg.values()].sort((a, b) => a.client.localeCompare(b.client) || a.project.localeCompare(b.project));
  const sum = (k: keyof Row) => out.reduce((s, r) => s + (r[k] as number), 0);
  return {
    columns: [
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'project', label: 'Project', type: 'text' },
      { key: 'seconds', label: 'Billable time', type: 'duration' },
      { key: 'approved_seconds', label: 'Approved time', type: 'duration' },
      { key: 'approved', label: 'Approved amount', type: 'money' },
      { key: 'invoiced', label: 'Invoiced', type: 'money' },
      { key: 'unapproved_estimate', label: 'Not yet approved (est.)', type: 'money' },
    ],
    rows: out,
    totals: { seconds: sum('seconds'), approved_seconds: sum('approved_seconds'), approved: sum('approved'), invoiced: sum('invoiced'), unapproved_estimate: sum('unapproved_estimate') },
    summary: [
      { label: 'Approved amount', value: sum('approved'), type: 'money' },
      { label: 'Invoiced', value: sum('invoiced'), type: 'money' },
      { label: 'Ready to invoice', value: sum('approved') - sum('invoiced'), type: 'money' },
    ],
    currency: x.org.currency,
  };
}

async function invoicesReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  // The whole date range, not only the newest 1000 invoices.
  const rows = await listInvoices(x, { status: p.status, from: p.from, to: p.to }, null);
  return {
    columns: [{ key: 'number', label: 'Invoice', type: 'text' }, { key: 'client_name', label: 'Client', type: 'text' }, { key: 'issue_date', label: 'Issued', type: 'date' }, { key: 'due_date', label: 'Due', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'total_minor', label: 'Total', type: 'money' }, { key: 'balance_minor', label: 'Balance', type: 'money' }],
    rows: rows as unknown as ReportResult['rows'],
    totals: { total_minor: rows.reduce((s, r) => s + r.total_minor, 0), balance_minor: rows.reduce((s, r) => s + r.balance_minor, 0) },
    summary: [{ label: 'Invoiced', value: rows.filter((r) => r.status !== 'VOID').reduce((s, r) => s + r.total_minor, 0), type: 'money' }, { label: 'Outstanding', value: rows.reduce((s, r) => s + r.balance_minor, 0), type: 'money' }, { label: 'Overdue', value: rows.filter((r) => r.status === 'OVERDUE').length, type: 'number' }],
    currency: x.org.currency,
  };
}

async function auditReport(x: Ctx, p: ReportParams): Promise<ReportResult> {
  if (!x.actor.grants['audit:read']) throw forbidden();
  const from = startOfLocalDay(p.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(p.to, 1), x.org.timezone);
  const rows = await x.tx.select().from(auditLogs).where(and(gte(auditLogs.createdAt, from), sql`${auditLogs.createdAt} < ${to}`)).orderBy(desc(auditLogs.createdAt)).limit(5000);
  const names = await memberNames(x, [...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!))]);
  return {
    columns: [{ key: 'created_at', label: 'When', type: 'datetime' }, { key: 'actor', label: 'Actor', type: 'text' }, { key: 'action', label: 'Action', type: 'status' }, { key: 'target', label: 'Target', type: 'text' }, { key: 'ip_address', label: 'IP', type: 'text' }],
    rows: rows.map((r) => ({ created_at: r.createdAt.toISOString(), actor: r.actorType === 'user' && r.actorId ? (names.get(r.actorId) ?? r.actorId) : `${r.actorType}${r.actorId ? `:${r.actorId.slice(0, 8)}` : ''}`, action: r.action, target: r.targetType ? `${r.targetType}${r.targetId ? `:${r.targetId.slice(0, 8)}` : ''}` : '', ip_address: r.ipAddress })),
    summary: [{ label: 'Events', value: rows.length, type: 'number' }],
  };
}

/**
 * Hours of an approved time-off request that fall inside [from, to]: the whole request when it
 * lies inside, otherwise its working days in the range (weekends and holidays excluded) at the
 * policy's hours per day, never more than the request itself.
 */
export function timeOffHoursInRange(t: { startDate: string; endDate: string; hours: number; halfDay: boolean }, from: string, to: string, hols: Set<string>, hoursPerDay: number): number {
  if (t.startDate >= from && t.endDate <= to) return t.hours;
  const days = eachDate(t.startDate > from ? t.startDate : from, t.endDate < to ? t.endDate : to).filter((d) => !hols.has(d) && ![0, 6].includes(dayOfWeek(d))).length;
  return Math.min(t.hours, days * hoursPerDay);
}

/** Payroll-ready export: regular/overtime, billable split, time off, earnings, approval status. */
async function payroll(x: Ctx, p: ReportParams): Promise<ReportResult> {
  const rows = await rollupRows(x, p, 'payroll:read');
  // Paid time off is paid without tracked time, so someone on leave all period is still listed
  // (time off has no project or client, so those filters leave it out).
  const scoped = await scopedMembers(x, 'payroll:read', p);
  const onLeave =
    p.project_ids?.length || p.client_ids?.length
      ? []
      : await x.tx
          .selectDistinct({ m: timeOffRequests.membershipId })
          .from(timeOffRequests)
          .innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId))
          .where(and(eq(timeOffRequests.status, 'APPROVED'), eq(timeOffPolicies.paid, true), lte(timeOffRequests.startDate, p.to), gte(timeOffRequests.endDate, p.from), scoped === 'all' ? undefined : inArray(timeOffRequests.membershipId, scoped.length ? scoped : ['00000000-0000-7000-8000-000000000000'])));
  const members = [...new Set([...rows.map((r) => r.r.membershipId), ...onLeave.map((r) => r.m)])];
  const names = await memberNames(x, members);
  const [ot] = await x.tx.select().from(overtimeRuleSets);
  const rules = ot?.rules ?? DEFAULT_OVERTIME;
  const split = await overtimeInRange(x.tx, x.org.weekStart, rules, members, p.from, p.to);
  const priced = await priceEntries(x.tx, x.org.currency, p.from, p.to, members);
  const holidayPay = await paidHolidayHours(x.tx, members, p.from, p.to);
  // Paid time off only, as a payroll run pays it (unpaid leave was counted here too).
  const timeOff = members.length ? (await x.tx.select({ t: timeOffRequests }).from(timeOffRequests).innerJoin(timeOffPolicies, eq(timeOffPolicies.id, timeOffRequests.policyId)).where(and(inArray(timeOffRequests.membershipId, members), eq(timeOffRequests.status, 'APPROVED'), eq(timeOffPolicies.paid, true), lte(timeOffRequests.startDate, p.to), gte(timeOffRequests.endDate, p.from)))).map((r) => r.t) : [];
  const hols = new Set((await x.tx.select({ d: holidays.date }).from(holidays).where(and(gte(holidays.date, p.from), lte(holidays.date, p.to)))).map((h) => h.d));
  const hoursPerDay = new Map((await x.tx.select({ id: timeOffPolicies.id, h: timeOffPolicies.hoursPerDay }).from(timeOffPolicies)).map((r) => [r.id, r.h]));
  const ts = members.length ? await x.tx.select().from(timesheets).where(and(inArray(timesheets.membershipId, members), gte(timesheets.periodEnd, p.from), lte(timesheets.periodStart, p.to))) : [];
  const out = members.map((m) => {
    const mine = rows.filter((r) => r.r.membershipId === m);
    // Overtime on whole weeks: a week split by the range keeps the overtime worked on its days here.
    const { regular, overtime } = split.get(m) ?? { regular: 0, overtime: 0 };
    const billable = mine.filter((r) => r.r.billable).reduce((s, r) => s + r.r.trackedSeconds + r.r.manualSeconds, 0);
    const total = mine.reduce((s, r) => s + r.r.trackedSeconds + r.r.manualSeconds, 0);
    const myPriced = priced.filter((e) => e.membershipId === m);
    // Approved pay is the official figure (what a payroll pays for this time); the estimate adds the
    // time not approved yet, priced per entry at today's rates.
    const approvedPay = myPriced.filter((e) => e.approved).reduce((s, e) => s + e.payMinor, 0);
    const earnings = myPriced.reduce((s, e) => s + e.payMinor, 0);
    const statuses = ts.filter((t) => t.membershipId === m).map((t) => t.status);
    return {
      worker: names.get(m) ?? '',
      regular,
      overtime,
      billable,
      non_billable: total - billable,
      // Paid time off, including paid holidays (as a payroll run pays them).
      time_off_hours:
        Math.round(
          (timeOff.filter((t) => t.membershipId === m).reduce((s, t) => s + timeOffHoursInRange(t, p.from, p.to, hols, hoursPerDay.get(t.policyId) ?? 8), 0) + (holidayPay.get(m) ?? []).reduce((s, h) => s + h.hours, 0)) * 100,
        ) / 100,
      approved_pay: approvedPay,
      earnings,
      approval: statuses.length === 0 ? 'NOT_SUBMITTED' : statuses.every((s) => s === 'APPROVED') ? 'APPROVED' : statuses.some((s) => s === 'SUBMITTED') ? 'PENDING' : 'PARTIAL',
    };
  });
  return {
    columns: [{ key: 'worker', label: 'Member', type: 'text' }, { key: 'regular', label: 'Regular', type: 'duration' }, { key: 'overtime', label: 'Overtime', type: 'duration' }, { key: 'billable', label: 'Billable', type: 'duration' }, { key: 'non_billable', label: 'Non-billable', type: 'duration' }, { key: 'time_off_hours', label: 'Time off (h)', type: 'number' }, { key: 'approved_pay', label: 'Approved pay', type: 'money' }, { key: 'earnings', label: 'Estimated earnings', type: 'money' }, { key: 'approval', label: 'Approval', type: 'status' }],
    rows: out.sort((a, b) => a.worker.localeCompare(b.worker)),
    totals: { regular: out.reduce((s, r) => s + r.regular, 0), overtime: out.reduce((s, r) => s + r.overtime, 0), approved_pay: out.reduce((s, r) => s + r.approved_pay, 0), earnings: out.reduce((s, r) => s + r.earnings, 0) },
    summary: [{ label: 'Regular', value: out.reduce((s, r) => s + r.regular, 0), type: 'duration' }, { label: 'Overtime', value: out.reduce((s, r) => s + r.overtime, 0), type: 'duration' }, { label: 'Approved pay', value: out.reduce((s, r) => s + r.approved_pay, 0), type: 'money' }, { label: 'Estimated earnings', value: out.reduce((s, r) => s + r.earnings, 0), type: 'money' }],
    currency: x.org.currency,
  };
}

// Hidden reports still run (saved and scheduled reports keep working) but are not offered in the
// catalogue: another report covers them, or the list page exports the same rows (Invoices, Payments
// received, Expenses, Budgets, Payroll › Owed).
export const REPORTS: ReportDefinition[] = [
  { key: 'time-activity', title: 'Time & Activity', question: 'Where did time go, and how active was it?', category: 'Time', permission: 'reports:read', groupings: ['worker', 'project', 'task', 'client', 'date', 'week'], requires: ['time:read'], run: timeAndActivity },
  { key: 'daily-totals', title: 'Daily Totals', question: 'How much did each person work each day?', category: 'Time', permission: 'reports:read', requires: ['time:read'], hidden: true, run: dailyTotals },
  { key: 'work-sessions', title: 'Work Sessions', question: 'When did people start and stop?', category: 'Time', permission: 'reports:read', requires: ['tracking:read'], filters: ['dates', 'members', 'teams', 'projects'], run: workSessions },
  { key: 'manual-time', title: 'Manual Time Edits', question: 'How much time was added manually, and why?', category: 'Time', permission: 'reports:read', requires: ['time:read'], filters: ['dates', 'members', 'teams'], run: manualTimeReport },
  { key: 'work-breaks', title: 'Work Breaks', question: 'How much break and idle time was taken?', category: 'Time', permission: 'reports:read', requires: ['tracking:read'], filters: ['dates', 'members', 'teams', 'projects'], hidden: true, run: workBreaks },
  { key: 'apps-urls', title: 'Apps & URLs', question: 'Which tools and sites were used?', category: 'Activity', permission: 'reports:read', requires: ['apps:read'], filters: ['dates', 'members', 'teams'], run: appsUrls },
  { key: 'timesheet-approval', title: 'Timesheet Approval', question: 'Which timesheets are approved or pending?', category: 'People', permission: 'reports:read', requires: ['timesheets:read'], filters: ['dates', 'members', 'teams'], run: timesheetApproval },
  { key: 'attendance', title: 'Attendance', question: 'Who was late, absent or in overtime?', category: 'People', permission: 'reports:read', requires: ['attendance:read'], filters: ['dates', 'members', 'teams'], run: attendanceReport },
  { key: 'time-off', title: 'Time Off', question: 'Who took time off and how much?', category: 'People', permission: 'reports:read', requires: ['time_off:read'], filters: ['dates', 'members', 'teams'], run: timeOffReport },
  { key: 'payroll', title: 'Payroll Export', question: 'What should payroll pay for this period?', category: 'Finance', permission: 'reports:finance', requires: ['payroll:read'], filters: ['dates', 'members', 'teams'], run: payroll },
  { key: 'amounts-owed', title: 'Amounts Owed', question: 'What do we owe each member?', category: 'Finance', permission: 'reports:finance', requires: ['billing:read', 'rates:read'], filters: ['dates'], hidden: true, run: amountsOwedReport },
  { key: 'billing', title: 'Billing', question: 'What is billable per client and project?', category: 'Finance', permission: 'reports:finance', requires: ['time:read'], filters: ['dates', 'members', 'teams', 'projects', 'clients'], run: billingReport },
  { key: 'invoices', title: 'Invoices', question: 'What has been invoiced and what is outstanding?', category: 'Finance', permission: 'reports:finance', requires: ['invoices:read'], filters: ['dates'], hidden: true, run: invoicesReport },
  { key: 'payments', title: 'Payments', question: 'What payments came in?', category: 'Finance', permission: 'reports:finance', requires: ['payments:read'], filters: ['dates'], hidden: true, run: paymentsReport },
  { key: 'expenses', title: 'Expenses', question: 'What was spent, and is it billable?', category: 'Finance', permission: 'reports:read', requires: ['expenses:read'], filters: ['dates'], hidden: true, run: expensesReport },
  { key: 'budgets', title: 'Budgets', question: 'Which projects and clients are near or over budget?', category: 'Finance', permission: 'reports:read', requires: ['budgets:read'], filters: [], hidden: true, run: budgetReport(null) },
  { key: 'project-budgets', title: 'Project Budgets', question: 'Which projects are near or over budget?', category: 'Finance', permission: 'reports:read', requires: ['budgets:read'], filters: [], hidden: true, run: budgetReport('PROJECT') },
  { key: 'client-budgets', title: 'Client Budgets', question: 'Which clients are near or over budget?', category: 'Finance', permission: 'reports:read', requires: ['budgets:read'], filters: [], hidden: true, run: budgetReport('CLIENT') },
  { key: 'audit-log', title: 'Audit Log', question: 'Who changed what, and when?', category: 'Compliance', permission: 'audit:read', filters: ['dates'], hidden: true, run: auditReport },
];

/** The report's own permission plus (when listed) one of the permissions its data needs, as on the matching page. */
export const mayRun = (x: Pick<Ctx, 'actor'>, r: ReportDefinition) => !!x.actor.grants[r.permission] && (!r.requires || r.requires.some((q) => x.actor.grants[q]));

export function reportCatalog(x: Ctx) {
  return REPORTS.filter((r) => mayRun(x, r)).map((r) => ({ key: r.key, title: r.title, question: r.question, category: r.category, groupings: r.groupings ?? [], filters: r.filters ?? ALL_FILTERS, hidden: !!r.hidden }));
}

export async function runReport(x: Ctx, key: string, params: ReportParams): Promise<ReportResult & { title: string; key: string }> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw notFound('report');
  if (!mayRun(x, def)) throw forbidden();
  const res = await def.run(x, params);
  return { ...res, title: def.title, key: def.key };
}

