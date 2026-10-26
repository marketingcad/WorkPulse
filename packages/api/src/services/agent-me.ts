import { and, eq, gte, lte } from 'drizzle-orm';
import { idleEvents, projects, rollupWorkerDay, trackingSessions } from '@tallywork/db';
import { addDaysToDate, forbidden, localDate, startOfLocalDay, startOfWeek, type Grants, type Permission, type Scope } from '@tallywork/domain';
import type { timeOffRequestInput } from '@tallywork/contracts';
import type { z } from 'zod';
import type { AgentCtx } from './agent';
import { memberCtx } from './agent';
import type { Ctx } from './ctx';
import { activityDay, idleEndFromActivity } from './activity';
import { companyProfile } from './finance';
import { balances, listShifts, listTimeOffRequests, requestTimeOff } from './operations';
import { getPayStub, myPayStubs as ownPayStubs } from './payroll';
import { listNotifications, markNotificationsRead } from './platform';
import { clientVisibilityFor } from './portal';
import { getTimesheet, submitTimesheet } from './timesheets';
import { listSessions } from './timer';
import { workerTimezone } from './tracking';
import { listTasks } from './work';

/**
 * The desktop app's own-data API. A device may read back ONLY its bound worker's own
 * data, through the same services (and permission checks) the web app uses, with the
 * worker's grants narrowed to an allowlist at `own` scope (projects/tasks: `assigned`).
 * Screenshots are never readable from a device; edits and approvals are never possible.
 * Revoking the device ends access immediately (loadAgentCtx checks on every request).
 */
const OWN: Permission[] = ['tracking:read', 'activity:read', 'apps:read', 'time:read', 'timesheets:read', 'timesheets:submit', 'schedules:read', 'time_off:read', 'time_off:request', 'reports:read'];
const ASSIGNED: Permission[] = ['projects:read', 'tasks:read'];
const RANK: Record<Scope, number> = { own: 0, assigned: 1, team: 2, org: 3 };

/** Narrow the worker's real grants to the device allowlist (never widening anything). */
export function deviceGrants(roleGrants: Grants): Grants {
  const out: Grants = {};
  for (const p of OWN) if (roleGrants[p]) out[p] = 'own';
  for (const p of ASSIGNED) {
    const g = roleGrants[p];
    if (g) out[p] = RANK[g] <= RANK.assigned ? g : 'assigned';
  }
  return out;
}

export async function ownCtx(a: AgentCtx): Promise<Ctx> {
  const x = await memberCtx(a);
  return { ...x, actor: { ...x.actor, grants: deviceGrants(x.actor.grants) } };
}

async function today(a: AgentCtx): Promise<{ tz: string; date: string }> {
  const tz = await workerTimezone(a.tx, a.membershipId, a.orgTimezone);
  return { tz, date: localDate(a.deps.now(), tz) };
}

const need = (x: Ctx, p: Permission) => {
  if (!x.actor.grants[p]) throw forbidden('Your role does not include this');
};

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function mySessions(a: AgentCtx, q: { from?: string; to?: string }) {
  const x = await ownCtx(a);
  const { date } = await today(a);
  return listSessions(x, { from: q.from ?? addDaysToDate(date, -6), to: q.to ?? date, membershipIds: [a.membershipId] });
}

export async function myTimesheet(a: AgentCtx, date?: string) {
  const x = await ownCtx(a);
  return getTimesheet(x, a.membershipId, date ?? (await today(a)).date);
}

export async function mySchedule(a: AgentCtx, q: { from?: string; to?: string }) {
  const x = await ownCtx(a);
  need(x, 'schedules:read');
  const { date } = await today(a);
  const from = q.from ?? startOfWeek(date, a.weekStart);
  return listShifts(x, from, q.to ?? addDaysToDate(from, 13), [a.membershipId]);
}

export async function myTimeOff(a: AgentCtx) {
  const x = await ownCtx(a);
  need(x, 'time_off:read');
  // One transaction = one connection: run the queries one after another.
  // Balances cover exactly the policies that apply to this worker, so they also feed the request form.
  const bal = await balances(x, a.membershipId);
  const requests = await listTimeOffRequests(x, { membershipIds: [a.membershipId] });
  return { balances: bal, requests };
}

export async function myNotifications(a: AgentCtx) {
  return listNotifications(await ownCtx(a), false);
}

export async function myTasks(a: AgentCtx) {
  const x = await ownCtx(a);
  need(x, 'tasks:read');
  // Only tasks the app can still track to (an archived or on-hold project's tasks are refused when tracking).
  return listTasks(x, { mine: true, trackableOnly: true });
}

/** Own activity for a day: 10-minute blocks, apps and websites. Screenshots are always stripped. */
export async function myActivity(a: AgentCtx, date?: string) {
  const x = await ownCtx(a);
  need(x, 'activity:read');
  const day = await activityDay(x, a.membershipId, date ?? (await today(a)).date);
  return { ...day, blocks: day.blocks.map((b) => ({ ...b, screenshots: [] })) };
}

/**
 * Personal totals for [from, to] (defaults: today): tracked/manual/billable/active/idle
 * seconds, activity %, and breakdowns by day and by project. Used by Home and Reports.
 */
export async function mySummary(a: AgentCtx, q: { from?: string; to?: string }) {
  const x = await ownCtx(a);
  need(x, 'time:read');
  const { date } = await today(a);
  const from = q.from ?? date;
  const to = q.to ?? from;
  const rows = await a.tx
    .select({ r: rollupWorkerDay, name: projects.name, color: projects.color })
    .from(rollupWorkerDay)
    .innerJoin(projects, eq(projects.id, rollupWorkerDay.projectId))
    .where(and(eq(rollupWorkerDay.membershipId, a.membershipId), gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to)));
  const t = { tracked: 0, manual: 0, billable: 0, active: 0, activity_tracked: 0, idle: 0 };
  const byDay = new Map<string, number>();
  const byProject = new Map<string, { project_id: string; project_name: string; color: string; seconds: number }>();
  for (const { r, name, color } of rows) {
    const worked = r.trackedSeconds + r.manualSeconds;
    t.tracked += r.trackedSeconds;
    t.manual += r.manualSeconds;
    if (r.billable) t.billable += worked;
    t.active += r.activeSeconds;
    t.activity_tracked += r.activityTrackedSeconds;
    byDay.set(r.localDate, (byDay.get(r.localDate) ?? 0) + worked);
    const p = byProject.get(r.projectId) ?? { project_id: r.projectId, project_name: name, color, seconds: 0 };
    p.seconds += worked;
    byProject.set(r.projectId, p);
  }
  // "Away": the idle periods detected on these days, whatever was decided about them (kept idle is
  // still time away from the keyboard). An unanswered one ends when input resumed, or now if it hasn't.
  const now = a.deps.now();
  const idle = await a.tx
    .select({ sessionId: idleEvents.sessionId, startedAt: idleEvents.startedAt, endedAt: idleEvents.endedAt, tz: trackingSessions.timezone })
    .from(idleEvents)
    .innerJoin(trackingSessions, eq(trackingSessions.id, idleEvents.sessionId))
    .where(and(eq(idleEvents.membershipId, a.membershipId), gte(idleEvents.startedAt, startOfLocalDay(addDaysToDate(from, -1), 'UTC')), lte(idleEvents.startedAt, startOfLocalDay(addDaysToDate(to, 2), 'UTC'))));
  for (const ev of idle) {
    const d = localDate(ev.startedAt, ev.tz);
    if (d < from || d > to) continue;
    const end = ev.endedAt ?? (await idleEndFromActivity(a.tx, ev, now));
    t.idle += Math.max(0, Math.round((end.getTime() - ev.startedAt.getTime()) / 1000));
  }
  const days: Array<{ date: string; seconds: number }> = [];
  for (let d = from; d <= to && days.length < 93; d = addDaysToDate(d, 1)) days.push({ date: d, seconds: byDay.get(d) ?? 0 });
  return {
    from,
    to,
    worked_seconds: t.tracked + t.manual,
    tracked_seconds: t.tracked,
    manual_seconds: t.manual,
    billable_seconds: t.billable,
    active_seconds: t.active,
    idle_seconds: t.idle,
    activity_pct: t.activity_tracked ? Math.round((t.active / t.activity_tracked) * 100) : null,
    days,
    projects: [...byProject.values()].sort((p, q2) => q2.seconds - p.seconds),
  };
}

/** Own pay stubs from finalized and paid payrolls (drafts stay hidden). */
export async function myPayStubs(a: AgentCtx) {
  return ownPayStubs(await ownCtx(a));
}

/**
 * One own stub plus what its PDF needs. The device grants never include `payroll:read`,
 * so even an admin's device can open only its own worker's finalized stubs.
 */
export async function myPayStub(a: AgentCtx, id: string) {
  const x = await ownCtx(a);
  const stub = await getPayStub(x, id);
  return { stub, company: await companyProfile(x) };
}

/** Clients whose enabled portal shares this worker's activity or screenshots. */
export async function myClientVisibility(a: AgentCtx) {
  return clientVisibilityFor(a.tx, a.membershipId);
}

// ─── Worker actions ──────────────────────────────────────────────────────────

export async function submitMyTimesheet(a: AgentCtx, input: { date: string; version?: number }) {
  const x = await ownCtx(a);
  need(x, 'timesheets:submit');
  return submitTimesheet(x, a.membershipId, input.date, input.version);
}

export async function requestMyTimeOff(a: AgentCtx, input: z.infer<typeof timeOffRequestInput>) {
  const x = await ownCtx(a);
  need(x, 'time_off:request');
  return requestTimeOff(x, input);
}

export async function readMyNotifications(a: AgentCtx, ids: string[] | 'all') {
  await markNotificationsRead(await ownCtx(a), ids);
}
