import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Organization settings (QA pass, feature 2).
 *
 * - BUG-76: a shorter session lifetime applied only to sign-ins after the change; everyone already signed
 *   in stayed signed in for up to 14 days.
 * - BUG-77: after the organization's currency changed, a member's personal rate was shown in the new
 *   currency, though it is kept (and paid) in the old one.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-21T09:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@settings-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('a shorter session lifetime (BUG-76)', () => {
  it('applies to people already signed in, counted from the change', async () => {
    const { client: pat } = await addMember(t, admin, orgId, 'Pat', 'pat@settings-rules.test');
    expect((await admin.patch(o(''), { settings: { sessionTtlHours: 8 } })).status).toBe(200);
    t.clock.advance(7 * 3600_000);
    expect((await pat.get('/me')).status).toBe(200);
    t.clock.advance(2 * 3600_000);
    expect((await pat.get('/me')).status).toBe(401);
    expect((await admin.get('/me')).status).toBe(401);
  });

  it('a longer one changes nothing for existing sessions', async () => {
    const fresh = new Client(t);
    expect((await fresh.post('/auth/login', { email: 'ada@settings-rules.test', password: 'correct-horse-battery' })).status).toBe(200);
    expect((await fresh.patch(o(''), { settings: { sessionTtlHours: 24 } })).status).toBe(200);
    expect((await fresh.get('/me')).status).toBe(200);
    admin = fresh;
  });
});

describe('a member’s rate after a currency change (BUG-77)', () => {
  it('comes with its own currency', async () => {
    const { membershipId } = await addMember(t, admin, orgId, 'Quin', 'quin@settings-rules.test');
    expect((await admin.patch(o(`/workers/${membershipId}`), { pay_rate_minor: 5000, bill_rate_minor: 9000 })).status).toBe(200);
    expect((await admin.patch(o(''), { currency: 'EUR' })).status).toBe(200);
    const w = (await admin.get<{ pay_rate_minor: number; pay_rate_currency: string; bill_rate_currency: string }>(o(`/workers/${membershipId}`))).body;
    expect([w.pay_rate_minor, w.pay_rate_currency, w.bill_rate_currency]).toEqual([5000, 'USD', 'USD']);
  });
});
