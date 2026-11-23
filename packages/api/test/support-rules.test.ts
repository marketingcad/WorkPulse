import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../src/lib/totp';
import { createHarness, signup, type Client, type Harness } from './harness';

/**
 * Support console (QA pass, feature 25).
 *
 * - BUG-93: the organization search treated "%" and "_" as wildcards: "%%" or "__" listed every
 *   organization (the console shows only 25, in name order).
 * - BUG-94: the details of an organization that does not exist answered 403 "has not granted support
 *   access" instead of 404.
 */
let t: Harness;
let staff: Client;

beforeAll(async () => {
  t = await createHarness();
  t.deps.config.supportStaffEmails = ['sam@tallywork.test'];
  await signup(t, 'Cleo', 'cleo@acme.test', 'Acme Robotics');
  await signup(t, 'Dee', 'dee_ops@beta.test', 'Beta 100% Labs');
  ({ client: staff } = await signup(t, 'Sam', 'sam@tallywork.test', 'Tallywork Staff'));
  const mail = t.mailer.sent.find((m) => m.to === 'sam@tallywork.test')!;
  expect((await staff.post('/auth/verify-email', { token: /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1] })).status).toBe(200);
  const s = await staff.post<{ secret: string }>('/me/mfa/totp/setup', { password: 'correct-horse-battery' });
  expect((await staff.post('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) })).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

const names = async (q: string) => (await staff.get<Array<{ name: string }>>(`/support/orgs?q=${encodeURIComponent(q)}`)).body.map((x) => x.name);

describe('searching organizations (BUG-93)', () => {
  it('takes % and _ as typed, not as wildcards', async () => {
    expect(await names('%%')).toEqual([]);
    expect(await names('__')).toEqual([]);
    expect(await names('100%')).toEqual(['Beta 100% Labs']);
    expect(await names('dee_ops')).toEqual(['Beta 100% Labs']);
    expect(await names('acme')).toEqual(['Acme Robotics']);
  });
});

describe('an organization that does not exist (BUG-94)', () => {
  it('is not found, for the overview and the details', async () => {
    const ghost = '01900000-0000-7000-8000-000000000094';
    expect((await staff.get(`/support/orgs/${ghost}`)).status).toBe(404);
    expect((await staff.get(`/support/orgs/${ghost}/details`)).status).toBe(404);
  });
});
