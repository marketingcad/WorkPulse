import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../src/lib/totp';
import { createMailer, MemoryMailer } from '../src/lib/mailer';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Security audit (29 October 2026), authentication. Each test failed before its fix.
// AUTH-001 password change signs out other sessions and devices; AUTH-002 password reset revokes desktop
// tokens; AUTH-004 no cross-site sign-in; AUTH-005 support console needs a proven address;
// AUTH-009 a locked account answers like any wrong password; AUTH-010 production logs no mail bodies;
// single-use tokens and older reset links.
const PW = 'correct-horse-battery';
let t: Harness;
let admin: Client;
let orgId: string;

async function device(c: Client) {
  const { verifier, challenge } = pkce();
  const code = await c.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const r = await new Client(t).post<{ access_token: string; refresh_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } });
  return r.body.refresh_token;
}
const resetLink = async (email: string) => {
  t.mailer.sent.length = 0;
  await new Client(t).post('/auth/password/forgot', { email });
  return /token=([A-Za-z0-9_-]+)/.exec(t.mailer.sent.find((m) => m.to === email)!.text)![1]!;
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@sec-auth.test'));
}, 60_000);
afterAll(() => t.close());

describe('AUTH-001: changing the password', () => {
  it('signs out every other session and desktop device, and keeps this one', async () => {
    const { client: a } = await addMember(t, admin, orgId, 'Pat', 'pat@sec-auth.test');
    const b = new Client(t);
    expect((await b.post('/auth/login', { email: 'pat@sec-auth.test', password: PW })).status).toBe(200);
    const refresh = await device(a);
    expect((await a.post('/auth/password/change', { current_password: PW, new_password: 'another-strong-pass-1' })).status).toBe(200);
    expect((await a.get('/me')).status).toBe(200);
    expect((await b.get('/me')).status).toBe(401); // was 200
    expect((await new Client(t).post('/agent/token', { refresh_token: refresh })).status).toBe(401); // was 200
  });

  it('counts wrong current passwords toward the lockout', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Quin', 'quin@sec-auth.test');
    for (let i = 0; i < 8; i++) expect((await c.post('/auth/password/change', { current_password: `nope-${i}-password`, new_password: 'another-strong-pass-2' })).status).toBe(422);
    const locked = await c.post<{ code: string }>('/auth/password/change', { current_password: PW, new_password: 'another-strong-pass-2' });
    expect([locked.status, locked.body.code]).toEqual([429, 'account_locked']); // was 200: guessing was unlimited
  });
});

describe('AUTH-002: resetting the password', () => {
  it('revokes desktop refresh tokens as well as web sessions', async () => {
    const { client: c } = await addMember(t, admin, orgId, 'Rae', 'rae@sec-auth.test');
    const refresh = await device(c);
    expect((await new Client(t).post('/auth/password/reset', { token: await resetLink('rae@sec-auth.test'), password: 'another-strong-pass-3' })).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
    expect((await new Client(t).post('/agent/token', { refresh_token: refresh })).status).toBe(401); // was 200
  });

  it('only the newest reset link works, and each works once', async () => {
    await addMember(t, admin, orgId, 'Sol', 'sol@sec-auth.test');
    const first = await resetLink('sol@sec-auth.test');
    const second = await resetLink('sol@sec-auth.test');
    expect((await new Client(t).post('/auth/password/reset', { token: first, password: 'another-strong-pass-4' })).status).toBe(422); // was 200
    expect((await new Client(t).post('/auth/password/reset', { token: second, password: 'another-strong-pass-4' })).status).toBe(200);
    expect((await new Client(t).post('/auth/password/reset', { token: second, password: 'another-strong-pass-5' })).status).toBe(422);
  });
});

describe('AUTH-004: no cross-site sign-in', () => {
  const login = (headers: Record<string, string>) => t.app.request('/api/v1/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: 'ada@sec-auth.test', password: PW }) });

  it('refuses a text/plain body (what a cross-site form sends)', async () => {
    const cross = await login({ 'content-type': 'text/plain', origin: 'https://evil.example' });
    expect(cross.status).toBe(403); // was 200 with a session cookie
    expect(cross.headers.get('set-cookie')).toBeNull();
    // Without an Origin (some browsers and proxies drop it), the body type alone refuses it.
    const plain = await login({ 'content-type': 'text/plain' });
    expect([plain.status, plain.headers.get('set-cookie')]).toEqual([400, null]);
  });

  it('refuses a JSON sign-in from another site, and allows our own and non-browser clients', async () => {
    expect((await login({ 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403);
    expect((await login({ 'content-type': 'application/json', origin: 'http://localhost:3000' })).status).toBe(200);
    expect((await login({ 'content-type': 'application/json' })).status).toBe(200);
  });
});

describe('AUTH-005: support console', () => {
  it('a staff address that signed up but never opened an emailed link gets no console', async () => {
    t.deps.config.supportStaffEmails = ['staff@sec-auth.test'];
    const { client: s } = await signup(t, 'Mal', 'staff@sec-auth.test', 'Mal Org');
    const setup = await s.post<{ secret: string }>('/me/mfa/totp/setup', { password: PW });
    await s.post('/me/mfa/totp/confirm', { code: totpCode(setup.body.secret, t.clock.now) });
    expect((await s.get('/support/me')).status).toBe(403); // was 200
    const token = /token=([A-Za-z0-9_-]+)/.exec(t.mailer.sent.find((m) => m.to === 'staff@sec-auth.test')!.text)![1];
    expect((await s.post('/auth/verify-email', { token })).status).toBe(200);
    expect((await s.get('/support/me')).status).toBe(200);
  });
});

describe('AUTH-009: lockout', () => {
  it('a locked account answers like any wrong password', async () => {
    await addMember(t, admin, orgId, 'Lou', 'lou@sec-auth.test');
    const real: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 10; i++) real.push((await new Client(t).post('/auth/login', { email: 'lou@sec-auth.test', password: `wrong-${i}-password` })).status);
    for (let i = 0; i < 10; i++) unknown.push((await new Client(t).post('/auth/login', { email: 'nobody@sec-auth.test', password: `wrong-${i}-password` })).status);
    expect(real).toEqual(unknown); // was 401 × 8 then 429 for the real account
    // Still locked: the right password is refused too.
    expect((await new Client(t).post('/auth/login', { email: 'lou@sec-auth.test', password: PW })).status).toBe(401);
  });
});

describe('AUTH-010: no mail provider in production', () => {
  it('logs who and what, never the body', async () => {
    const m = createMailer({ NODE_ENV: 'production' }) as MemoryMailer;
    const seen: string[] = [];
    const orig = { info: console.info, warn: console.warn };
    console.info = (...a: unknown[]) => void seen.push(a.join(' '));
    console.warn = (...a: unknown[]) => void seen.push(a.join(' '));
    try {
      await m.send({ to: 'x@example.test', subject: 'Reset your password', text: 'Open https://app/reset?token=SECRET123' });
    } finally {
      Object.assign(console, orig);
    }
    expect(seen.join('\n')).toContain('Reset your password');
    expect(seen.join('\n')).not.toContain('SECRET123'); // was logged in full
  });
});
