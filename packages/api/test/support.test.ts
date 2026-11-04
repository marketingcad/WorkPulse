import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { totpCode } from '../src/lib/totp';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Support console: staff allowlist + 2FA, metadata-only by default, customer-granted read-only
// access that expires, and every staff look written to the customer's audit log.
let t: Harness;
let customer: Client;
let orgId: string;
let worker: Client;
let staff: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

beforeAll(async () => {
  t = await createHarness();
  t.deps.config.supportStaffEmails = ['sam@tallywork.test'];
  ({ client: customer, orgId } = await signup(t, 'Cleo', 'cleo@acme.test', 'Acme Robotics'));
  ({ client: worker } = await addMember(t, customer, orgId, 'Walt', 'walt@acme.test'));
  ({ client: staff } = await signup(t, 'Sam', 'sam@tallywork.test', 'Tallywork Staff'));
  // Staff prove the address by opening the link in the sign-up email (AUTH-005: matching the address is not enough).
  const mail = t.mailer.sent.find((m) => m.to === 'sam@tallywork.test')!;
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  expect((await staff.post('/auth/verify-email', { token })).status).toBe(200);
});
afterAll(() => t.close());

describe('support console', () => {
  it('is invisible to non-staff and needs a two-factor session for staff', async () => {
    expect((await customer.get('/support/orgs?q=acme')).status).toBe(404);
    const r = await staff.get('/support/orgs?q=acme');
    expect([r.status, r.body.title]).toEqual([403, 'The support console needs a session verified with two-factor authentication']);
    const s = await staff.post('/me/mfa/totp/setup', { password: 'correct-horse-battery' });
    expect((await staff.post('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) })).status).toBe(200);
    expect((await staff.get('/support/me')).body).toMatchObject({ email: 'sam@tallywork.test' });
  });

  it('finds organizations by name or owner email and shows metadata only', async () => {
    const byName = (await staff.get('/support/orgs?q=robot')).body;
    const byOwner = (await staff.get('/support/orgs?q=cleo@acme')).body;
    expect(byName.map((x: { id: string }) => x.id)).toEqual([orgId]);
    expect(byOwner.map((x: { id: string }) => x.id)).toEqual([orgId]);
    const ov = (await staff.get(`/support/orgs/${orgId}`)).body;
    expect(ov).toMatchObject({ organization: { name: 'Acme Robotics' }, owner: { email: 'cleo@acme.test' }, members: 2, support_access: null, health: { parked_events: 0 } });
    expect(JSON.stringify(ov)).not.toContain('walt@acme.test'); // no member list without a grant
    const logged = await asOwner<{ actor_type: string; action: string }>(sql`select actor_type, action from audit_logs where organization_id = ${orgId} and actor_type = 'support'`);
    expect(logged.map((l) => l.action)).toContain('support.overview_viewed');
  });

  it('details need a grant from the organization; the grant can be revoked and expires', async () => {
    expect((await staff.get(`/support/orgs/${orgId}/details`)).status).toBe(403);
    expect((await worker.post(o('/support-access'), { hours: 2, reason: 'help' })).status).toBe(403);
    expect((await customer.post(o('/support-access'), { hours: 100, reason: 'help' })).status).toBe(400);
    const g = await customer.post(o('/support-access'), { hours: 2, reason: 'Timesheets look wrong for Walt' });
    expect(g.body).toMatchObject({ active: true, reason: 'Timesheets look wrong for Walt' });
    const d = (await staff.get(`/support/orgs/${orgId}/details`)).body;
    expect(d.members.map((m: { email: string }) => m.email).sort()).toEqual(['cleo@acme.test', 'walt@acme.test']);
    expect(d.audit.some((a: { action: string }) => a.action === 'support.access_granted')).toBe(true);
    expect((await staff.get(`/support/orgs/${orgId}`)).body.support_access).toMatchObject({ reason: 'Timesheets look wrong for Walt' });

    expect((await customer.del(o('/support-access'))).body).toMatchObject({ active: false });
    expect((await staff.get(`/support/orgs/${orgId}/details`)).status).toBe(403);

    await customer.post(o('/support-access'), { hours: 1, reason: 'Again' });
    expect((await staff.get(`/support/orgs/${orgId}/details`)).status).toBe(200);
    t.clock.set(new Date(t.clock.now.getTime() + 61 * 60_000));
    expect((await staff.get(`/support/orgs/${orgId}/details`)).status).toBe(403);

    const trail = await asOwner<{ action: string }>(sql`select action from audit_logs where organization_id = ${orgId} and action like 'support.%' order by created_at`);
    expect(trail.map((x) => x.action)).toEqual(expect.arrayContaining(['support.access_granted', 'support.details_viewed', 'support.access_revoked']));
  });

  it('staff cannot use customer endpoints: they are not members', async () => {
    expect((await staff.get(o('/workers'))).status).toBe(404);
  });
});
