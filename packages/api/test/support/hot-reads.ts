/**
 * The hot reads (Phase 14): the screens people open most, with an organization set up to read them.
 * Shared by the query-budget test (perf-budgets.test.ts) and the index review
 * (scripts/perf-index-review.ts), so both measure the same requests.
 */
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { Client, addMember, signup, type Harness } from '../harness';
import { seedBigOrg } from './big-org';

export interface HotOrg {
  scale: number;
  orgId: string;
  admin: Client;
  /** a team manager of "Team 1" (20 members at every scale) */
  manager: Client;
  /** a client portal viewer of the client that owns every project */
  viewer: Client;
  accessId: string;
  /** one worker, for per-member reads */
  memberId: string;
}

export interface HotRead {
  name: string;
  method: 'GET' | 'POST';
  path: (o: HotOrg) => string;
  body?: () => unknown;
  /** a client portal read (by the viewer, outside the organization routes) */
  portal?: boolean;
  /** read as the team manager instead of the admin */
  manager?: boolean;
}

/** An organization at `scale` (see seedBigOrg), with a manager, a client and a portal viewer. */
export async function setupHotOrg(t: Harness, scale: number, tag = `${scale}`): Promise<HotOrg> {
  const { client: admin, orgId } = await signup(t, `Ada${tag}`, `ada${tag}@perf.test`);
  await seedBigOrg(t, orgId, scale);
  const workers = await admin.get<{ data: Array<{ id: string; role_key: string }> }>(`/orgs/${orgId}/workers?page=1&page_size=5`);
  const memberId = workers.body.data.find((w) => w.role_key === 'WORKER')!.id;
  // A client owning every project, with a portal viewer: the portal reads are hot too.
  const clientId = (await admin.post<{ id: string }>(`/orgs/${orgId}/clients`, { name: 'Big Client' })).body.id;
  await withSystem(t.h.db, (tx) => tx.execute(sql`update projects set client_id = ${clientId}::uuid where organization_id = ${orgId}::uuid`));
  await admin.put(`/orgs/${orgId}/clients/${clientId}/portal`, { enabled: true });
  const inv = await admin.post<{ invite_url: string }>(`/orgs/${orgId}/clients/${clientId}/portal/invitations`, { email: `viewer${tag}@perf.test`, name: 'Vi' });
  const viewer = new Client(t);
  const acc = await viewer.post<{ access_id: string }>('/portal/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token'), name: 'Vi', password: 'correct-horse-battery' });
  // A team manager of the first team: their filtered views must not grow with the organization either.
  const mgr = await addMember(t, admin, orgId, 'Mona', `mona${tag}@perf.test`, 'TEAM_MANAGER');
  await withSystem(t.h.db, (tx) =>
    tx.execute(sql`insert into team_members (organization_id, team_id, membership_id, role) select ${orgId}::uuid, id, ${mgr.membershipId}::uuid, 'MANAGER' from teams where organization_id = ${orgId}::uuid and name = 'Team 1'`),
  );
  return { scale, orgId, admin, manager: mgr.client, viewer, accessId: acc.body.access_id, memberId };
}

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

/** The hot reads, with dates relative to the harness clock. */
export function hotReads(t: Harness): HotRead[] {
  const today = () => ymd(t.clock.now);
  const daysAgo = (n: number) => ymd(new Date(t.clock.now.getTime() - n * 86_400_000));
  const widgets = '/dashboard/widgets?keys=worked_today,tracked_week,active_workers,timesheets_to_approve,hours_by_project,attendance_today&scope=ALL';
  return [
    { name: 'dashboard widgets', method: 'GET', path: () => widgets },
    { name: 'live tracking', method: 'GET', path: () => '/tracking/live' },
    { name: 'time entries, 7 days', method: 'GET', path: () => `/time-entries?from=${daysAgo(6)}&to=${today()}&page=1&page_size=50` },
    { name: 'attendance today', method: 'GET', path: () => `/attendance?from=${today()}&to=${today()}&page=1&page_size=50` },
    { name: 'time & activity report, 30 days', method: 'POST', path: () => '/reports/time-activity/query', body: () => ({ from: daysAgo(29), to: today() }) },
    { name: 'timesheet of a member', method: 'GET', path: (o) => `/timesheets?membership_id=${o.memberId}` },
    { name: 'timesheet approvals', method: 'GET', path: () => '/timesheets/approvals?page=1&page_size=50' },
    { name: 'members', method: 'GET', path: () => '/workers?page=1&page_size=50' },
    { name: 'projects', method: 'GET', path: () => '/projects' },
    { name: 'clients', method: 'GET', path: () => '/clients' },
    { name: 'summary (insights), 7 days', method: 'GET', path: () => `/insights?from=${daysAgo(6)}&to=${today()}` },
    { name: 'sessions, 7 days', method: 'GET', path: () => `/sessions?from=${daysAgo(6)}&to=${today()}&page=1&page_size=50` },
    { name: 'activity of a member, one day', method: 'GET', path: (o) => `/activity/day?membership_id=${o.memberId}&date=${daysAgo(1)}` },
    { name: 'screenshots, one day', method: 'GET', path: () => `/screenshots?from=${daysAgo(1)}&to=${daysAgo(1)}&limit=200` },
    { name: 'portal summary, 30 days', method: 'GET', portal: true, path: (o) => `/portal/${o.accessId}/summary?from=${daysAgo(29)}&to=${today()}` },
    { name: 'portal insights', method: 'GET', portal: true, path: (o) => `/portal/${o.accessId}/insights` },
    { name: 'manager: dashboard widgets', method: 'GET', manager: true, path: () => widgets },
    { name: 'manager: live tracking', method: 'GET', manager: true, path: () => '/tracking/live' },
    { name: 'manager: time entries, 7 days', method: 'GET', manager: true, path: () => `/time-entries?from=${daysAgo(6)}&to=${today()}&page=1&page_size=50` },
    { name: 'manager: attendance today', method: 'GET', manager: true, path: () => `/attendance?from=${today()}&to=${today()}&page=1&page_size=50` },
    { name: 'manager: timesheet approvals', method: 'GET', manager: true, path: () => '/timesheets/approvals?page=1&page_size=50' },
    { name: 'manager: AI insights overview', method: 'GET', manager: true, path: () => `/assistant/insights/overview?from=${daysAgo(29)}&to=${today()}` },
    { name: 'AI insights overview', method: 'GET', path: () => `/assistant/insights/overview?from=${daysAgo(29)}&to=${today()}` },
  ];
}

/** Run one read as the right person; returns the status and the statements sent (Server-Timing). */
export async function runHotRead(o: HotOrg, r: HotRead): Promise<{ status: number; queries: number }> {
  const res = r.portal ? await o.viewer.req(r.method, r.path(o), r.body?.()) : await (r.manager ? o.manager : o.admin).req(r.method, `/orgs/${o.orgId}${r.path(o)}`, r.body?.());
  const header = res.headers.get('server-timing') ?? '';
  return { status: res.status, queries: Number(header.match(/desc="(\d+) queries/)?.[1] ?? NaN) };
}
