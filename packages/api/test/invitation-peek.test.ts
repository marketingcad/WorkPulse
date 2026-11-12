import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * QA audit, 11 Nov 2026 (BUG-10): the join page asked for a name the inviter had already entered,
 * and only found out an invitation was invalid, or that the person already had an account, after
 * they had filled it in. POST /auth/invitations/peek tells it first. The token is the invitation's
 * secret, so it goes in the body (paths are logged), and the answer never includes the email.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let workerRole: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
const peek = (token: string) => new Client(t).post('/auth/invitations/peek', { token });
const invite = async (email: string, name?: string) => tokenOf((await admin.post(o('/invitations'), { email, name, role_id: workerRole })).body.invite_url);

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@peek.test', 'Peek Org'));
  workerRole = (await admin.get(o('/roles'))).body.find((r: { key: string }) => r.key === 'WORKER').id;
});
afterAll(() => t.close());

describe('POST /auth/invitations/peek', () => {
  it('gives the name the inviter entered and the organization, never the email', async () => {
    const r = await peek(await invite('maria@peek.test', 'Maria Manager'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ name: 'Maria Manager', organization_name: 'Peek Org', has_account: false });
    expect(JSON.stringify(r.body)).not.toContain('maria@peek.test');
  });

  it('a name the inviter left empty is null', async () => {
    expect((await peek(await invite('noname@peek.test'))).body).toMatchObject({ name: null });
  });

  it('says when the invited email already has an account (sign in first)', async () => {
    await addMember(t, admin, orgId, 'Bea', 'bea@peek.test');
    const other = await signup(t, 'Zed', 'zed@peek.test', 'Other Org');
    const role = (await other.client.get(`/orgs/${other.orgId}/roles`)).body.find((r: { key: string }) => r.key === 'WORKER').id;
    const token = tokenOf((await other.client.post(`/orgs/${other.orgId}/invitations`, { email: 'bea@peek.test', role_id: role })).body.invite_url);
    expect((await peek(token)).body).toMatchObject({ organization_name: 'Other Org', has_account: true });
  });

  it('an unknown, replaced, accepted or expired invitation is refused, like accepting it', async () => {
    const replaced = await invite('again@peek.test', 'Again');
    await invite('again@peek.test', 'Again'); // re-inviting replaces the first link
    const used = await invite('used@peek.test', 'Used');
    expect((await new Client(t).post('/auth/invitations/accept', { token: used, name: 'Used', password: 'correct-horse-battery' })).status).toBe(200);
    const late = await invite('late@peek.test', 'Late');
    t.clock.advance(8 * 86_400_000);
    for (const token of ['x'.repeat(43), replaced, used, late]) {
      const r = await peek(token);
      expect([r.status, r.body.code]).toEqual([422, 'invalid_invitation']);
    }
    t.clock.advance(-8 * 86_400_000);
  });

  it('a malformed token is a validation error', async () => {
    expect((await new Client(t).post('/auth/invitations/peek', {})).status).toBe(400);
  });
});
