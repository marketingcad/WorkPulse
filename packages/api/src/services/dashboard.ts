import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  dashboardLayouts,
  devices,
  timeSegments,
  invoices,
  manualTimeRequests,
  memberships,
  rollupWorkerDay,
  taskAssignees,
  tasks,
  projects,
  timeOffRequests,
  timesheets,
  trackingSessions,
} from '@tallywork/db';
import { addDaysToDate, deriveInvoiceStatus, forbidden, localDate, splitAtLocalMidnight, startOfWeek } from '@tallywork/domain';
import type { dashboardLayoutInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { listScreenshots } from './activity';
import { budgetStatuses, redactBudgetMoney } from './finance';
import { listAttendance } from './operations';
import { effectivePolicy } from './policies';
import { insights } from './insights';
import { clientFilter, narrowMemberships } from './scope';
import { todayAndWeek, workerTimezone } from './tracking';
import { currentTracking, liveWorkers, listSessions } from './timer';
import { memberNames } from './timer';

export const WIDGETS = [
  'current_timer',
  'worked_today',
  'tracked_week',
  'active_workers',
  'activity',
  'hours_by_project',
  'timesheets_to_approve',
  'my_timesheet',
  'project_budgets',
  'recent_screenshots',
  'recent_sessions',
  'time_off_requests',
  'upcoming_time_off',
  'attendance_today',
  'invoices',
  'assigned_tasks',
  'weekly_limits',
  'devices_offline',
  'month_summary',
  'hours_by_client',
] as const;

type Size = 'S' | 'M' | 'L';

export function defaultLayout(x: Ctx, scope: 'ALL' | 'ME' | 'WORKER'): Array<{ key: string; size: Size }> {
  const g = x.actor.grants;
  if (scope === 'ME' || (!g['tracking:read'] || g['tracking:read'] === 'own')) {
    return [
      { key: 'current_timer', size: 'M' },
      { key: 'tracked_week', size: 'M' },
      { key: 'assigned_tasks', size: 'M' },
      { key: 'recent_sessions', size: 'M' },
      { key: 'my_timesheet', size: 'S' },
      { key: 'upcoming_time_off', size: 'S' },
      { key: 'activity', size: 'S' },
    ];
  }
  if (g['tracking:read'] === 'team') {
    return [
      { key: 'worked_today', size: 'L' },
      { key: 'active_workers', size: 'L' },
      { key: 'timesheets_to_approve', size: 'M' },
      { key: 'attendance_today', size: 'M' },
      { key: 'recent_screenshots', size: 'M' },
      { key: 'upcoming_time_off', size: 'M' },
    ];
  }
  return [
    { key: 'month_summary', size: 'L' },
    { key: 'worked_today', size: 'L' },
    { key: 'timesheets_to_approve', size: 'M' },
    { key: 'project_budgets', size: 'M' },
    { key: 'hours_by_project', size: 'M' },
    { key: 'hours_by_client', size: 'M' },
    { key: 'active_workers', size: 'M' },
    { key: 'invoices', size: 'M' },
    { key: 'time_off_requests', size: 'M' },
    { key: 'recent_screenshots', size: 'M' },
  ];
}

export async function getLayout(x: Ctx, scope: 'ALL' | 'ME' | 'WORKER') {
  const [row] = await x.tx.select().from(dashboardLayouts).where(and(eq(dashboardLayouts.membershipId, x.actor.membershipId), eq(dashboardLayouts.scope, scope)));
  return { scope, widgets: row?.widgets ?? defaultLayout(x, scope), customized: !!row, available: [...WIDGETS] };
}

export async function saveLayout(x: Ctx, input: z.infer<typeof dashboardLayoutInput>) {
  const widgets = input.widgets.filter((w) => (WIDGETS as readonly string[]).includes(w.key));
  await x.tx
    .insert(dashboardLayouts)
    .values({ organizationId: x.org.id, membershipId: x.actor.membershipId, scope: input.scope, widgets })
    .onConflictDoUpdate({ target: [dashboardLayouts.membershipId, dashboardLayouts.scope], set: { widgets, updatedAt: new Date() } });
  return getLayout(x, input.scope);
}

export async function resetLayout(x: Ctx, scope: 'ALL' | 'ME' | 'WORKER') {
  await x.tx.delete(dashboardLayouts).where(and(eq(dashboardLayouts.membershipId, x.actor.membershipId), eq(dashboardLayouts.scope, scope)));
  return getLayout(x, scope);
}

/**
 * Data for the requested widgets in one round trip. Each widget is computed only
 * if the actor has the needed permission, and always scope-filtered.
 */
export async function widgetData(x: Ctx, keys: string[], scope: 'ALL' | 'ME' | 'WORKER', workerId?: string) {
  const now = x.deps.now();
  const today = localDate(now, x.org.timezone);
  const weekStart = startOfWeek(today, x.org.weekStart);
  const weekEnd = addDaysToDate(weekStart, 6);
  const g = x.actor.grants;
  const target: string[] | 'all' =
    scope === 'ME' ? [x.actor.membershipId] : scope === 'WORKER' && workerId ? narrowMemberships(x.actor, 'time:read', [workerId]) : narrowMemberships(x.actor, 'time:read');
  const memberFilter = (col: Parameters<typeof inArray>[0]) => (target === 'all' ? undefined : inArray(col, target.length ? target : ['00000000-0000-7000-8000-000000000000']));
  const out: Record<string, unknown> = {};
  const want = new Set(keys);

  const rollups = async (from: string, to: string) =>
    x.tx.select().from(rollupWorkerDay).where(and(gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to), memberFilter(rollupWorkerDay.membershipId)));

  if (want.has('current_timer') && g['tracking:track']) out.current_timer = await currentTracking(x);

  if (want.has('worked_today') || want.has('tracked_week') || want.has('activity') || want.has('hours_by_project')) {
    const week = await rollups(weekStart, weekEnd);
    const prevWeek = await rollups(addDaysToDate(weekStart, -7), addDaysToDate(weekStart, -1));
    const sum = (rows: typeof week, pred: (r: (typeof week)[number]) => boolean = () => true) => rows.filter(pred).reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0);
    // Rollups only hold finished work segments; add every timer running right now, per local day.
    const running = await x.tx
      .select({ m: timeSegments.membershipId, start: timeSegments.startedAt, tz: trackingSessions.timezone, projectId: trackingSessions.projectId, billable: projects.billableDefault })
      .from(timeSegments)
      .innerJoin(trackingSessions, eq(trackingSessions.id, timeSegments.sessionId))
      .innerJoin(projects, eq(projects.id, trackingSessions.projectId))
      .where(and(isNull(timeSegments.endedAt), eq(timeSegments.kind, 'WORK'), memberFilter(timeSegments.membershipId)));
    const liveByDay = new Map<string, number>();
    const liveByProject = new Map<string, number>();
    const liveWorkersToday = new Set<string>();
    let liveBillableToday = 0;
    let liveBillableWeek = 0;
    for (const r of running) {
      if (now <= r.start) continue;
      for (const pc of splitAtLocalMidnight({ start: r.start, end: now }, r.tz)) {
        if (pc.localDate < weekStart || pc.localDate > weekEnd) continue;
        const secs = Math.round((pc.end.getTime() - pc.start.getTime()) / 1000);
        liveByDay.set(pc.localDate, (liveByDay.get(pc.localDate) ?? 0) + secs);
        liveByProject.set(r.projectId, (liveByProject.get(r.projectId) ?? 0) + secs);
        if (r.billable) liveBillableWeek += secs;
        if (pc.localDate === today) {
          liveWorkersToday.add(r.m);
          if (r.billable) liveBillableToday += secs;
        }
      }
    }
    const liveWeek = [...liveByDay.values()].reduce((a, b) => a + b, 0);
    const todayS = sum(week, (r) => r.localDate === today) + (liveByDay.get(today) ?? 0);
    const weekS = sum(week) + liveWeek;
    const act = week.reduce((s, r) => s + r.activeSeconds, 0);
    const actT = week.reduce((s, r) => s + r.activityTrackedSeconds, 0);
    const workers = new Set([...week.filter((r) => r.localDate === today).map((r) => r.membershipId), ...liveWorkersToday]).size;
    out.worked_today = { seconds: todayS, workers, billable_seconds: week.filter((r) => r.localDate === today && r.billable).reduce((s, r) => s + r.trackedSeconds + r.manualSeconds, 0) + liveBillableToday };
    out.tracked_week = {
      seconds: weekS,
      previous_seconds: sum(prevWeek),
      billable_seconds: sum(week, (r) => r.billable) + liveBillableWeek,
      by_day: Array.from({ length: 7 }, (_, i) => {
        const d = addDaysToDate(weekStart, i);
        return { date: d, seconds: sum(week, (r) => r.localDate === d) + (liveByDay.get(d) ?? 0) };
      }),
    };
    out.activity = { pct: actT > 0 ? Math.round((act / actT) * 100) : null, previous_pct: (() => { const a = prevWeek.reduce((s, r) => s + r.activeSeconds, 0); const t = prevWeek.reduce((s, r) => s + r.activityTrackedSeconds, 0); return t > 0 ? Math.round((a / t) * 100) : null; })() };
    const byProject = new Map<string, number>();
    for (const r of week) byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.trackedSeconds + r.manualSeconds);
    for (const [p, secs] of liveByProject) byProject.set(p, (byProject.get(p) ?? 0) + secs);
    const pnames = byProject.size ? await x.tx.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(inArray(projects.id, [...byProject.keys()])) : [];
    out.hours_by_project = [...byProject.entries()].map(([id, s]) => ({ project_id: id, name: pnames.find((p) => p.id === id)?.name ?? '', color: pnames.find((p) => p.id === id)?.color ?? '#4B4FC4', seconds: s })).sort((a, b) => b.seconds - a.seconds).slice(0, 8);
  }

  if (want.has('active_workers') && g['tracking:read'] && g['tracking:read'] !== 'own') {
    const live = await liveWorkers(x);
    out.active_workers = { working: live.filter((l) => l.status === 'WORKING').length, idle: live.filter((l) => l.status === 'IDLE').length, total: live.length, workers: live.slice(0, 12) };
  }

  if (want.has('timesheets_to_approve') && g['timesheets:approve']) {
    const visible = narrowMemberships(x.actor, 'timesheets:approve');
    // Same rows as the approval queue: your own submitted timesheet is not yours to approve (unless you are the owner).
    const [c] = await x.tx.select({ n: count() }).from(timesheets).where(and(eq(timesheets.status, 'SUBMITTED'), visible === 'all' ? undefined : inArray(timesheets.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']), x.actor.isOwner ? undefined : ne(timesheets.membershipId, x.actor.membershipId)));
    const [mt] = await x.tx.select({ n: count() }).from(manualTimeRequests).where(and(eq(manualTimeRequests.status, 'PENDING'), visible === 'all' ? undefined : inArray(manualTimeRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000'])));
    out.timesheets_to_approve = { timesheets: c?.n ?? 0, manual_time: mt?.n ?? 0 };
  }

  if (want.has('my_timesheet') && g['timesheets:submit']) {
    const [ts] = await x.tx.select().from(timesheets).where(eq(timesheets.membershipId, x.actor.membershipId)).orderBy(desc(timesheets.periodStart)).limit(1);
    out.my_timesheet = ts ? { status: ts.status, period_start: ts.periodStart, period_end: ts.periodEnd, comment: ts.comment } : { status: 'DRAFT', period_start: null, period_end: null, comment: null };
  }

  if (want.has('project_budgets') && g['budgets:read']) {
    const all = await budgetStatuses(x.tx, x.org.currency, today);
    out.project_budgets = redactBudgetMoney(x, (g['budgets:read'] === 'org' ? all : all.filter((b) => b.subject_type === 'PROJECT' && x.actor.assignedProjectIds.has(b.subject_id))).slice(0, 6));
  }

  if (want.has('recent_screenshots') && g['screenshots:read']) {
    out.recent_screenshots = await listScreenshots(x, { from: addDaysToDate(today, -1), to: today, membershipIds: target === 'all' ? undefined : target, limit: 8 });
  }

  if (want.has('recent_sessions') && g['tracking:read']) {
    out.recent_sessions = (await listSessions(x, { from: addDaysToDate(today, -6), to: today, membershipIds: target === 'all' ? undefined : target })).slice(0, 8);
  }

  if ((want.has('time_off_requests') || want.has('upcoming_time_off')) && g['time_off:read']) {
    const visible = narrowMemberships(x.actor, 'time_off:read', scope === 'ME' ? [x.actor.membershipId] : undefined);
    const filter = visible === 'all' ? undefined : inArray(timeOffRequests.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']);
    const pending = await x.tx.select().from(timeOffRequests).where(and(eq(timeOffRequests.status, 'PENDING'), filter)).orderBy(timeOffRequests.startDate).limit(10);
    const upcoming = await x.tx.select().from(timeOffRequests).where(and(eq(timeOffRequests.status, 'APPROVED'), gte(timeOffRequests.endDate, today), lte(timeOffRequests.startDate, addDaysToDate(today, 30)), filter)).orderBy(timeOffRequests.startDate).limit(10);
    const names = await memberNames(x, [...new Set([...pending, ...upcoming].map((r) => r.membershipId))]);
    const map = (r: typeof pending[number]) => ({ id: r.id, worker_name: names.get(r.membershipId) ?? '', start_date: r.startDate, end_date: r.endDate, hours: r.hours, status: r.status });
    out.time_off_requests = pending.map(map);
    out.upcoming_time_off = upcoming.map(map);
  }

  if (want.has('attendance_today') && g['attendance:read'] && g['attendance:read'] !== 'own') {
    const rows = await listAttendance(x, today, today);
    out.attendance_today = { present: rows.filter((r) => r.status === 'PRESENT').length, late: rows.filter((r) => r.status === 'LATE').length, absent: rows.filter((r) => r.status === 'ABSENT').length, on_leave: rows.filter((r) => r.status === 'ON_LEAVE').length, rows: rows.filter((r) => r.status === 'LATE' || r.status === 'ABSENT').slice(0, 8) };
  }

  if (want.has('invoices') && g['invoices:read']) {
    // In the organization's currency, as the Invoices page totals it (F5): no amounts in two currencies added up.
    const rows = await x.tx.select().from(invoices).where(and(sql`${invoices.status} <> 'VOID'`, eq(invoices.currency, x.org.currency), clientFilter(x, 'invoices:read', invoices.clientId)));
    const st = rows.map((i) => ({ i, s: deriveInvoiceStatus({ explicit: i.status, totalMinor: i.totalMinor, paidMinor: i.paidMinor, dueDate: i.dueDate, today }) }));
    out.invoices = {
      outstanding_minor: st.filter((r) => r.s !== 'DRAFT' && r.s !== 'PAID').reduce((s, r) => s + r.i.totalMinor - r.i.paidMinor, 0),
      overdue_minor: st.filter((r) => r.s === 'OVERDUE').reduce((s, r) => s + r.i.totalMinor - r.i.paidMinor, 0),
      overdue_count: st.filter((r) => r.s === 'OVERDUE').length,
      draft_count: st.filter((r) => r.s === 'DRAFT').length,
      currency: x.org.currency,
    };
  }

  if (want.has('assigned_tasks') && g['tasks:read']) {
    const rows = await x.tx
      .select({ t: tasks, projectName: projects.name })
      .from(tasks)
      .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(taskAssignees.membershipId, x.actor.membershipId), isNull(tasks.archivedAt), sql`${tasks.status} <> 'DONE'`))
      .orderBy(sql`${tasks.dueDate} nulls last`, desc(tasks.priority))
      .limit(8);
    out.assigned_tasks = rows.map(({ t, projectName }) => ({ id: t.id, title: t.title, project_id: t.projectId, project_name: projectName, status: t.status, priority: t.priority, due_date: t.dueDate }));
  }

  if (want.has('devices_offline') && g['devices:read'] === 'org') {
    const stale = new Date(now.getTime() - 24 * 3600_000);
    const rows = await x.tx.select().from(devices).where(and(inArray(devices.status, ['ACTIVE', 'OFFLINE']), sql`coalesce(${devices.lastSeenAt}, ${devices.createdAt}) < ${stale}`)).limit(10);
    out.devices_offline = rows.map((d) => ({ id: d.id, name: d.name, last_seen_at: d.lastSeenAt?.toISOString() ?? null }));
  }

  if (want.has('weekly_limits') && g['tracking:track']) {
    // The actor's own limits and how much of them is used (null when no limit applies).
    const policy = await effectivePolicy(x.tx, x.org.id, x.actor.membershipId, x.policyCache);
    const { dailySeconds, weeklySeconds } = policy.limits;
    if (dailySeconds == null && weeklySeconds == null) out.weekly_limits = null;
    else {
      const tz = await workerTimezone(x.tx, x.actor.membershipId, x.org.timezone);
      const used = await todayAndWeek(x.tx, x.actor.membershipId, tz, x.org.weekStart, now);
      out.weekly_limits = {
        daily: dailySeconds == null ? null : { limit_seconds: dailySeconds, used_seconds: used.today },
        weekly: weeklySeconds == null ? null : { limit_seconds: weeklySeconds, used_seconds: used.week },
      };
    }
  }
  if ((want.has('month_summary') || want.has('hours_by_client')) && g['time:read']) {
    const monthStart = `${today.slice(0, 8)}01`;
    const [y, m] = today.split('-').map(Number) as [number, number];
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const ins = await insights(x, monthStart, monthEnd, target === 'all' ? undefined : target.length ? target : ['00000000-0000-7000-8000-000000000000']);
    out.month_summary = { from: ins.from, to: ins.to, currency: ins.currency, money_visible: ins.money_visible, other_currency: ins.other_currency, totals: ins.totals };
    out.hours_by_client = ins.by_client.slice(0, 8);
  }

  void memberships;
  void trackingSessions;
  if (!Object.keys(out).length && keys.length && !g['org:read']) throw forbidden();
  return out;
}
