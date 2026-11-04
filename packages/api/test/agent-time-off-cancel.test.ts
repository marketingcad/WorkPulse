import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/** Cancelling time off from the desktop app (UX remediation, phase 4): only the worker's own requests. */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function deviceFor(member: Client) {
  const { verifier, challenge } = pkce();
  const code = await member.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  const reg = await agent.post<{ access_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.1.9' } });
  agent.bearer = reg.body.access_token;
  return agent;
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@cancel.test'));
}, 60_000);
afterAll(() => t.close());

describe('cancelling time off from the desktop app', () => {
  it('cancels the worker’s own request, and nobody else’s', async () => {
    const walt = await addMember(t, admin, orgId, 'Walt', 'walt@cancel.test');
    const mia = await addMember(t, admin, orgId, 'Mia', 'mia@cancel.test', 'SYSTEM_ADMIN');
    const policy = (await admin.post<{ id: string }>(o('/time-off/policies'), { name: 'Leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: true })).body.id;
    const own = (await walt.client.post<{ id: string }>(o('/time-off/requests'), { policy_id: policy, start_date: '2027-06-07', end_date: '2027-06-07', half_day: false })).body.id;

    // Even an admin's device cannot cancel someone else's request through the worker's own route.
    const miaDevice = await deviceFor(mia.client);
    expect((await miaDevice.post(`/agent/me/time-off/${own}/cancel`)).status).toBe(404);

    const waltDevice = await deviceFor(walt.client);
    expect((await waltDevice.post(`/agent/me/time-off/${own}/cancel`)).status).toBe(204);
    const mine = await waltDevice.get<{ requests: Array<{ id: string; status: string }> }>('/agent/me/time-off');
    expect(mine.body.requests.find((x) => x.id === own)?.status).toBe('CANCELLED');
    // Closed requests cannot be cancelled again (said plainly).
    expect((await waltDevice.post<{ code: string }>(`/agent/me/time-off/${own}/cancel`)).body.code).toBe('already_closed');
  });
});
