import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from './harness';

let t: Harness;
beforeAll(async () => {
  t = await createHarness();
  t.deps.config.requireEmailVerification = true;
});
afterAll(() => t.close());

const PASSWORD = 'correct-horse-battery';
const linkToken = (to: string) => {
  const msg = t.mailer.sent.filter((m) => m.to === to).at(-1)!;
  return /verify-email\?token=([\w-]+)/.exec(msg.text)![1]!;
};

describe('required email verification', () => {
  it('signs up without a session, blocks sign-in, then the link signs the person in', async () => {
    const c = new Client(t);
    const r = await c.post<{ verification_required?: boolean }>('/auth/signup', { name: 'Vera', email: 'vera@v.test', password: PASSWORD, organization_name: 'Vera Co' });
    expect(r.status).toBe(201);
    expect(r.body.verification_required).toBe(true);
    expect((await c.get('/me')).status).toBe(401);

    const login = await new Client(t).post<{ code: string }>('/auth/login', { email: 'vera@v.test', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('email_not_verified');

    const v = await c.post<{ signed_in: boolean }>('/auth/verify-email', { token: linkToken('vera@v.test') });
    expect(v.status).toBe(200);
    expect(v.body.signed_in).toBe(true);
    const me = await c.get<{ user: { email_verified: boolean }; organizations: unknown[] }>('/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email_verified).toBe(true);
    expect(me.body.organizations).toHaveLength(1);

    expect((await new Client(t).post('/auth/login', { email: 'vera@v.test', password: PASSWORD })).status).toBe(200);
  });

  it('a wrong password still reads as invalid credentials for an unverified account', async () => {
    await new Client(t).post('/auth/signup', { name: 'Wes', email: 'wes@v.test', password: PASSWORD });
    const r = await new Client(t).post<{ code: string }>('/auth/login', { email: 'wes@v.test', password: 'wrong-password-123' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('invalid_credentials');
  });

  it('resends a fresh link only to unverified accounts, without revealing which exist', async () => {
    const before = t.mailer.sent.length;
    expect((await new Client(t).post('/auth/verify-email/resend', { email: 'wes@v.test' })).status).toBe(202);
    expect((await new Client(t).post('/auth/verify-email/resend', { email: 'nobody@v.test' })).status).toBe(202);
    expect((await new Client(t).post('/auth/verify-email/resend', { email: 'vera@v.test' })).status).toBe(202);
    expect(t.mailer.sent.slice(before).map((m) => m.to)).toEqual(['wes@v.test']);

    const c = new Client(t);
    expect((await c.post('/auth/verify-email', { token: linkToken('wes@v.test') })).status).toBe(200);
    expect((await c.get('/me')).status).toBe(200);
  });
});
