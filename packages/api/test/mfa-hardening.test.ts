import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { totpCode } from '../src/lib/totp';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Two-factor hardening (October 2026): password on every change, QR code made on the server, safe
// replacement, expiring setup, single-use recovery codes under concurrency, a per-account lockout for
// wrong codes (web and desktop), a new session after the code step, email notices, and owner reset.
const PW = 'correct-horse-battery';
const DEVICE = { name: 'Laptop', platform: 'linux', agent_version: '0.1.9' };

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

/** Turns two-factor on for a client; returns the secret and the recovery codes. */
async function enroll(c: Client) {
  const s = await c.post('/me/mfa/totp/setup', { password: PW });
  expect(s.status).toBe(200);
  t.clock.advance(31_000);
  const r = await c.post('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) });
  expect(r.status).toBe(200);
  return { secret: s.body.secret as string, recovery: r.body.recovery_codes as string[] };
}

async function signIn(email: string) {
  const c = new Client(t);
  const r = await c.post('/auth/login', { email, password: PW });
  expect(r.body).toEqual({ mfa_required: true });
  return c;
}

const mailsTo = (email: string) => t.mailer.sent.filter((m) => m.to === email && m.subject.includes('two-factor'));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-27T09:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@mfa.test'));
}, 60_000);
afterAll(() => t.close());

describe('setup', () => {
  it('asks for the password and shows a QR code made on the server', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Sid', 'sid@mfa.test');
    const wrong = await c.post('/me/mfa/totp/setup', { password: 'not-my-password' });
    expect([wrong.status, wrong.body.errors?.[0]?.field]).toEqual([400, 'password']);
    const s = await c.post('/me/mfa/totp/setup', { password: PW });
    expect(s.status).toBe(200);
    expect(s.body.qr_svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    // Drawn here, not fetched: no outside address, and the secret is not in it as text.
    expect(s.body.qr_svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(s.body.qr_svg).not.toContain(s.body.secret);
    expect(s.body.otpauth_url).toContain(`secret=${s.body.secret}`);
  });

  it('can be cancelled, and expires when left unfinished', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Cal', 'cal@mfa.test');
    const s = await c.post('/me/mfa/totp/setup', { password: PW });
    expect((await c.post('/me/mfa/totp/cancel')).status).toBe(204);
    const afterCancel = await c.post('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) });
    expect([afterCancel.status, afterCancel.body.code]).toEqual([422, 'mfa_setup_missing']);

    const s2 = await c.post('/me/mfa/totp/setup', { password: PW });
    t.clock.advance(16 * 60_000);
    const late = await c.post('/me/mfa/totp/confirm', { code: totpCode(s2.body.secret, t.clock.now) });
    expect([late.status, late.body.code]).toEqual([422, 'mfa_setup_missing']);
    expect((await c.get('/me/mfa')).body.enabled).toBe(false);
  });

  it('recovery codes are 10 characters, and turning it on sends an email', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Rex', 'rex@mfa.test');
    const { recovery } = await enroll(c);
    expect(recovery).toHaveLength(10);
    for (const r of recovery) expect(r).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(mailsTo('rex@mfa.test').map((m) => m.text)).toEqual([expect.stringContaining('turned on')]);
  });
});

describe('sign-in', () => {
  it('replaces the session token after the code step', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Tom', 'tom@mfa.test');
    const { secret } = await enroll(c);
    const pending = await signIn('tom@mfa.test');
    const pendingCookie = pending.cookie;
    t.clock.advance(31_000);
    expect((await pending.post('/auth/mfa/verify', { code: totpCode(secret, t.clock.now) })).status).toBe(200);
    expect(pending.cookie).not.toBe(pendingCookie);
    expect((await pending.get('/me')).status).toBe(200);
    // The token issued after the password alone no longer works.
    const old = new Client(t);
    old.cookie = pendingCookie;
    expect((await old.get('/me')).status).toBe(401);
  });

  it('a recovery code works once, even when sent twice at the same moment', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Una', 'una@mfa.test');
    const { recovery } = await enroll(c);
    const a = await signIn('una@mfa.test');
    const b = await signIn('una@mfa.test');
    const [ra, rb] = await Promise.all([a.post('/auth/mfa/verify', { code: recovery[0] }), b.post('/auth/mfa/verify', { code: recovery[0] })]);
    expect([ra.status, rb.status].sort()).toEqual([200, 401]);
    expect((await c.get('/me/mfa')).body.recovery_codes_left).toBe(9);
  });

  it('locks the second step after 10 wrong codes, on the desktop too, for 15 minutes', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Lia', 'lia@mfa.test');
    const { secret } = await enroll(c);
    // Each attempt from another address: the per-IP limit alone would not stop this.
    for (let i = 0; i < 10; i++) {
      const r = await new Client(t).req('POST', '/agent/login', { email: 'lia@mfa.test', password: PW, mfa_code: '000000', device: DEVICE }, { 'x-forwarded-for': `10.0.0.${i}` });
      expect(r.status).toBe(401);
    }
    t.clock.advance(31_000);
    const locked = await new Client(t).post('/agent/login', { email: 'lia@mfa.test', password: PW, mfa_code: totpCode(secret, t.clock.now), device: DEVICE });
    expect([locked.status, locked.body.code]).toEqual([429, 'mfa_locked']);
    // The web sign-in shares the lock.
    const web = await signIn('lia@mfa.test');
    expect((await web.post('/auth/mfa/verify', { code: totpCode(secret, t.clock.now) })).body.code).toBe('mfa_locked');
    // 15 minutes later it works again (signing in afresh: a password-only session lasts 10 minutes).
    t.clock.advance(15 * 60_000);
    const again = await signIn('lia@mfa.test');
    expect((await again.post('/auth/mfa/verify', { code: totpCode(secret, t.clock.now) })).status).toBe(200);
  });
});

describe('managing it', () => {
  it('replacing the app keeps the old one working until the new one is confirmed', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Ray', 'ray@mfa.test');
    const old = await enroll(c);
    t.clock.advance(31_000);
    const noCode = await c.post('/me/mfa/totp/setup', { password: PW });
    expect([noCode.status, noCode.body.errors?.[0]?.field]).toEqual([400, 'code']);
    const wrongCode = await c.post('/me/mfa/totp/setup', { password: PW, code: '000000' });
    expect(wrongCode.status).toBe(400);
    const next = await c.post('/me/mfa/totp/setup', { password: PW, code: totpCode(old.secret, t.clock.now) });
    expect(next.status).toBe(200);
    // Not confirmed yet: the old app still signs in.
    t.clock.advance(31_000);
    const s1 = await signIn('ray@mfa.test');
    expect((await s1.post('/auth/mfa/verify', { code: totpCode(old.secret, t.clock.now) })).status).toBe(200);
    // Confirmed: only the new app works.
    t.clock.advance(31_000);
    expect((await c.post('/me/mfa/totp/confirm', { code: totpCode(next.body.secret, t.clock.now) })).status).toBe(200);
    t.clock.advance(31_000);
    const s2 = await signIn('ray@mfa.test');
    expect((await s2.post('/auth/mfa/verify', { code: totpCode(old.secret, t.clock.now) })).status).toBe(401);
    expect((await s2.post('/auth/mfa/verify', { code: totpCode(next.body.secret, t.clock.now) })).status).toBe(200);
    expect(mailsTo('ray@mfa.test').at(-1)?.text).toContain('new authenticator app');
  });

  it('turning it off and new recovery codes need the password and a code', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Dot', 'dot@mfa.test');
    const { secret } = await enroll(c);
    t.clock.advance(31_000);
    const codesWrongPw = await c.post('/me/mfa/recovery-codes', { password: 'nope-nope-nope', code: totpCode(secret, t.clock.now) });
    expect([codesWrongPw.status, codesWrongPw.body.errors?.[0]?.field]).toEqual([400, 'password']);
    expect((await c.post('/me/mfa/recovery-codes', { password: PW, code: totpCode(secret, t.clock.now) })).status).toBe(200);
    t.clock.advance(31_000);
    const offNoPw = await c.post('/me/mfa/totp/disable', { code: totpCode(secret, t.clock.now) });
    expect(offNoPw.status).toBe(400);
    expect((await c.post('/me/mfa/totp/disable', { password: PW, code: totpCode(secret, t.clock.now) })).status).toBe(204);
    expect((await c.get('/me/mfa')).body.enabled).toBe(false);
    expect(mailsTo('dot@mfa.test').map((m) => m.text.match(/turned on|new two-factor recovery codes|turned off/)?.[0])).toEqual(['turned on', 'new two-factor recovery codes', 'turned off']);
  });
});

describe('owner reset (lost phone and recovery codes)', () => {
  it('the owner resets a member of only this organization: signed out everywhere, emailed, audited', async () => {
    const { client: c, membershipId } = await addMember(t, admin, orgId, 'Pia', 'pia@mfa.test');
    await enroll(c);
    const wrongPw = await admin.post(o(`/workers/${membershipId}/mfa/reset`), { password: 'not-the-owner-password' });
    expect([wrongPw.status, wrongPw.body.errors?.[0]?.field]).toEqual([400, 'password']);
    expect((await admin.post(o(`/workers/${membershipId}/mfa/reset`), { password: PW })).status).toBe(204);
    expect((await c.get('/me')).status).toBe(401); // signed out
    const back = new Client(t);
    expect((await back.post('/auth/login', { email: 'pia@mfa.test', password: PW })).body.mfa_required).toBeUndefined();
    expect(mailsTo('pia@mfa.test').at(-1)?.text).toContain('owner reset two-factor');
    const [log] = await asOwner<{ action: string }>(sql`select action from audit_logs where action = 'member.mfa_reset' and target_id = ${membershipId}`);
    expect(log?.action).toBe('member.mfa_reset');
  });

  it('only the owner, never for someone in other organizations too, and not for themselves', async () => {
    const { client: sysadmin } = await addMember(t, admin, orgId, 'Sam', 'sam@mfa.test', 'SYSTEM_ADMIN');
    const { client: c, membershipId } = await addMember(t, admin, orgId, 'Ole', 'ole@mfa.test');
    await enroll(c);
    expect((await sysadmin.post(o(`/workers/${membershipId}/mfa/reset`), { password: PW })).status).toBe(403);

    // Ole joins a second organization: his two-factor is no longer this owner's to reset.
    const { client: other, orgId: otherOrg } = await signup(t, 'Bea', 'bea@mfa.test');
    const roles = (await other.get(`/orgs/${otherOrg}/roles`)).body as Array<{ id: string; key: string }>;
    const inv = await other.post(`/orgs/${otherOrg}/invitations`, { email: 'ole@mfa.test', name: 'Ole', role_id: roles.find((r) => r.key === 'WORKER')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    expect((await c.post('/auth/invitations/accept', { token })).status).toBe(200);
    const r = await admin.post(o(`/workers/${membershipId}/mfa/reset`), { password: PW });
    expect([r.status, r.body.code]).toEqual([422, 'mfa_reset_other_orgs']);
    expect((await c.get('/me/mfa')).body.enabled).toBe(true);

    const me = (await admin.get(o(''))).body.membership.id as string;
    expect((await admin.post(o(`/workers/${me}/mfa/reset`), { password: PW })).body.code).toBe('mfa_reset_self');
  });
});
