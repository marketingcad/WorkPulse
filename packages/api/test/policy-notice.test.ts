import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * When tracking settings change, workers are told, but the notice no longer links to the web's
 * "What is monitored" page: workers use the desktop app only and cannot open it.
 */
let t: Harness;
let admin: Client;
let worker: Client;
let orgId: string;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@notice.test'));
  ({ client: worker } = await addMember(t, admin, orgId, 'Walt', 'walt@notice.test'));
});
afterAll(() => t.close());

describe('tracking settings changed', () => {
  it('tells tracked members, with no link to a page they cannot open', async () => {
    expect((await admin.put(`/orgs/${orgId}/policies/ORG/${orgId}`, { screenshots: { enabled: true, perTenMinutes: 1 } })).status).toBe(200);
    await t.flush();
    const list = (await worker.get(`/orgs/${orgId}/notifications`)).body.data as Array<{ type: string; title: string; body: string | null; link: string | null }>;
    const notice = list.find((n) => n.type === 'policy.changed');
    expect(notice).toMatchObject({ title: 'Tracking settings were updated', body: 'Your organization changed what is tracked on your devices.', link: null });
  });
});
