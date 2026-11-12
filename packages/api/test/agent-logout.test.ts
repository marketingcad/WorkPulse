import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Signing out of the desktop app (POST /agent/logout). QA audit 12 Nov 2026 (BUG-15): signing out
 * cleared the sign-in on the computer only; the device stayed "Active" for administrators and its
 * refresh token kept working.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const PASSWORD = 'correct-horse-battery';
const DEVICE = { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0' };

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@logout.test'));
  await addMember(t, admin, orgId, 'Walt Worker', 'walt@logout.test');
});
afterAll(() => t.close());

async function signInDevice() {
  const c = new Client(t);
  const r = await c.post<{ device_id: string; access_token: string; refresh_token: string }>('/agent/login', { email: 'walt@logout.test', password: PASSWORD, device: DEVICE });
  expect(r.status).toBe(201);
  c.bearer = r.body.access_token;
  return { c, deviceId: r.body.device_id, refresh: r.body.refresh_token };
}
const deviceStatus = async (id: string) => (await admin.get<{ data?: Array<{ id: string; status: string }> } | Array<{ id: string; status: string }>>(`/orgs/${orgId}/devices`)).body;
const statusOf = async (id: string) => {
  const b = await deviceStatus(id);
  return (Array.isArray(b) ? b : (b.data ?? [])).find((d) => d.id === id)?.status;
};

describe('desktop sign-out', () => {
  it('ends the device on the server: its tokens stop working and it is no longer active', async () => {
    const { c, deviceId, refresh } = await signInDevice();
    expect(await statusOf(deviceId)).toBe('ACTIVE');

    expect((await c.post('/agent/logout', {})).status).toBe(204);

    expect(await statusOf(deviceId)).toBe('REVOKED');
    // The access token is refused at once, and the refresh token cannot get a new one.
    const after = await c.get<{ code: string }>('/agent/bootstrap');
    expect([after.status, after.body.code]).toEqual([401, 'device_revoked']);
    expect((await new Client(t).post('/agent/token', { refresh_token: refresh })).status).toBe(401);
  });

  it('is recorded as the person signing out, not as an administrator revoking the device', async () => {
    const { c, deviceId } = await signInDevice();
    expect((await c.post('/agent/logout', {})).status).toBe(204);
    type Entry = { action: string; target_id: string | null; actor_type: string };
    const body = (await admin.get<{ data: Entry[] } | Entry[]>(`/orgs/${orgId}/audit-logs?target_id=${deviceId}`)).body;
    const entries = (Array.isArray(body) ? body : body.data).filter((e) => e.target_id === deviceId);
    expect(entries.find((e) => e.action === 'device.signed_out')?.actor_type).toBe('user');
    expect(entries.map((e) => e.action)).not.toContain('device.revoke');
  });

  it('signing in again works, as a new device', async () => {
    const first = await signInDevice();
    expect((await first.c.post('/agent/logout', {})).status).toBe(204);
    const again = await signInDevice();
    expect(again.deviceId).not.toBe(first.deviceId);
    expect((await again.c.get('/agent/bootstrap')).status).toBe(200);
    expect(await statusOf(again.deviceId)).toBe('ACTIVE');
  });

  it('needs a device token: a web session or no credentials cannot use it', async () => {
    expect((await new Client(t).post('/agent/logout', {})).status).toBe(401);
    expect((await admin.post('/agent/logout', {})).status).toBe(401);
  });

  it('only signs out its own device', async () => {
    const a = await signInDevice();
    const b = await signInDevice();
    expect((await a.c.post('/agent/logout', {})).status).toBe(204);
    expect(await statusOf(b.deviceId)).toBe('ACTIVE');
    expect((await b.c.get('/agent/bootstrap')).status).toBe(200);
  });
});
