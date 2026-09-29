import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let manager: Client;
let orgId: string;
let clientId: string;
let otherClientId: string;
let siteId: string;
let appId: string;
let otherProjectId: string;
let walt: { client: Client; membershipId: string };
let bea: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@portal.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@portal.test');
  bea = await addMember(t, admin, orgId, 'Bea', 'bea@portal.test');
  ({ client: manager } = await addMember(t, admin, orgId, 'Mia', 'mia@portal.test', 'TEAM_MANAGER'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  otherClientId = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
  siteId = (await admin.post(o('/projects'), { name: 'Website', client_id: clientId, member_ids: [walt.membershipId, bea.membershipId] })).body.id;
  appId = (await admin.post(o('/projects'), { name: 'Mobile app', client_id: clientId, member_ids: [walt.membershipId] })).body.id;
  otherProjectId = (await admin.post(o('/projects'), { name: 'Globex site', client_id: otherClientId, member_ids: [bea.membershipId] })).body.id;
});
afterAll(() => t.close());

describe('portal admin', () => {
  it('starts disabled, with hours and tasks on and monitoring off', async () => {
    const r = await admin.get(o(`/clients/${clientId}/portal`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, sections: { hours: true, tasks: true, activity: false, screenshots: false }, project_ids: null, access: [] });
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
  });

  it('only people with org-wide monitoring access can switch activity or screenshots on', async () => {
    expect((await manager.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(403);
    const r = await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true } });
    expect(r.status).toBe(200);
    expect(r.body.sections).toEqual({ hours: true, tasks: true, activity: true, screenshots: false });
  });

  it('rejects projects that belong to another client', async () => {
    const r = await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [siteId, otherProjectId] });
    expect(r.status).toBe(400);
  });

  it('invites a viewer by email with a 7-day link, and revokes them', async () => {
    const r = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'carla@acme.test', name: 'Carla' });
    expect(r.status).toBe(201);
    expect(r.body.invite_url).toMatch(/\/portal-invite\?token=/);
    const mail = t.mailer.sent.at(-1)!;
    expect(mail.to).toBe('carla@acme.test');
    expect(mail.subject).toBe("Acme’s WorkPulse dashboard from Ada's Org");
    const again = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'CARLA@acme.test' });
    expect(again.status).toBe(409);
    const tmp = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'temp@acme.test' });
    expect((await admin.del(o(`/clients/${clientId}/portal/access/${tmp.body.id}`))).status).toBe(204);
    const list = (await admin.get(o(`/clients/${clientId}/portal`))).body.access;
    expect(list.find((a: { email: string }) => a.email === 'temp@acme.test').status).toBe('REVOKED');
  });
});

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
let dora: Client;
let doraAccessId: string;

describe('accepting a portal invitation', () => {
  it('creates a verified account that is not a member of the organization', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'dora@acme.test', name: 'Dora' });
    dora = new Client(t);
    const r = await dora.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url), name: 'Dora', password: PASSWORD });
    expect(r.status).toBe(200);
    doraAccessId = r.body.access_id;
    const me = await dora.get('/me');
    expect(me.body.organizations).toEqual([]);
    expect(me.body.user.email_verified).toBe(true);
    expect(me.body.client_portals).toEqual([{ access_id: doraAccessId, organization_name: "Ada's Org", client_name: 'Acme' }]);
    // Not a member: every org route is closed to them.
    expect((await dora.get(o('/workers'))).status).toBe(404);
  });

  it('rejects a reused or unknown token', async () => {
    expect((await new Client(t).post('/portal/invitations/accept', { token: 'x'.repeat(43), password: PASSWORD })).status).toBe(422);
  });

  it('asks an existing account to sign in first, then links it', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'walt@portal.test' });
    const r = await new Client(t).post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('login_required');
    const ok = await walt.client.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(ok.status).toBe(200);
  });
});

describe('portal dashboard', () => {
  const range = '?from=2026-09-01&to=2026-09-30';
  beforeAll(async () => {
    const task = (await admin.post(o(`/projects/${siteId}/tasks`), { title: 'Homepage', estimate_seconds: 4 * 3600, assignee_ids: [walt.membershipId] })).body.id;
    // Each member's entries are back-to-back (never overlapping) — manual-time rejects overlaps per membership.
    const add = (m: string, p: string, h: number, startedAt: string, taskId?: string) =>
      admin.post(o('/manual-time'), { membership_id: m, project_id: p, task_id: taskId, started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + h * 3600_000).toISOString(), reason: 'Work' });
    await add(walt.membershipId, siteId, 2, '2026-09-15T13:00:00Z', task);
    await add(bea.membershipId, siteId, 1, '2026-09-15T13:00:00Z');
    await add(walt.membershipId, appId, 3, '2026-09-15T15:00:00Z');
    await add(bea.membershipId, otherProjectId, 5, '2026-09-15T14:00:00Z'); // another client's project: never shown
    await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: siteId, kind: 'HOURS', amount: 10 * 3600 });
    // A budget row is one-per-subject (unique on org+subject_type+subject_id, independent of kind), so a
    // MONEY budget "on siteId" would replace — not join — the HOURS budget above. To prove `portalSummaryTx`
    // really filters budgets to `kind === 'HOURS'` (and not merely that money never gets fetched), the MONEY
    // budget goes on the other included project (`appId`), which still has no budget of its own.
    await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: appId, kind: 'MONEY', amount: 100_000_00 });
    await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: siteId, amount_minor: 5000, currency: 'USD', effective_from: '2020-01-01' });
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, project_ids: null, sections: { activity: false } });
    await t.flush();
  });

  it('lists only this client’s projects, workers and tasks', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.status).toBe(200);
    expect(r.body.client.name).toBe('Acme');
    expect(r.body.totals.manual_seconds).toBe(6 * 3600);
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
    const w = Object.fromEntries(r.body.workers.map((x: { name: string; manual_seconds: number }) => [x.name, x.manual_seconds]));
    expect(w).toEqual({ Walt: 5 * 3600, Bea: 3600 });
    expect(r.body.tasks).toEqual([expect.objectContaining({ title: 'Homepage', estimate_seconds: 4 * 3600, tracked_seconds: 2 * 3600, assignees: ['Walt'] })]);
    expect(r.body.projects.find((p: { name: string }) => p.name === 'Website').budget).toEqual({ amount_seconds: 10 * 3600, used_seconds: 3 * 3600, pct_used: 30 });
  });

  it('never includes money, and activity stays hidden while that section is off', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    // Website has an HOURS budget and Mobile app has a MONEY budget (plus a BILL rate on Website) —
    // none of that should be able to leak into the client-facing JSON.
    expect(JSON.stringify(r.body)).not.toMatch(/amount_minor|rate|invoice|bill_|pay_|currency/);
    expect(r.body.workers.every((x: { activity_pct: number | null }) => x.activity_pct === null)).toBe(true);
    // The only budget shown for Website is the HOURS one; Mobile app's MONEY budget is filtered out entirely.
    expect(r.body.projects.find((p: { name: string }) => p.name === 'Website').budget).toEqual({ amount_seconds: 36000, used_seconds: 3 * 3600, pct_used: 30 });
    expect(r.body.projects.find((p: { name: string }) => p.name === 'Mobile app').budget).toBeNull();
  });

  it('respects the project selection and hides sections that are off', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [appId], sections: { tasks: false } });
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Mobile app']);
    expect(r.body.tasks).toBeNull();
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: null, sections: { tasks: true } });
  });

  it('is closed to other users, revoked viewers and disabled portals, and is audited', async () => {
    expect((await bea.client.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: false });
    expect((await dora.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    expect((await dora.get('/me')).body.client_portals).toEqual([]);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true });
    const audit = await admin.get(o('/audit-logs?action=client_portal.viewed'));
    expect(audit.body.some((a: { actor_type: string }) => a.actor_type === 'client')).toBe(true);
  });

  it('answers a malformed accessId exactly like an unknown one (404, not a 500)', async () => {
    expect((await dora.get(`/portal/not-a-uuid/summary${range}`)).status).toBe(404);
  });

  it('closes access immediately when a viewer is revoked', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'ed@acme.test', name: 'Ed' });
    const ed = new Client(t);
    const acc = await ed.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url), name: 'Ed', password: PASSWORD });
    expect(acc.status).toBe(200);
    const edAccessId = acc.body.access_id;
    expect((await ed.get(`/portal/${edAccessId}/summary${range}`)).status).toBe(200);
    expect((await admin.del(o(`/clients/${clientId}/portal/access/${edAccessId}`))).status).toBe(204);
    expect((await ed.get(`/portal/${edAccessId}/summary${range}`)).status).toBe(404);
    expect((await ed.get('/me')).body.client_portals).toEqual([]);
  });

  it('lets admins preview exactly what the client sees', async () => {
    const p = await admin.get(o(`/clients/${clientId}/portal/preview${range}`));
    const v = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect({ ...p.body, access_id: null }).toEqual({ ...v.body, access_id: null });
  });

  it('writes no client audit row for an admin preview', async () => {
    const clientViews = async () => (await admin.get(o('/audit-logs?action=client_portal.viewed'))).body.filter((a: { actor_type: string }) => a.actor_type === 'client').length;
    const before = await clientViews();
    expect((await admin.get(o(`/clients/${clientId}/portal/preview${range}`))).status).toBe(200);
    expect(await clientViews()).toBe(before);
  });

  it('reflects the activity section flag', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { activity: true } });
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.body.sections.activity).toBe(true);
    // The fixture only has manual time (no desktop activity tracking), so every worker's
    // activityTrackedSeconds is 0 and activity_pct stays null even with the section on.
    // A numeric activity_pct needs tracked desktop activity minutes, which Task 6 adds —
    // a later test should cover the on-and-populated case once that data exists.
    expect(r.body.workers.every((x: { activity_pct: number | null }) => x.activity_pct === null)).toBe(true);
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { activity: false } });
  });

  it('is isolated across organizations', async () => {
    const { client: zedAdmin, orgId: zedOrg } = await signup(t, 'Zed', 'zed@portal.test');
    expect((await dora.get(`/portal/${newId()}/summary${range}`)).status).toBe(404);
    expect((await zedAdmin.get(`/orgs/${zedOrg}/clients/${clientId}/portal`)).status).toBe(404);
  });
});

describe('portal screenshots', () => {
  let shotOnClient: string;
  // Pinned to a fixed mid-day New York instant (11:00 EDT) instead of the real wall clock: the org
  // timezone is America/New_York, and `time_entries.local_date` is computed in that zone, while a
  // real-clock run near 00:00–04:00 UTC (or one that straddles New York midnight mid-test) would
  // put the derived time entry on a different calendar date than a UTC-sliced `today()`, or split
  // the session across two local dates. A fixed instant makes the local date deterministic.
  const localDate = '2026-10-06';
  beforeAll(async () => {
    t.clock.set(new Date('2026-10-06T15:00:00Z')); // 11:00 America/New_York (EDT)
    await admin.put(o(`/policies/ORG/${orgId}`), { screenshots: { enabled: true, perTenMinutes: 1 } });
    const { verifier, challenge } = pkce();
    const code = await walt.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
    const session = newId();
    const start = new Date(t.clock.now);
    const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
    await agent.post('/agent/ingest/batch', { sent_at: at(0), events: [{ event_id: newId(), type: 'session.start', session_id: session, seq: 1, occurred_at: at(0), project_id: siteId }] });
    t.clock.advance(5 * 60_000);
    shotOnClient = newId();
    const intent = await agent.post('/agent/screenshots/upload-intent', { screenshot_id: shotOnClient, session_id: session, captured_at: at(5 * 60_000), content_type: 'image/webp', bytes: 4 });
    await agent.post('/agent/ingest/batch', {
      sent_at: at(5 * 60_000),
      events: [
        { event_id: newId(), type: 'activity.minutes', session_id: session, occurred_at: at(5 * 60_000), minutes: [{ minute_start: at(60_000), keyboard: 30, mouse: 20, active_seconds: 45, tracked_seconds: 60 }] },
        { event_id: newId(), type: 'screenshot.captured', session_id: session, occurred_at: at(5 * 60_000), screenshot_id: shotOnClient, captured_at: at(5 * 60_000), display_index: 0, blurred: false, width: 1920, height: 1080, bytes: 4, sha256: 'a'.repeat(64), storage_key: intent.body.storage_key },
      ],
    });
    t.clock.advance(10 * 60_000);
    await agent.post('/agent/ingest/batch', { sent_at: at(15 * 60_000), events: [{ event_id: newId(), type: 'session.stop', session_id: session, seq: 2, occurred_at: at(15 * 60_000) }] });
    await t.flush();
  });

  it('is refused while the section is off', async () => {
    expect((await dora.get(`/portal/${doraAccessId}/screenshots?from=${localDate}&to=${localDate}`)).status).toBe(403);
  });

  it('shows screenshots from time on the client’s projects, with signed media links, and logs the view', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { screenshots: true } });
    const r = await dora.get(`/portal/${doraAccessId}/screenshots?from=${localDate}&to=${localDate}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ id: shotOnClient, worker_name: 'Walt', project_id: siteId, full_url: expect.stringMatching(/\/api\/v1\/media\//) })]);
    const log = await admin.get(o('/audit-logs?action=client_portal.screenshots_viewed'));
    expect(log.body[0]).toMatchObject({ actor_type: 'client' });
  });

  it('lets admins preview the same screenshots the client sees, without adding a client audit row', async () => {
    // Fetch the viewer's copy first (this call itself logs a client audit row — expected and
    // untested here), then bracket only the preview call with the before/after audit count.
    const v = await dora.get(`/portal/${doraAccessId}/screenshots?from=${localDate}&to=${localDate}`);
    const clientViews = async () => (await admin.get(o('/audit-logs?action=client_portal.screenshots_viewed'))).body.filter((a: { actor_type: string }) => a.actor_type === 'client').length;
    const before = await clientViews();
    const p = await admin.get(o(`/clients/${clientId}/portal/preview/screenshots?from=${localDate}&to=${localDate}`));
    expect(p.status).toBe(200);
    expect(p.body.map((s: { id: string }) => s.id)).toEqual(v.body.map((s: { id: string }) => s.id));
    expect(await clientViews()).toBe(before);
  });

  it('never shows them when the project is not included', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [appId] });
    const r = await dora.get(`/portal/${doraAccessId}/screenshots?from=${localDate}&to=${localDate}`);
    expect(r.body).toEqual([]);
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: null, sections: { screenshots: false } });
  });

  it('shows the exact activity_pct once desktop activity minutes exist', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { activity: true } });
    const r = await dora.get(`/portal/${doraAccessId}/summary?from=${localDate}&to=${localDate}`);
    const w = r.body.workers.find((x: { name: string }) => x.name === 'Walt');
    // The fixture sends exactly one activity-minute record (active_seconds: 45, tracked_seconds: 60)
    // for Walt's only session that day, on his only project that day (siteId) — so the rollup's
    // active/tracked totals for this worker-day-project row are exactly 45/60, giving round(45/60*100) = 75.
    expect(w.activity_pct).toBe(75);
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { activity: false } });
  });
});

describe('worker transparency', () => {
  it('tells a worker which clients can see their activity or screenshots', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true, screenshots: false } });
    const r = await walt.client.get(o('/me/client-visibility'));
    expect(r.body).toEqual({ clients: [{ client_name: 'Acme', activity: true, screenshots: false }] });
    const none = await admin.get(o('/me/client-visibility'));
    expect(none.body).toEqual({ clients: [] });
  });

  it("gives a worker's desktop device the same answer as their web login", async () => {
    const { verifier, challenge } = pkce();
    const code = await walt.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const device = new Client(t);
    device.bearer = (await device.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Walt-Laptop', platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
    const web = await walt.client.get(o('/me/client-visibility'));
    const dev = await device.get('/agent/me/client-visibility');
    expect(dev.status).toBe(200);
    expect(dev.body).toEqual(web.body);
  });
});
