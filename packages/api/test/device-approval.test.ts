import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// "Approve new devices" (audit of 16 October 2026): a device waiting for approval can only learn its
// status. It cannot send time or screenshots, or read the worker's own data such as pay stubs.

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function newDevice() {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  const reg = await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'linux', agent_version: '0.1.9' } });
  expect(reg.status).toBe(201);
  agent.bearer = reg.body.access_token;
  return agent;
}

const startEvent = () => ({ sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.start', session_id: newId(), seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }] });

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@devices.test'));
  const m = await addMember(t, admin, orgId, 'Walt', 'walt@devices.test');
  worker = m.client;
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [m.membershipId] })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('approve new devices', () => {
  it('without the setting, a new device works straight away', async () => {
    const agent = await newDevice();
    expect((await agent.get('/agent/bootstrap')).body.device.status).toBe('ACTIVE');
    const r = await agent.post('/agent/ingest/batch', startEvent());
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).not.toBe('rejected');
    await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.stop', session_id: r.body.session.id, seq: 2, occurred_at: t.clock.now.toISOString() }] });
  });

  it('with it, a pending device can only check its status until an administrator approves it', async () => {
    expect((await admin.patch(o(''), { settings: { requireDeviceApproval: true } })).status).toBe(200);
    const agent = await newDevice();

    // Allowed: knowing where it stands.
    const boot = await agent.get('/agent/bootstrap');
    expect([boot.status, boot.body.device.status]).toEqual([200, 'PENDING']);
    expect((await agent.post('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: null })).status).toBe(200);

    // Refused with 403 (the app stays signed in and keeps the time on the computer).
    // Before the fix all of these worked for a pending device.
    const refused: Array<[string, string, unknown?]> = [
      ['POST', '/agent/ingest/batch', startEvent()],
      ['POST', '/agent/screenshots/upload-intent', { screenshot_id: newId(), bytes: 100, content_type: 'image/jpeg' }],
      ['GET', '/agent/me/summary'],
      ['GET', '/agent/me/pay-stubs'],
      ['GET', '/agent/me/timesheet'],
      ['GET', '/agent/me/time-off'],
    ];
    for (const [method, path, body] of refused) {
      const r = await agent.req(method, path, body);
      expect([path, r.status, (r.body as { code?: string }).code]).toEqual([path, 403, 'device_pending']);
    }
    // The heartbeat did not approve it.
    expect((await agent.get('/agent/bootstrap')).body.device.status).toBe('PENDING');

    // Approved: everything works.
    const deviceId = boot.body.device.id as string;
    expect((await admin.post(o(`/devices/${deviceId}/approve`))).status).toBe(200);
    expect((await agent.post('/agent/ingest/batch', startEvent())).status).toBe(200);
    expect((await agent.get('/agent/me/pay-stubs')).status).toBe(200);
  });
});
