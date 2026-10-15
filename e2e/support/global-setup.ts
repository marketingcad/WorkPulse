import { mkdirSync, writeFileSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import { ADMIN_STATE, AUTH_DIR, DATA_FILE, PASSWORD, VIEWER_STATE, WEB_URL, WORKER_STATE } from './env';

/**
 * Builds this run's test data through the public API, the same way a customer would:
 * an organization (signed up), a team, two projects, a Worker with a finalized payroll
 * (approved time + a bonus and a deduction), a second Worker with no payroll, and a web user who
 * may read budgets but nothing about money (for permission checks).
 * Every name is unique per run, so specs never depend on data left by earlier runs.
 */

export interface E2EData {
  run: string;
  orgId: string;
  orgName: string;
  admin: { email: string; name: string; membershipId: string };
  worker: { email: string; name: string; membershipId: string };
  /** A Worker with no payroll (empty states). */
  newcomer: { email: string; name: string; membershipId: string };
  /** Custom role with only `budgets:read`: sees budgets without amounts, and no invoices or payroll. */
  viewer: { email: string; name: string; membershipId: string };
  teamName: string;
  projects: { website: { id: string; name: string }; app: { id: string; name: string } };
  payStub: { id: string; periodStart: string; periodEnd: string; netMinor: number; grossMinor: number };
}

async function json<T = any>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string, expected: number[] = [200, 201]): Promise<T> {
  if (!expected.includes(res.status())) throw new Error(`[e2e setup] ${what}: HTTP ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

const newContext = () => request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });

async function accept(inviteUrl: string, name: string): Promise<{ ctx: APIRequestContext; membershipId: string }> {
  const ctx = await newContext();
  const token = new URL(inviteUrl).searchParams.get('token');
  const r = await json(await ctx.post('/api/v1/auth/invitations/accept', { data: { token, name, password: PASSWORD } }), `accept ${name}`);
  return { ctx, membershipId: r.membership_id };
}

export default async function globalSetup(): Promise<void> {
  const host = new URL(WEB_URL).hostname;
  // Safety: the suite creates data and must only ever run against a local, throwaway server.
  if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`[e2e setup] refusing to run against ${WEB_URL}: E2E runs only against a local server`);

  const run = Date.now().toString(36);
  const email = (who: string) => `${who}+${run}@e2e.test`;
  const orgName = `E2E Org ${run}`;

  const admin = await newContext();
  const su = await json(await admin.post('/api/v1/auth/signup', { data: { name: 'Erin Admin', email: email('admin'), password: PASSWORD, organization_name: orgName, timezone: 'UTC' } }), 'signup');
  const orgId: string = su.organization_id;
  const o = (p: string) => `/api/v1/orgs/${orgId}${p}`;

  const roles: Array<{ id: string; key: string }> = await json(await admin.get(o('/roles')), 'roles');
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
  const members = async (): Promise<Array<{ id: string; email: string }>> => {
    const w = await json(await admin.get(o('/workers')), 'workers');
    return Array.isArray(w) ? w : w.data;
  };
  const adminId = (await members()).find((m) => m.email === email('admin'))!.id;

  const teamName = `Design ${run}`;
  const team = await json(await admin.post(o('/teams'), { data: { name: teamName } }), 'team');
  const website = await json(await admin.post(o('/projects'), { data: { name: `Website ${run}`, member_ids: [adminId] } }), 'project website');
  const app = await json(await admin.post(o('/projects'), { data: { name: `Mobile App ${run}`, member_ids: [adminId] } }), 'project app');

  // Workers join through invitations, as in production.
  const invite = async (who: string, name: string) => json(await admin.post(o('/invitations'), { data: { email: email(who), name, role_id: roleId('WORKER'), team_ids: [team.id], project_ids: [website.id] } }), `invite ${who}`);
  const worker = await accept((await invite('wade', 'Wade Worker')).invite_url, 'Wade Worker');
  const newcomer = await accept((await invite('nina', 'Nina Newcomer')).invite_url, 'Nina Newcomer');
  const viewerRole = await json(await admin.post(o('/roles'), { data: { name: `Budget viewer ${run}`, grants: { 'budgets:read': 'org' } } }), 'viewer role');
  const viewer = await accept((await json(await admin.post(o('/invitations'), { data: { email: email('vera'), name: 'Vera Viewer', role_id: viewerRole.id } }), 'invite vera')).invite_url, 'Vera Viewer');

  // A finalized weekly payroll for Wade: 3 h approved time at $25/h, plus a bonus and a deduction.
  await json(await admin.post(o('/rates'), { data: { kind: 'PAY', scope: 'WORKER', scope_id: worker.membershipId, amount_minor: 2500, currency: 'USD', effective_from: '2020-01-01' } }), 'pay rate');
  const profile = await json(await admin.post(o('/payroll/profiles'), { data: { name: `Weekly ${run}`, period: { type: 'weekly' }, currency: 'USD', member_ids: [worker.membershipId] } }), 'payroll profile');
  const draft = await json(await admin.post(o('/payroll/runs'), { data: { profile_id: profile.id } }), 'payroll run');
  const day = draft.period_start as string;
  await json(await admin.post(o('/manual-time'), { data: { membership_id: worker.membershipId, project_id: website.id, started_at: `${day}T13:00:00.000Z`, ended_at: `${day}T16:00:00.000Z`, reason: 'E2E fixture' } }), 'manual time');
  const sheet = await json(await worker.ctx.post(o('/timesheets/submit'), { data: { date: day } }), 'submit timesheet');
  await json(await admin.post(o(`/timesheets/${sheet.id}/approve`), { data: {} }), 'approve timesheet');
  await json(await admin.post(o(`/payroll/runs/${draft.id}/recalculate`), { data: {} }), 'recalculate payroll');
  const runNow = await json(await admin.get(o(`/payroll/runs/${draft.id}`)), 'payroll run');
  const line = runNow.lines.find((l: { membership_id: string }) => l.membership_id === worker.membershipId);
  await json(await admin.put(o(`/payroll/runs/${draft.id}/lines/${line.id}/adjustments`), { data: { adjustments: [{ label: 'Bonus', amount_minor: 5000 }, { label: 'Equipment', amount_minor: -1000 }] } }), 'adjustments');
  const finalized = await json(await admin.post(o(`/payroll/runs/${draft.id}/finalize`), { data: {} }), 'finalize payroll');
  const stub = finalized.lines.find((l: { membership_id: string }) => l.membership_id === worker.membershipId);

  const data: E2EData = {
    run,
    orgId,
    orgName,
    admin: { email: email('admin'), name: 'Erin Admin', membershipId: adminId },
    worker: { email: email('wade'), name: 'Wade Worker', membershipId: worker.membershipId },
    newcomer: { email: email('nina'), name: 'Nina Newcomer', membershipId: newcomer.membershipId },
    viewer: { email: email('vera'), name: 'Vera Viewer', membershipId: viewer.membershipId },
    teamName,
    projects: { website: { id: website.id, name: website.name }, app: { id: app.id, name: app.name } },
    payStub: { id: stub.id, periodStart: finalized.period_start, periodEnd: finalized.period_end, netMinor: stub.net_minor, grossMinor: stub.gross_minor },
  };

  mkdirSync(AUTH_DIR, { recursive: true });
  // The admin starts each web test signed in on the web, and remembers this org as the last one used.
  const state = await admin.storageState();
  state.origins = [{ origin: WEB_URL, localStorage: [{ name: 'tw.lastOrg', value: orgId }] }];
  writeFileSync(ADMIN_STATE, JSON.stringify(state));
  writeFileSync(WORKER_STATE, JSON.stringify(await worker.ctx.storageState()));
  const viewerState = await viewer.ctx.storageState();
  viewerState.origins = [{ origin: WEB_URL, localStorage: [{ name: 'tw.lastOrg', value: orgId }] }];
  writeFileSync(VIEWER_STATE, JSON.stringify(viewerState));
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  await Promise.all([admin.dispose(), worker.ctx.dispose(), newcomer.ctx.dispose(), viewer.ctx.dispose()]);
}
