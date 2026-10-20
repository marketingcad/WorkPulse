import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let other: Client;
let otherId: string;
let agent: Client;
let coffee: string;
let lunch: string;
let projectId: string;

// Reports are dated in the worker's time zone (America/New_York here); the clock is pinned to a
// morning there, so the tests' clock advances (a few hours) never cross midnight in either zone.
const DAY = '2026-09-15';
const today = () => DAY;

async function deviceFor(c: Client) {
  const { verifier, challenge } = pkce();
  const code = await c.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const d = new Client(t);
  const reg = await d.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'windows', agent_version: '0.1.8' } });
  d.bearer = reg.body.access_token;
  return d;
}

const ingest = (events: unknown[]) => agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date(`${DAY}T13:00:00Z`)); // 09:00 in New York
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@breaks.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@breaks.test'));
  ({ client: other, membershipId: otherId } = await addMember(t, admin, orgId, 'Olive', 'olive@breaks.test'));
  coffee = (await admin.post(`/orgs/${orgId}/break-types`, { name: 'Coffee', paid: true, max_minutes: 15 })).body.id;
  lunch = (await admin.post(`/orgs/${orgId}/break-types`, { name: 'Lunch', paid: false, max_minutes: 60 })).body.id;
  agent = await deviceFor(worker);
});
afterAll(() => t.close());

describe('project breaks', () => {
  it('an admin sets a project’s breaks in order; the length falls back to the break type’s maximum', async () => {
    const r = await admin.post(`/orgs/${orgId}/projects`, {
      name: 'Support desk',
      member_ids: [workerId, otherId],
      breaks: [
        { break_type_id: coffee, start_time: '10:30', duration_minutes: 10 },
        { break_type_id: lunch, start_time: '12:00' },
        { break_type_id: coffee, start_time: '15:30', duration_minutes: null },
      ],
    });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    expect(r.body.breaks).toEqual([
      { break_type_id: coffee, name: 'Coffee', paid: true, start_time: '10:30', duration_minutes: 10 },
      { break_type_id: lunch, name: 'Lunch', paid: false, start_time: '12:00', duration_minutes: 60 },
      { break_type_id: coffee, name: 'Coffee', paid: true, start_time: '15:30', duration_minutes: 15 },
    ]);
    expect((await admin.get(`/orgs/${orgId}/projects/${projectId}`)).body.breaks).toHaveLength(3);
  });

  it('editing without `breaks` keeps them; an empty list clears them', async () => {
    const kept = await admin.patch(`/orgs/${orgId}/projects/${projectId}`, { description: 'Tickets' });
    expect(kept.body.breaks).toHaveLength(3);
    const p2 = (await admin.post(`/orgs/${orgId}/projects`, { name: 'Cleared', breaks: [{ break_type_id: lunch }] })).body.id;
    const cleared = await admin.patch(`/orgs/${orgId}/projects/${p2}`, { breaks: [] });
    expect(cleared.body.breaks).toEqual([]);
  });

  it('rejects a bad time, a too-long break, and a break type of another organization or one that is archived', async () => {
    expect((await admin.post(`/orgs/${orgId}/projects`, { name: 'Bad time', breaks: [{ break_type_id: lunch, start_time: '25:00' }] })).status).toBe(400);
    expect((await admin.post(`/orgs/${orgId}/projects`, { name: 'Too long', breaks: [{ break_type_id: lunch, duration_minutes: 9 * 60 }] })).status).toBe(400);
    const { client: outsider, orgId: otherOrg } = await signup(t, 'Oscar', 'oscar@breaks.test');
    const foreign = (await outsider.post(`/orgs/${otherOrg}/break-types`, { name: 'Siesta', paid: false })).body.id;
    const r = await admin.post(`/orgs/${orgId}/projects`, { name: 'Foreign', breaks: [{ break_type_id: foreign }] });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].field).toBe('breaks.0.break_type_id');
    const old = (await admin.post(`/orgs/${orgId}/break-types`, { name: 'Old', paid: false })).body.id;
    await admin.del(`/orgs/${orgId}/break-types/${old}`);
    expect((await admin.post(`/orgs/${orgId}/projects`, { name: 'Archived', breaks: [{ break_type_id: old }] })).status).toBe(400);
  });

  it('a worker cannot change a project’s breaks', async () => {
    expect((await worker.patch(`/orgs/${orgId}/projects/${projectId}`, { breaks: [] })).status).toBe(403);
    expect((await admin.get(`/orgs/${orgId}/projects/${projectId}`)).body.breaks).toHaveLength(3);
  });

  it('the desktop app gets each assigned project’s breaks', async () => {
    const boot = await agent.get('/agent/bootstrap');
    const p = boot.body.assignments.find((a: { project_id: string }) => a.project_id === projectId);
    expect(p.breaks.map((b: { name: string; start_time: string }) => `${b.name} ${b.start_time}`)).toEqual(['Coffee 10:30', 'Lunch 12:00', 'Coffee 15:30']);
  });
});

describe('end-of-day reports', () => {
  it('clocking out with a report keeps it with the session; managers read it, a resend adds nothing', async () => {
    const sid = newId();
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    t.clock.advance(2 * 3600_000);
    const stop = { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString(), report: { text: '  Closed 14 tickets, escalated 2.  ', finished: true } };
    expect((await ingest([stop])).body.results[0].status).toBe('accepted');
    expect((await ingest([stop])).body.results[0].status).toBe('duplicate');

    const list = await admin.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ membership_id: workerId, worker_name: 'Walt', session_id: sid, project_name: 'Support desk', project_color: expect.stringMatching(/^#[0-9a-fA-F]{6}$/), body: 'Closed 14 tickets, escalated 2.', finished: true, worked_seconds: 7200, local_date: today() });
  });

  it('a report sent after an admin already force-stopped the session is still kept', async () => {
    const sid = newId();
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    t.clock.advance(30 * 60_000);
    expect((await admin.post(`/orgs/${orgId}/sessions/${sid}/force-stop`)).status).toBe(200);
    const r = await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString(), report: { text: 'Half day', finished: false } }]);
    expect(r.body.results[0].status).toBe('accepted');
    const list = (await admin.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`)).body;
    expect(list.find((x: { session_id: string }) => x.session_id === sid)).toMatchObject({ body: 'Half day', finished: false, worked_seconds: 1800 });
  });

  it('clocking out without a report saves none; an empty report is rejected', async () => {
    const sid = newId();
    await ingest([{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }]);
    t.clock.advance(60_000);
    const empty = await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString(), report: { text: '   ', finished: false } }]);
    expect(empty.status).toBe(400);
    await ingest([{ event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: t.clock.now.toISOString() }]);
    const list = (await admin.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`)).body;
    expect(list.some((x: { session_id: string }) => x.session_id === sid)).toBe(false);
  });

  it('a worker sees only their own reports; another organization sees none', async () => {
    expect((await worker.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`)).body).toHaveLength(2);
    expect((await other.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`)).body).toEqual([]);
    expect((await other.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}&membership_ids=${workerId}`)).body).toEqual([]);
    const { client: outsider, orgId: otherOrg } = await signup(t, 'Una', 'una@breaks.test');
    expect((await outsider.get(`/orgs/${otherOrg}/eod-reports?from=${today()}&to=${today()}`)).body).toEqual([]);
    expect((await outsider.get(`/orgs/${orgId}/eod-reports?from=${today()}&to=${today()}`)).status).toBe(404);
  });

  it('requires a date range', async () => {
    expect((await admin.get(`/orgs/${orgId}/eod-reports`)).status).toBe(400);
  });
});
