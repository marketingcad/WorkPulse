import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { totpCode } from '../src/lib/totp';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Sign-in, two-factor and sessions (QA pass, feature 1).
 *
 * - BUG-64: turning two-factor on left every other session (signed in with the password alone) and
 *   every desktop device signed in.
 * - BUG-65: turning two-factor off, or an owner resetting it, left desktop devices signed in.
 * - BUG-66: a password reset link already sent still worked after the password was changed.
 * - BUG-67: when the sign-up email couldn't be sent, the account and organization were made but the
 *   answer was an error, and trying again said the email was taken.
 * - BUG-68: a recovery code typed without its hyphen was refused.
 * - BUG-69: wrong passwords in the two-factor settings didn't count toward the account lockout.
 * - BUG-70: an invitation opened in another account showed the address it was sent to.
 */
const PW = 'correct-horse-battery';
let t: Harness;
let admin: Client;
let orgId: string;

async function device(c: Client) {
  const { verifier, challenge } = pkce();
  const code = await c.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const r = await new Client(t).post<{ refresh_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } });
  return r.body.refresh_token;
}
const deviceWorks = async (refresh: string) => (await new Client(t).post('/agent/token', { refresh_token: refresh })).status === 200;
async function enroll(c: Client) {
  const s = await c.post<{ secret: string }>('/me/mfa/totp/setup', { password: PW });
  expect(s.status).toBe(200);
  t.clock.advance(31_000);
  const r = await c.post<{ recovery_codes: string[] }>('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) });
  expect(r.status).toBe(200);
  return { secret: s.body.secret, recovery: r.body.recovery_codes };
}
const resetLink = async (email: string) => {
  t.mailer.sent.length = 0;
  await new Client(t).post('/auth/password/forgot', { email });
  return /token=([A-Za-z0-9_-]+)/.exec(t.mailer.sent.find((m) => m.to === email)!.text)![1]!;
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-21T09:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@auth-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('turning two-factor on (BUG-64)', () => {
  it('signs out every other session and desktop device, and keeps this one', async () => {
    const { client: a } = await addMember(t, admin, orgId, 'Pat', 'pat@auth-rules.test');
    const b = new Client(t);
    expect((await b.post('/auth/login', { email: 'pat@auth-rules.test', password: PW })).status).toBe(200);
    const refresh = await device(a);
    await enroll(a);
    expect((await a.get('/me')).status).toBe(200);
    expect((await b.get('/me')).status).toBe(401);
    expect(await deviceWorks(refresh)).toBe(false);
  });
});

describe('turning two-factor off, or an owner resetting it (BUG-65)', () => {
  it('signs desktop devices out too', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Quin', 'quin@auth-rules.test');
    const { secret } = await enroll(c);
    const refresh = await device(c);
    t.clock.advance(31_000);
    expect((await c.post('/me/mfa/totp/disable', { password: PW, code: totpCode(secret, t.clock.now) })).status).toBeLessThan(300);
    expect(await deviceWorks(refresh)).toBe(false);
  });

  it('after an owner reset, as well', async () => {
    const { client: c, membershipId } = await addMember(t, admin, orgId, 'Rae', 'rae@auth-rules.test');
    await enroll(c);
    const refresh = await device(c);
    expect((await admin.post(`/orgs/${orgId}/workers/${membershipId}/mfa/reset`, { password: PW })).status).toBeLessThan(300);
    expect(await deviceWorks(refresh)).toBe(false);
  });
});

describe('a password reset link (BUG-66)', () => {
  it('stops working once the password is changed', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Sid', 'sid@auth-rules.test');
    const link = await resetLink('sid@auth-rules.test');
    expect((await c.post('/auth/password/change', { current_password: PW, new_password: 'another-strong-pass-1' })).status).toBe(200);
    const r = await new Client(t).post('/auth/password/reset', { token: link, password: 'attacker-chosen-pass-9' });
    expect(r.status).toBe(422);
    expect((await new Client(t).post('/auth/login', { email: 'sid@auth-rules.test', password: 'another-strong-pass-1' })).status).toBe(200);
  });
});

describe('signing up when the email can’t be sent (BUG-67)', () => {
  it('still creates a working account, once', async () => {
    const send = vi.spyOn(t.deps.mailer, 'send').mockRejectedValueOnce(new Error('SMTP down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const r = await new Client(t).post('/auth/signup', { name: 'Uma Upstart', email: 'uma@auth-rules.test', password: PW, organization_name: 'Uma Co' });
      expect(r.status).toBe(201);
    } finally {
      send.mockRestore();
      log.mockRestore();
    }
    expect((await new Client(t).post('/auth/login', { email: 'uma@auth-rules.test', password: PW })).status).toBe(200);
  });
});

describe('a recovery code (BUG-68)', () => {
  it('works typed without its hyphen, or in capitals', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Vic', 'vic@auth-rules.test');
    const { recovery } = await enroll(c);
    const signIn = async (code: string) => {
      const s = new Client(t);
      expect((await s.post('/auth/login', { email: 'vic@auth-rules.test', password: PW })).body).toEqual({ mfa_required: true });
      return (await s.post('/auth/mfa/verify', { code })).status;
    };
    expect(await signIn(recovery[0]!.replace('-', ''))).toBe(200);
    expect(await signIn(recovery[1]!.toUpperCase())).toBe(200);
  });
});

describe('the password in two-factor settings (BUG-69)', () => {
  it('counts wrong guesses toward the account lockout', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Wes', 'wes@auth-rules.test');
    for (let i = 0; i < 8; i++) expect((await c.post('/me/mfa/totp/setup', { password: `wrong-guess-${i}-pw` })).status).toBeGreaterThanOrEqual(400);
    const r = await new Client(t).post<{ code: string }>('/auth/login', { email: 'wes@auth-rules.test', password: PW });
    expect(r.status).not.toBe(200);
  });
});

describe('an invitation opened in another account (BUG-70)', () => {
  it('doesn’t show the address it was sent to', async () => {
    const roles = (await admin.get<Array<{ id: string; key: string }>>(`/orgs/${orgId}/roles`)).body;
    const inv = await admin.post<{ invite_url: string }>(`/orgs/${orgId}/invitations`, { email: 'secret.person@auth-rules.test', name: 'Secret', role_id: roles.find((r) => r.key === 'WORKER')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token');
    const { client: other } = await addMember(t, admin, orgId, 'Xan', 'xan@auth-rules.test');
    const r = await other.post<{ title: string }>('/auth/invitations/accept', { token });
    expect(r.status).toBe(422);
    expect(r.body.title).not.toContain('secret.person@auth-rules.test');
  });
});
