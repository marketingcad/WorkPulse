import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * End-to-end business flow (docs/plan/07-roadmap.md Phase 7 acceptance):
 * org → worker → client → project → task → agent → tracking → activity → idle →
 * screenshot → apps → stop → timesheet → submit → approve → billing → invoice → payment → report.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
let taskId: string;
let clientId: string;
let agent: Client;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
const RANGE = () => `from=${day(-30)}&to=${day(30)}`;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', 'ada@example.com', 'Acme Studio'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt Worker', 'walt@example.com'));
});
afterAll(() => t.close());

describe('workspace setup', () => {
  it('returns the org context and grants', async () => {
    const r = await admin.get(`/orgs/${orgId}`);
    expect(r.status).toBe(200);
    expect(r.body.organization.name).toBe('Acme Studio');
    expect(r.body.membership.role_key).toBe('SYSTEM_ADMIN');
    expect(r.body.grants['invoices:manage']).toBe('org');
  });

  it('creates client, project with member, task and a bill + pay rate', async () => {
    const c = await admin.post(`/orgs/${orgId}/clients`, { name: 'Globex', email: 'ap@globex.test', currency: 'USD' });
    expect(c.status).toBe(201);
    clientId = c.body.id;
    const p = await admin.post(`/orgs/${orgId}/projects`, { name: 'Website Redesign', client_id: clientId, member_ids: [workerId], billable_default: true });
    expect(p.status).toBe(201);
    projectId = p.body.id;
    const tk = await admin.post(`/orgs/${orgId}/projects/${projectId}/tasks`, { title: 'Landing page', assignee_ids: [workerId] });
    expect(tk.status).toBe(201);
    taskId = tk.body.id;
    expect((await admin.post(`/orgs/${orgId}/rates`, { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 12000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
    expect((await admin.post(`/orgs/${orgId}/rates`, { kind: 'PAY', scope: 'WORKER', scope_id: workerId, amount_minor: 4000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
    // Screenshots + apps on for this org
    expect((await admin.put(`/orgs/${orgId}/policies/ORG/${orgId}`, { screenshots: { enabled: true, perTenMinutes: 1 }, urls: { enabled: true } })).status).toBe(200);
  });

  it('shows the worker only their assigned projects', async () => {
    const a = await worker.get(`/orgs/${orgId}/me/assignments`);
    expect(a.body.map((p: { project_id: string }) => p.project_id)).toEqual([projectId]);
    expect(a.body[0].tasks[0].id).toBe(taskId);
    const w = await worker.get(`/orgs/${orgId}/workers`);
    expect(w.body.map((x: { id: string }) => x.id)).toEqual([workerId]);
  });
});

describe('web timer', () => {
  it('starts, reports current state, and stops idempotently', async () => {
    const s = await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId, task_id: taskId });
    expect(s.status).toBe(200);
    expect(s.body.session.state).toBe('ACTIVE');
    t.clock.advance(30 * 60_000);
    const cur = await worker.get(`/orgs/${orgId}/tracking/current`);
    expect(cur.body.session.source).toBe('WEB');
    expect(cur.body.today_seconds).toBeGreaterThanOrEqual(30 * 60 - 1);
    const st = await worker.post(`/orgs/${orgId}/tracking/stop`);
    expect(st.body.session).toBeNull();
    expect((await worker.post(`/orgs/${orgId}/tracking/stop`)).status).toBe(200);
    const entries = await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`);
    expect(entries.body).toHaveLength(1);
    expect(entries.body[0].duration_seconds).toBe(1800);
    expect(entries.body[0].tracking_source).toBe('WEB');
  });

  it('rejects tracking to a project the worker is not assigned to', async () => {
    const other = await admin.post(`/orgs/${orgId}/projects`, { name: 'Secret' });
    const r = await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: other.body.id });
    expect(r.status).toBe(403);
  });
});

describe('desktop agent', () => {
  let sessionId: string;
  let accessToken: string;
  let refreshToken: string;

  it('authorizes with PKCE and registers the device', async () => {
    const { verifier, challenge } = pkce();
    const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    expect(code.status).toBe(200);
    agent = new Client(t);
    const bad = await agent.post('/agent/register', { code: code.body.code, code_verifier: pkce().verifier, device: { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0' } });
    expect(bad.status).toBe(401);
    const code2 = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const reg = await agent.post('/agent/register', { code: code2.body.code, code_verifier: verifier, device: { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0', capabilities: { screenshots: true } } });
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('ACTIVE');
    accessToken = reg.body.access_token;
    refreshToken = reg.body.refresh_token;
    agent.bearer = accessToken;
    // Replaying the code fails.
    expect((await new Client(t).post('/agent/register', { code: code2.body.code, code_verifier: verifier, device: { name: 'x', platform: 'linux', agent_version: '0.1.0' } })).status).toBe(401);
  });

  it('boots with policy and assignments and cannot read org data', async () => {
    const b = await agent.get('/agent/bootstrap');
    expect(b.status).toBe(200);
    expect(b.body.policy.screenshots.enabled).toBe(true);
    expect(b.body.assignments[0].project_id).toBe(projectId);
    expect((await agent.get(`/orgs/${orgId}/workers`)).status).toBe(403);
    expect((await agent.post('/agent/policy/ack', { hash: b.body.policy_hash })).status).toBe(204);
  });

  it('ingests a tracking session idempotently with activity, idle, apps, urls and a screenshot', async () => {
    sessionId = newId();
    const t0 = new Date(t.clock.now.getTime());
    const iso = (ms: number) => new Date(t0.getTime() + ms).toISOString();
    const startEvt = { event_id: newId(), type: 'session.start', session_id: sessionId, seq: 1, occurred_at: iso(0), project_id: projectId, task_id: taskId };
    t.clock.advance(20 * 60_000);
    const minutes = Array.from({ length: 20 }, (_, i) => ({ minute_start: iso(i * 60_000), keyboard: 50, mouse: 30, active_seconds: i < 10 ? 60 : 30, tracked_seconds: 60 }));
    const r1 = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [
        startEvt,
        { event_id: newId(), type: 'activity.minutes', session_id: sessionId, occurred_at: iso(20 * 60_000), minutes },
        { event_id: newId(), type: 'app.spans', session_id: sessionId, occurred_at: iso(20 * 60_000), spans: [{ span_id: newId(), app_name: 'Code', app_id: 'code.exe', started_at: iso(0), ended_at: iso(15 * 60_000) }, { span_id: newId(), app_name: 'Chrome', started_at: iso(15 * 60_000), ended_at: iso(20 * 60_000) }] },
        { event_id: newId(), type: 'url.spans', session_id: sessionId, occurred_at: iso(20 * 60_000), spans: [{ span_id: newId(), domain: 'github.com', url: 'https://github.com/acme/site?token=secret', started_at: iso(15 * 60_000), ended_at: iso(20 * 60_000) }] },
      ],
    });
    expect(r1.status).toBe(200);
    expect(r1.body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(r1.body.session.id).toBe(sessionId);

    // Replaying the same batch creates nothing new.
    const again = await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [startEvt] });
    expect(again.body.results[0].status).toBe('duplicate');

    // Screenshot: upload intent → upload (dev path) → captured event
    const shotId = newId();
    const intent = await agent.post('/agent/screenshots/upload-intent', { screenshot_id: shotId, session_id: sessionId, captured_at: iso(5 * 60_000), content_type: 'image/webp', bytes: 4 });
    expect(intent.status).toBe(200);
    expect(intent.body.method).toBe('api');
    const up = await agent.req('PUT', intent.body.upload_url.replace('/api/v1', ''), new Uint8Array([1, 2, 3, 4]), { 'Content-Type': 'image/webp' });
    expect(up.status).toBe(204);
    const cap = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [{ event_id: newId(), type: 'screenshot.captured', session_id: sessionId, occurred_at: iso(5 * 60_000), screenshot_id: shotId, captured_at: iso(5 * 60_000), display_index: 0, blurred: false, width: 1920, height: 1080, bytes: 4, sha256: 'a'.repeat(64), storage_key: intent.body.storage_key }],
    });
    expect(cap.body.results[0].status).toBe('accepted');
    // A forged key outside the worker's prefix is rejected.
    const forged = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [{ event_id: newId(), type: 'screenshot.captured', session_id: sessionId, occurred_at: iso(6 * 60_000), screenshot_id: newId(), captured_at: iso(6 * 60_000), display_index: 0, blurred: false, width: 1, height: 1, bytes: 1, sha256: 'b'.repeat(64), storage_key: `org/${orgId}/screenshots/someone-else/x.webp` }],
    });
    expect(forged.body.results[0].status).toBe('rejected');
  });

  it('handles idle (prompt policy): discarding removes the idle span from time', async () => {
    const base = t.clock.now.getTime();
    const idleId = newId();
    t.clock.advance(15 * 60_000); // 20..35 min; idle 25..32
    const r = await agent.post('/agent/ingest/batch', {
      sent_at: t.clock.now.toISOString(),
      events: [
        { event_id: newId(), type: 'idle.started', session_id: sessionId, occurred_at: new Date(base + 5 * 60_000).toISOString(), idle_id: idleId, started_at: new Date(base + 5 * 60_000).toISOString() },
        { event_id: newId(), type: 'idle.resolved', session_id: sessionId, occurred_at: new Date(base + 12 * 60_000).toISOString(), idle_id: idleId, started_at: new Date(base + 5 * 60_000).toISOString(), ended_at: new Date(base + 12 * 60_000).toISOString(), resolution: 'DISCARDED' },
        { event_id: newId(), type: 'session.stop', session_id: sessionId, seq: 2, occurred_at: t.clock.now.toISOString() },
      ],
    });
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(r.body.session).toBeNull();
    const entries = await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`);
    const desktop = entries.body.filter((e: { session_id: string }) => e.session_id === sessionId);
    const total = desktop.reduce((s: number, e: { duration_seconds: number }) => s + e.duration_seconds, 0);
    expect(total).toBe((35 - 7) * 60); // 35 minutes tracked minus 7 minutes idle
    const rev = await worker.get(`/orgs/${orgId}/time-entries/${desktop[0].id}/revisions`);
    expect(rev.body[0].action).toBe('CREATE');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const r1 = await new Client(t).post('/agent/token', { refresh_token: refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await new Client(t).post('/agent/token', { refresh_token: refreshToken });
    expect(reuse.status).toBe(401);
    // The whole family is revoked after reuse.
    expect((await new Client(t).post('/agent/token', { refresh_token: r1.body.refresh_token })).status).toBe(401);
  });

  it('builds the activity day view and apps/url usage after dispatch', async () => {
    await t.flush();
    const today = new Date(t.clock.now.getTime()).toLocaleDateString('en-CA', { timeZone: 'UTC' });
    const day = await admin.get(`/orgs/${orgId}/activity/day?membership_id=${workerId}&date=${new Date(t.clock.now.getTime() - 40 * 60_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}`);
    expect(day.status).toBe(200);
    expect(day.body.blocks.length).toBeGreaterThan(0);
    expect(day.body.blocks.some((b: { screenshots: unknown[] }) => b.screenshots.length === 1)).toBe(true);
    expect(day.body.apps.map((a: { name: string }) => a.name)).toContain('Code');
    expect(day.body.urls[0].name).toBe('github.com');
    const shot = day.body.blocks.find((b: { screenshots: unknown[] }) => b.screenshots.length)!.screenshots[0];
    const media = await t.app.request(shot.full_url);
    expect(media.status).toBe(200);
    expect(await media.arrayBuffer()).toHaveProperty('byteLength', 4);
    void today;
  });
});

describe('timesheets → billing → invoice → payment', () => {
  let timesheetId: string;
  it('worker submits; entries lock; admin approves and billing entries are priced', async () => {
    const today = t.clock.now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const ts = await worker.get(`/orgs/${orgId}/timesheets?date=${today}`);
    expect(ts.body.status).toBe('DRAFT');
    expect(ts.body.total_seconds).toBeGreaterThan(0);
    const sub = await worker.post(`/orgs/${orgId}/timesheets/submit`, { date: today });
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('SUBMITTED');
    timesheetId = sub.body.id;
    const entry = (await worker.get(`/orgs/${orgId}/time-entries?${RANGE()}`)).body[0];
    expect(entry.locked).toBe(true);
    const edit = await worker.patch(`/orgs/${orgId}/time-entries/${entry.id}`, { note: 'x', reason: 'fix' });
    expect(edit.status).toBe(422);
    // Worker cannot approve.
    expect((await worker.post(`/orgs/${orgId}/timesheets/${timesheetId}/approve`, {})).status).toBe(403);
    const queue = await admin.get(`/orgs/${orgId}/timesheets/approvals`);
    expect(queue.body.map((q: { timesheet_id: string }) => q.timesheet_id)).toContain(timesheetId);
    const ap = await admin.post(`/orgs/${orgId}/timesheets/${timesheetId}/approve`, {});
    expect(ap.status).toBe(200);
    expect(ap.body.status).toBe('APPROVED');
    await t.flush();
    const notes = await worker.get(`/orgs/${orgId}/notifications`);
    expect(notes.body.data.some((n: { type: string }) => n.type === 'timesheet.approved')).toBe(true);
  });

  it('creates an invoice from approved billable time that reconciles to the rate', async () => {
    const today = t.clock.now.toISOString().slice(0, 10);
    const input = { client_id: clientId, period_start: '2000-01-01', period_end: '2100-01-01', issue_date: today, due_date: '2100-01-01', tax_rate_bps: 1000 };
    const pre = await admin.post(`/orgs/${orgId}/invoices/preview`, input);
    expect(pre.status).toBe(200);
    const totalSeconds = (await admin.get(`/orgs/${orgId}/time-entries?${RANGE()}`)).body.reduce((s: number, e: { duration_seconds: number }) => s + e.duration_seconds, 0);
    const expected = Math.round((totalSeconds * 12000) / 3600);
    expect(Math.abs(pre.body.subtotal_minor - expected)).toBeLessThanOrEqual(2);
    const inv = await admin.post(`/orgs/${orgId}/invoices`, input);
    expect(inv.status).toBe(201);
    expect(inv.body.number).toBe('INV-1001');
    expect(inv.body.tax_minor).toBe(Math.round(inv.body.subtotal_minor * 0.1));
    // Nothing left to invoice.
    expect((await admin.post(`/orgs/${orgId}/invoices`, input)).status).toBe(422);
    // Cannot reopen an invoiced timesheet.
    expect((await admin.post(`/orgs/${orgId}/timesheets/${timesheetId}/reopen`, {})).status).toBe(422);
    const sent = await admin.post(`/orgs/${orgId}/invoices/${inv.body.id}/send`);
    expect(sent.body.status).toBe('SENT');
    expect(t.mailer.sent.some((m) => m.to === 'ap@globex.test')).toBe(true);
    const pdf = await t.app.request(`/api/v1/orgs/${orgId}/invoices/${inv.body.id}/pdf`, { headers: { Cookie: admin.cookie } });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const pay = await admin.post(`/orgs/${orgId}/payments`, { client_id: clientId, amount_minor: inv.body.total_minor, currency: 'USD', received_on: today, allocations: [{ invoice_id: inv.body.id, amount_minor: inv.body.total_minor }] });
    expect(pay.status).toBe(201);
    expect((await admin.get(`/orgs/${orgId}/invoices/${inv.body.id}`)).body.status).toBe('PAID');
  });

  it('runs reports and exports CSV', async () => {
    const cat = await admin.get(`/orgs/${orgId}/reports`);
    expect(cat.body.length).toBeGreaterThanOrEqual(17);
    const r = await admin.post(`/orgs/${orgId}/reports/time-activity/query`, { from: '2000-01-01', to: '2100-01-01', group_by: ['worker', 'project'] });
    expect(r.status).toBe(200);
    expect(r.body.rows[0].worker).toBe('Walt Worker');
    expect(r.body.totals.total).toBeGreaterThan(0);
    const pr = await admin.post(`/orgs/${orgId}/reports/payroll/query`, { from: '2000-01-01', to: '2100-01-01' });
    expect(pr.body.rows[0].approval).toBe('APPROVED');
    expect(pr.body.rows[0].earnings).toBeGreaterThan(0);
    const csv = await t.app.request(`/api/v1/orgs/${orgId}/reports/time-activity/export`, { method: 'POST', headers: { Cookie: admin.cookie, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ from: '2000-01-01', to: '2100-01-01', format: 'CSV' }) });
    const text = await csv.text();
    expect(text).toContain('Member,Project');
    expect(text).toContain('Walt Worker');
    // Workers cannot run finance reports.
    expect((await worker.post(`/orgs/${orgId}/reports/payroll/query`, { from: '2000-01-01', to: '2100-01-01' })).status).toBe(403);
  });

  it('serves dashboard widgets per role', async () => {
    const a = await admin.get(`/orgs/${orgId}/dashboard/widgets?keys=worked_today,tracked_week,timesheets_to_approve,invoices,active_workers`);
    expect(a.status).toBe(200);
    expect(a.body.invoices.outstanding_minor).toBe(0);
    expect(a.body.active_workers.total).toBeGreaterThanOrEqual(1);
    const w = await worker.get(`/orgs/${orgId}/dashboard/widgets?keys=current_timer,tracked_week,invoices&scope=ME`);
    expect(w.body.invoices).toBeUndefined();
    expect(w.body.tracked_week.seconds).toBeGreaterThan(0);
  });
});

describe('audit', () => {
  it('records sensitive actions', async () => {
    const logs = await admin.get(`/orgs/${orgId}/audit-logs`);
    const actions = logs.body.map((l: { action: string }) => l.action);
    for (const a of ['timesheet.approved', 'invoice.created', 'rate.set', 'policy.updated', 'device.registered', 'activity.viewed']) expect(actions).toContain(a);
    expect((await worker.get(`/orgs/${orgId}/audit-logs`)).status).toBe(403);
  });

  it('pages through entries with a total when asked for a page', async () => {
    const all: Array<{ id: string; action: string }> =(await admin.get(`/orgs/${orgId}/audit-logs?limit=1000`)).body;
    expect(all.length).toBeGreaterThan(4);
    const size = 3;
    const first = await admin.get(`/orgs/${orgId}/audit-logs?page=1&page_size=${size}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: all.length, page: 1, page_size: size });
    expect(first.body.data).toHaveLength(size);

    // Walking every page returns each entry exactly once, newest first, matching the unpaged list.
    const seen: string[] = [];
    for (let p = 1; p <= Math.ceil(all.length / size); p++) seen.push(...(await admin.get(`/orgs/${orgId}/audit-logs?page=${p}&page_size=${size}`)).body.data.map((r: { id: string }) => r.id));
    expect(seen).toEqual(all.map((r) => r.id));

    const past = await admin.get(`/orgs/${orgId}/audit-logs?page=${Math.ceil(all.length / size) + 1}&page_size=${size}`);
    expect(past.body).toMatchObject({ data: [], total: all.length });

    const oldest = await admin.get(`/orgs/${orgId}/audit-logs?page=1&page_size=1&order=asc`);
    expect(oldest.body.data[0].id).toBe(all.at(-1)!.id);

    const filtered = await admin.get(`/orgs/${orgId}/audit-logs?page=1&page_size=50&action=invoice.`);
    expect(filtered.body.total).toBe(all.filter((r) => r.action.startsWith('invoice.')).length);
    expect(filtered.body.data.every((r: { action: string }) => r.action.startsWith('invoice.'))).toBe(true);

    expect((await admin.get(`/orgs/${orgId}/audit-logs?page=0`)).status).toBe(400);
    expect((await admin.get(`/orgs/${orgId}/audit-logs?page=1&page_size=500`)).status).toBe(400);
    expect((await worker.get(`/orgs/${orgId}/audit-logs?page=1`)).status).toBe(403);
  });
});
