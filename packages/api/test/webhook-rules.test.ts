import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, signup, type Client, type Harness } from './harness';

/**
 * API keys, webhooks and integrations (QA pass, feature 23).
 *
 * - BUG-92: "Send test" on a webhook that does not exist failed on a database error (409 "Something this
 *   refers to no longer exists"); on one that is turned off it answered 200, but the test was never sent
 *   (only enabled endpoints are delivered) and stayed pending. Replaying a delivery did the same.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const ghost = '01900000-0000-7000-8000-000000000092';

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@webhook-rules.test'));
  t.deps.httpPost = async () => ({ status: 200, body: 'ok' });
}, 60_000);
afterAll(() => t.close());

describe('sending a test or a replay (BUG-92)', () => {
  it('to a webhook that does not exist is 404', async () => {
    expect((await admin.post(o(`/webhooks/${ghost}/test`))).status).toBe(404);
    expect((await admin.get(o(`/webhooks/${ghost}/deliveries`))).status).toBe(404);
  });

  it('to one that is turned off is refused, and works once it is on', async () => {
    const w = (await admin.post<{ id: string }>(o('/webhooks'), { url: 'https://93.184.216.34/hook', events: ['*'], enabled: false })).body.id;
    const off = await admin.post<{ code: string }>(o(`/webhooks/${w}/test`));
    expect([off.status, off.body.code]).toEqual([422, 'webhook_disabled']);
    expect((await admin.get<unknown[]>(o(`/webhooks/${w}/deliveries`))).body).toHaveLength(0);

    expect((await admin.patch(o(`/webhooks/${w}`), { url: 'https://93.184.216.34/hook', events: ['*'], enabled: true })).status).toBe(200);
    const sent = await admin.post<{ id: string }>(o(`/webhooks/${w}/test`));
    expect(sent.status).toBe(200);
    // Turned off again: its delivery can't be replayed either.
    expect((await admin.patch(o(`/webhooks/${w}`), { url: 'https://93.184.216.34/hook', events: ['*'], enabled: false })).status).toBe(200);
    expect((await admin.post(o(`/webhooks/${w}/deliveries/${sent.body.id}/replay`))).status).toBe(422);
  });
});
