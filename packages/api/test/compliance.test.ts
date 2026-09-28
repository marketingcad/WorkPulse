import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { runDaily } from '../src/jobs';
import { ipAllowed, ipInCidr } from '../src/lib/cidr';
import { totpCode } from '../src/lib/totp';
import { processReportRuns } from '../src/services/report-runs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Phase 13 gate: append-only audit, retention (grace period, minimums, exact deletion), MFA and
// security settings, data export and erasure, screenshot access logs, permission review.
let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let ben: Client;
let benId: string;
let projectId: string;
let sessionId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const PW = 'correct-horse-battery';

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
/** Database errors arrive wrapped by the driver; match the message or its cause. */
async function dbError(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err as Error & { cause?: Error });
  expect(e, 'expected the query to fail').not.toBeNull();
  expect(`${e!.message} ${e!.cause?.message ?? ''}`).toMatch(re);
}
async function login(c: Client, email: string, headers: Record<string, string> = {}) {
  c.cookie = '';
  return c.req<any>('POST', '/auth/login', { email, password: PW }, headers);
}
async function shot(daysAgo: number) {
  const id = newId();
  const key = `org/${orgId}/screenshots/${benId}/${id}.jpg`;
  await t.storage.put(key, Buffer.from('img'), 'image/jpeg');
  const at = new Date(t.clock.now.getTime() - daysAgo * 86400_000).toISOString();
  await asOwner(sql`insert into screenshots (id, organization_id, session_id, membership_id, captured_at, storage_key, status, window_start) values (${id}, ${orgId}, ${sessionId}, ${benId}, ${at}, ${key}, 'READY', ${at})`);
  return { id, key };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-09-23T20:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@sec.test'));
  let managerId: string;
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Mona', 'mona@sec.test', 'TEAM_MANAGER'));
  ({ client: ben, membershipId: benId } = await addMember(t, admin, orgId, 'Ben', 'ben@sec.test'));
  const team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' });
  await admin.put(o(`/teams/${team}/members/${benId}`), { role: 'MEMBER' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [benId] })).body.id;
  t.clock.set(new Date('2026-09-15T13:00:00Z'));
  sessionId = (await ben.post(o('/tracking/start'), { project_id: projectId })).body.session.id;
  t.clock.set(new Date('2026-09-15T15:00:00Z'));
  await ben.post(o('/tracking/stop'));
  t.clock.set(new Date('2026-09-23T20:00:00Z'));
});
afterAll(() => t.close());

describe('audit log', () => {
  it('is append-only for the application: UPDATE and DELETE are refused by the database', async () => {
    await dbError(withTenant(t.h.db, orgId, (tx) => tx.execute(sql`update audit_logs set action = 'tampered'`)), /permission denied/);
    await dbError(withTenant(t.h.db, orgId, (tx) => tx.execute(sql`delete from audit_logs`)), /permission denied/);
    await dbError(withTenant(t.h.db, orgId, (tx) => tx.execute(sql`truncate audit_logs`)), /permission denied/);
    const [n] = await asOwner<{ n: number }>(sql`select count(*)::int n from audit_logs where action = 'tampered'`);
    expect(n!.n).toBe(0);
  });

  it('old entries are purged only by the database function, never under a year, only in the current tenant', async () => {
    await asOwner(sql`insert into audit_logs (id, organization_id, actor_type, action, created_at) values (${newId()}, ${orgId}, 'system', 'ancient', now() - interval '400 days'), (${newId()}, ${orgId}, 'system', 'recent', now() - interval '300 days')`);
    await dbError(withTenant(t.h.db, orgId, (tx) => tx.execute(sql`select tallywork_purge_audit(30)`)), /at least 365 days/);
    await dbError(t.h.db.execute(sql`select tallywork_purge_audit(365)`), /tenant context/);
    await withTenant(t.h.db, orgId, (tx) => tx.execute(sql`select tallywork_purge_audit(365)`));
    const rows = await asOwner<{ action: string }>(sql`select action from audit_logs where organization_id = ${orgId} and action in ('ancient', 'recent')`);
    expect(rows.map((r) => r.action)).toEqual(['recent']);
  });
});

describe('retention', () => {
  it('refuses periods under the legal minimums', async () => {
    const r = await admin.put(o('/retention-policies'), { policies: [{ data_class: 'AUDIT', keep_days: 90 }] });
    expect([r.status, r.body.errors[0].field]).toEqual([400, 'policies.AUDIT']);
    expect((await admin.put(o('/retention-policies'), { policies: [{ data_class: 'INVOICES', keep_days: 365 }] })).status).toBe(400);
  });

  it('a shorter period waits 7 days (dry run shows what will go), then deletes exactly the expired data', async () => {
    const old1 = await shot(45);
    const old2 = await shot(31);
    const keep = await shot(29);
    const r = (await admin.put(o('/retention-policies'), { policies: [{ data_class: 'SCREENSHOTS', keep_days: 30 }] })).body.find((p: { data_class: string }) => p.data_class === 'SCREENSHOTS');
    expect(r).toMatchObject({ pending_keep_days: 30, pending_from: '2026-09-30T20:00:00.000Z', purged_automatically: true });
    const preview = (await admin.get(o('/retention-policies/preview'))).body.find((p: { data_class: string }) => p.data_class === 'SCREENSHOTS');
    expect(preview).toMatchObject({ next_run_deletes: 0, pending_deletes: 2 });

    await runDaily(t.deps); // inside the grace period: nothing is deleted
    expect(t.storage.objects.has(old1.key)).toBe(true);

    t.clock.set(new Date('2026-10-01T06:00:00Z'));
    const summary = (await runDaily(t.deps)) as Record<string, { deleted: Record<string, number> }>;
    // 45 and 31 days old when the change was made, and the 29-day-old one is now 37 days old.
    expect(summary[orgId]!.deleted.screenshots).toBe(3);
    const left = await asOwner<{ id: string }>(sql`select id from screenshots where organization_id = ${orgId}`);
    expect(left).toEqual([]);
    for (const s of [old1, old2, keep]) expect(t.storage.objects.has(s.key)).toBe(false);
    // A newer one stays.
    const fresh = await shot(10);
    await runDaily(t.deps);
    expect(t.storage.objects.has(fresh.key)).toBe(true);
    expect((await admin.get(o('/retention-policies'))).body.find((p: { data_class: string }) => p.data_class === 'SCREENSHOTS')).toMatchObject({ keep_days: 30, pending_keep_days: null });
    await relogin();
  });

  it('a longer period applies at once and cancels a pending shorter one; records kept by law are untouched', async () => {
    await admin.put(o('/retention-policies'), { policies: [{ data_class: 'APPS', keep_days: 10 }] });
    const again = (await admin.put(o('/retention-policies'), { policies: [{ data_class: 'APPS', keep_days: 400 }, { data_class: 'TIMESHEETS', keep_days: 2555 }] })).body;
    expect(again.find((p: { data_class: string }) => p.data_class === 'APPS')).toMatchObject({ keep_days: 400, pending_keep_days: null });
    expect(again.find((p: { data_class: string }) => p.data_class === 'TIMESHEETS')).toMatchObject({ purged_automatically: false });
    const [before] = await asOwner<{ n: number }>(sql`select count(*)::int n from time_entries where organization_id = ${orgId}`);
    t.clock.set(new Date('2026-10-20T06:00:00Z'));
    await runDaily(t.deps);
    const [after] = await asOwner<{ n: number }>(sql`select count(*)::int n from time_entries where organization_id = ${orgId}`);
    expect(after!.n).toBe(before!.n);
    t.clock.set(new Date('2026-09-23T20:00:00Z'));
    await relogin();
  });
});

async function relogin() {
  for (const [c, e] of [[admin, 'ada'], [manager, 'mona'], [ben, 'ben']] as const) await login(c, `${e}@sec.test`);
}

describe('two-factor authentication', () => {
  let secret: string;
  let recovery: string[];
  it('enrolls with an authenticator app and recovery codes', async () => {
    const s = await manager.post('/me/mfa/totp/setup');
    expect(s.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/WorkPulse%3Amona%40sec\.test\?secret=[A-Z2-7]+&issuer=WorkPulse/);
    secret = s.body.secret;
    expect((await manager.post('/me/mfa/totp/confirm', { code: '000000' })).status).toBe(400);
    const c = await manager.post('/me/mfa/totp/confirm', { code: totpCode(secret, t.clock.now) });
    expect(c.status).toBe(200);
    recovery = c.body.recovery_codes;
    expect(recovery).toHaveLength(10);
    expect((await manager.get('/me')).body.user.mfa_enabled).toBe(true);
    expect(JSON.stringify(await asOwner(sql`select * from mfa_factors`))).not.toContain(secret);
  });

  it('sign-in needs the second step; a pending session can do nothing else; codes cannot be replayed', async () => {
    t.clock.set(new Date(t.clock.now.getTime() + 60_000));
    const r = await login(manager, 'mona@sec.test');
    expect(r.body).toEqual({ mfa_required: true });
    expect((await manager.get('/me')).body.code).toBe('mfa_required');
    expect((await manager.get(o(''))).status).toBe(401);
    expect((await manager.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401);
    const code = totpCode(secret, t.clock.now);
    expect((await manager.post('/auth/mfa/verify', { code })).status).toBe(200);
    expect((await manager.get(o(''))).status).toBe(200);
    // The same code a second time (another sign-in within the same 30 seconds) is refused.
    const other = new Client(t);
    await login(other, 'mona@sec.test');
    expect((await other.post('/auth/mfa/verify', { code })).status).toBe(401);
    // A recovery code works once.
    expect((await other.post('/auth/mfa/verify', { code: recovery[0] })).status).toBe(200);
    const third = new Client(t);
    await login(third, 'mona@sec.test');
    expect((await third.post('/auth/mfa/verify', { code: recovery[0] })).status).toBe(401);
    expect((await manager.get('/me/mfa')).body).toEqual({ enabled: true, session_verified: true, recovery_codes_left: 9 });
    // Fresh recovery codes (needs a current code); the old ones stop working.
    t.clock.set(new Date(t.clock.now.getTime() + 31_000));
    const fresh = await manager.post('/me/mfa/recovery-codes', { code: totpCode(secret, t.clock.now) });
    expect(fresh.body.recovery_codes).toHaveLength(10);
    const fourth = new Client(t);
    await login(fourth, 'mona@sec.test');
    expect((await fourth.post('/auth/mfa/verify', { code: recovery[1] })).status).toBe(401);
    expect((await fourth.post('/auth/mfa/verify', { code: fresh.body.recovery_codes[0] })).status).toBe(200);
  });

  it('an organization can require it: admins first enable it themselves; others must enroll to continue', async () => {
    const first = await admin.patch(o(''), { settings: { enforceMfa: 'all' } });
    expect([first.status, first.body.code]).toEqual([422, 'mfa_required_first']);
    const s = await admin.post('/me/mfa/totp/setup');
    t.clock.set(new Date(t.clock.now.getTime() + 60_000));
    await admin.post('/me/mfa/totp/confirm', { code: totpCode(s.body.secret, t.clock.now) });
    expect((await admin.patch(o(''), { settings: { enforceMfa: 'all' } })).status).toBe(200);
    const blocked = await ben.get(o('/projects'));
    expect([blocked.status, blocked.body.code]).toEqual([403, 'mfa_enrollment_required']);
    expect((await ben.get('/me')).status).toBe(200); // can still reach the profile to set it up
    const bs = await ben.post('/me/mfa/totp/setup');
    await ben.post('/me/mfa/totp/confirm', { code: totpCode(bs.body.secret, t.clock.now) });
    expect((await ben.get(o('/projects'))).status).toBe(200);
    // "Admins only" lets workers through without it.
    expect((await admin.patch(o(''), { settings: { enforceMfa: 'admins' } })).status).toBe(200);
    await admin.patch(o(''), { settings: { enforceMfa: 'none' } });
  });
});

describe('security settings', () => {
  it('the shortest session lifetime of the person’s organizations applies', async () => {
    expect((await admin.patch(o(''), { settings: { sessionTtlHours: 1 } })).status).toBe(200);
    const c = new Client(t);
    await login(c, 'ben@sec.test');
    // (Ben has 2FA now.)
    expect((await c.post('/auth/mfa/verify', { code: '000000' })).status).toBe(401);
    const w = new Client(t);
    const { client: wendy } = await addMember(t, admin, orgId, 'Wendy', 'wendy@sec.test');
    await login(wendy, 'wendy@sec.test');
    expect((await wendy.get('/me')).status).toBe(200);
    t.clock.set(new Date(t.clock.now.getTime() + 61 * 60_000));
    expect((await wendy.get('/me')).status).toBe(401);
    void w;
    await admin.patch(o(''), { settings: { sessionTtlHours: 336 } }).catch(() => undefined);
    await relogin2FA();
    expect((await admin.patch(o(''), { settings: { sessionTtlHours: 336 } })).status).toBe(200);
  });

  it('IP allowlist: validated, cannot lock out the admin saving it, and enforced for people and API keys', async () => {
    const at = (ip: string) => ({ 'x-real-ip': ip });
    const bad = await admin.req<any>('PATCH', o(''), { settings: { ipAllowlist: ['300.1.1.1/8'] } }, at('203.0.113.9'));
    expect(bad.status).toBe(400);
    const lockout = await admin.req<any>('PATCH', o(''), { settings: { ipAllowlist: ['203.0.113.0/24'] } }, at('198.51.100.7'));
    expect([lockout.status, lockout.body.code]).toEqual([422, 'ip_allowlist_lockout']);
    expect((await admin.req<any>('PATCH', o(''), { settings: { ipAllowlist: ['203.0.113.0/24', '2001:db8::/32'] } }, at('203.0.113.9'))).status).toBe(200);
    expect((await ben.req<any>('GET', o('/projects'), undefined, at('198.51.100.7'))).status).toBe(403);
    expect((await ben.req<any>('GET', o('/projects'), undefined, at('203.0.113.200'))).status).toBe(200);
    expect((await ben.req<any>('GET', o('/projects'), undefined, at('2001:db8:1::5'))).status).toBe(200);
    expect((await ben.req<any>('GET', o('/projects'), undefined, {})).status).toBe(403); // unknown address
    const key = new Client(t);
    key.bearer = (await admin.req<any>('POST', o('/api-keys'), { name: 'k', scopes: ['read:projects'] }, at('203.0.113.9'))).body.key;
    expect((await key.req<any>('GET', o('/projects'), undefined, at('198.51.100.7'))).status).toBe(403);
    expect((await admin.req<any>('PATCH', o(''), { settings: { ipAllowlist: [] } }, at('203.0.113.9'))).status).toBe(200);
  });

  it('security settings need the security permission', async () => {
    const r = await manager.patch(o(''), { settings: { enforceMfa: 'none' } });
    expect([r.status, r.body.code]).toEqual([403, 'forbidden']);
  });

  it.each([
    ['10.1.2.3', '10.0.0.0/8', true],
    ['11.0.0.1', '10.0.0.0/8', false],
    ['192.168.1.77', '192.168.1.77', true],
    ['::ffff:192.168.1.77', '192.168.1.0/24', true],
    ['2001:db8:abcd::1', '2001:db8::/32', true],
    ['2001:db9::1', '2001:db8::/32', false],
    ['10.0.0.1', '2001:db8::/32', false],
    ['1.2.3.4', '0.0.0.0/0', true],
  ])('%s in %s → %s', (ip, cidr, expected) => {
    expect(ipInCidr(ip, cidr)).toBe(expected);
  });
  it('an empty allowlist allows everyone; a set one refuses unknown addresses', () => {
    expect(ipAllowed(null, [])).toBe(true);
    expect(ipAllowed(null, ['10.0.0.0/8'])).toBe(false);
  });
});

async function relogin2FA() {
  // Admin and Ben have two-factor now: sign in again with codes.
  for (const [c, e] of [[admin, 'ada'], [ben, 'ben']] as const) {
    await login(c, `${e}@sec.test`);
    const f = await asOwner<{ secret_enc: string; id: string; user_id: string }>(sql`select f.id, f.secret_enc, f.user_id from mfa_factors f join users u on u.id = f.user_id where u.email = ${`${e}@sec.test`}`);
    const { decrypt } = await import('../src/lib/crypto');
    const secret = decrypt(t.deps.config.appSecret, f[0]!.secret_enc, `totp:${f[0]!.id}`);
    t.clock.set(new Date(t.clock.now.getTime() + 31_000));
    expect((await c.post('/auth/mfa/verify', { code: totpCode(secret, t.clock.now) })).status).toBe(200);
  }
}

describe('screenshot access log', () => {
  it('records when someone views other people’s screenshots', async () => {
    await shot(1);
    await login(manager, 'mona@sec.test');
    const f = await asOwner<{ secret_enc: string; id: string }>(sql`select f.id, f.secret_enc from mfa_factors f join users u on u.id = f.user_id where u.email = 'mona@sec.test'`);
    const { decrypt } = await import('../src/lib/crypto');
    t.clock.set(new Date(t.clock.now.getTime() + 31_000));
    await manager.post('/auth/mfa/verify', { code: totpCode(decrypt(t.deps.config.appSecret, f[0]!.secret_enc, `totp:${f[0]!.id}`), t.clock.now) });
    const d = new Date(t.clock.now.getTime() - 86400_000).toISOString().slice(0, 10);
    const list = await manager.get(o(`/screenshots?from=${d}&to=${t.clock.now.toISOString().slice(0, 10)}`));
    expect(list.status).toBe(200);
    const logs = await asOwner<{ action: string; metadata: { count: number; members: string[] } }>(sql`select action, metadata from audit_logs where organization_id = ${orgId} and action = 'screenshot.list_viewed'`);
    expect(logs.at(-1)).toMatchObject({ metadata: { count: 1, members: [benId] } });
  });
});

describe('personal data: export and erasure', () => {
  it('a member exports their own data; others’ only with members:manage', async () => {
    expect((await ben.post(o(`/workers/${benId}/data-export`))).status).toBe(202);
    const adminId = (await admin.get(o(''))).body.membership.id;
    expect((await ben.post(o(`/workers/${adminId}/data-export`))).status).toBe(403);
    await processReportRuns(t.deps);
    const [run] = (await ben.get(o('/report-runs'))).body;
    expect(run).toMatchObject({ report_key: 'data-export', status: 'DONE' });
    const file = await new Client(t).get(run.download_url.replace('/api/v1', ''));
    expect(file.headers.get('content-disposition')).toMatch(/personal-data_\d{4}-\d{2}-\d{2}\.json/);
    const data = file.body as { account: { email: string }; time_entries: unknown[]; tracking_sessions: unknown[]; screenshots: unknown[] };
    expect(data.account.email).toBe('ben@sec.test');
    expect(data.time_entries.length).toBeGreaterThan(0);
    expect(data.screenshots.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain('mona@sec.test');
  });

  it('erasure removes monitoring data and the identity, keeps the records the law needs', async () => {
    await ben.req<any>('POST', o('/timesheets/submit'), { date: '2026-09-15' }, { 'x-real-ip': '203.0.113.50' });
    const adminId = (await admin.get(o(''))).body.membership.id;
    expect((await admin.post(o(`/workers/${adminId}/anonymize`))).status).toBe(422); // not yourself (and not the owner)
    expect((await manager.post(o(`/workers/${benId}/anonymize`))).status).toBe(403);
    const r = await admin.post(o(`/workers/${benId}/anonymize`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ account_anonymized: true, deleted: { screenshots: 2 } }); // the 10- and 1-day-old ones
    expect(await asOwner(sql`select id from screenshots where membership_id = ${benId}`)).toEqual([]);
    const [entries] = await asOwner<{ n: number }>(sql`select count(*)::int n from time_entries where membership_id = ${benId}`);
    expect(entries!.n).toBeGreaterThan(0);
    const [ts] = await asOwner<{ n: number }>(sql`select count(*)::int n from timesheets where membership_id = ${benId}`);
    expect(ts!.n).toBe(1);
    const audits = await asOwner<{ ip_address: string | null }>(sql`select ip_address from audit_logs where actor_id = ${benId}`);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => a.ip_address === null)).toBe(true);
    const report = await admin.post(o('/reports/time-activity/query'), { from: '2026-09-14', to: '2026-09-20', group_by: ['worker'] });
    expect(JSON.stringify(report.body.rows)).not.toContain('Ben');
    expect(JSON.stringify(report.body.rows)).toContain('Former member');
    expect((await login(new Client(t), 'ben@sec.test')).status).toBe(401);
  });
});

describe('permission review', () => {
  it('lists roles with grants, members with 2FA status, and API keys with their creator', async () => {
    const r = (await admin.get(o('/permissions/review'))).body;
    expect(r.roles.find((x: { key: string }) => x.key === 'SYSTEM_ADMIN').grants['org:update']).toBe('org');
    expect(r.members.find((m: { email: string }) => m.email === 'mona@sec.test')).toMatchObject({ mfa_enabled: true, role: expect.any(String) });
    expect(r.api_keys.length).toBeGreaterThan(0);
    expect(r.api_keys[0]).toMatchObject({ created_by: 'Ada' });
    const w = (await addMember(t, admin, orgId, 'Walt', 'walt@sec.test')).client;
    expect((await w.get(o('/permissions/review'))).status).toBe(403);
  });
});

describe('TOTP implementation', () => {
  it('matches the RFC 6238 test vectors (SHA-1)', async () => {
    const { base32Encode, hotp, verifyTotp } = await import('../src/lib/totp');
    const key = Buffer.from('12345678901234567890');
    // RFC 6238 Appendix B gives 8 digits; the last 6 are the 6-digit code.
    for (const [seconds, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']] as const) {
      expect(hotp(key, Math.floor(seconds / 30))).toBe(eight.slice(2));
    }
    const b32 = base32Encode(key);
    expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    const at = new Date(1111111111 * 1000);
    expect(verifyTotp(b32, '050471', at)).toBe(Math.floor(1111111111 / 30));
    expect(verifyTotp(b32, '050471', at, Math.floor(1111111111 / 30))).toBeNull(); // replay
    expect(verifyTotp(b32, '050471', new Date(at.getTime() + 30_000))).not.toBeNull(); // one step of drift
    expect(verifyTotp(b32, '050471', new Date(at.getTime() + 90_000))).toBeNull();
  });
});
