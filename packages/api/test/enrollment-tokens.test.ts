import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Enrollment tokens (managed desktop installs): a token pins a computer to one organization and
 * pre-approves it. It never signs anyone in, and it is shown once and stored only as a hash.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let other: Client;
let otherOrg: string;
let mia: Client;
let token: string;
let tokenId: string;
const PASSWORD = 'correct-horse-battery';
const DEVICE = { name: 'Company-PC', platform: 'windows', agent_version: '0.3.0' };
const o = (p: string) => `/orgs/${orgId}${p}`;
const login = (body: Record<string, unknown>, headers: Record<string, string> = {}) => new Client(t).req<any>('POST', '/agent/login', { password: PASSWORD, device: DEVICE, ...body }, headers);
const system = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => ((await withSystem(t.h.db, (tx) => tx.execute(q))) as unknown as { rows: T[] }).rows;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@enroll.test'));
  ({ client: other, orgId: otherOrg } = await signup(t, 'Oz', 'oz@enroll.test'));
  await addMember(t, admin, orgId, 'Walt', 'walt@enroll.test');
  ({ client: mia } = await addMember(t, admin, orgId, 'Mia', 'mia@enroll.test', 'TEAM_MANAGER'));
  await addMember(t, other, otherOrg, 'Bo', 'bo@enroll.test');
  // Walt also belongs to the other organization.
  const roles = await other.get<Array<{ id: string; key: string }>>(`/orgs/${otherOrg}/roles`);
  const inv = await other.post(`/orgs/${otherOrg}/invitations`, { email: 'walt@enroll.test', role_id: roles.body.find((r) => r.key === 'WORKER')!.id });
  const walt = new Client(t);
  await walt.post('/auth/login', { email: 'walt@enroll.test', password: PASSWORD });
  expect((await walt.post('/auth/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token') })).status).toBe(200);
  // Approval required, so a pre-approved device is visible.
  expect((await admin.patch(o(''), { settings: { requireDeviceApproval: true } })).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

describe('managing tokens', () => {
  it('creates a token and shows the secret once', async () => {
    const r = await admin.post(o('/enrollment-tokens'), { name: 'Head office laptops' });
    expect(r.status).toBe(201);
    token = r.body.token;
    tokenId = r.body.id;
    expect(token).toMatch(/^wpe_[A-Za-z0-9_-]{43}$/);
    expect(r.body).toMatchObject({ name: 'Head office laptops', prefix: token.slice(4, 12), status: 'ACTIVE', use_count: 0, created_by_name: 'Ada', expires_at: null });
    const list = await admin.get(o('/enrollment-tokens'));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token.slice(12));
    expect(list.body[0].token).toBeUndefined();
  });

  it('stores only the hash, and never puts the secret or hash in the audit log', async () => {
    const rows = await system<{ token_hash: string }>(sql`select token_hash from device_enrollment_tokens where id = ${tokenId}`);
    const hash = createHash('sha256').update(token).digest('hex');
    expect(rows[0]!.token_hash).toBe(hash);
    const audit = await system<{ row: string }>(sql`select row_to_json(a)::text as row from audit_logs a where organization_id = ${orgId}`);
    for (const a of audit) {
      expect(a.row).not.toContain(token.slice(4));
      expect(a.row).not.toContain(hash);
    }
    expect(audit.some((a) => a.row.includes('device.enrollment_token_created'))).toBe(true);
  });

  it('validates the name and the expiry', async () => {
    expect((await admin.post(o('/enrollment-tokens'), { name: ' ' })).status).toBe(400);
    expect((await admin.post(o('/enrollment-tokens'), { name: 'Old', expires_at: new Date(t.clock.now.getTime() - 60_000).toISOString() })).status).toBe(400);
  });

  it('only organization-wide device managers can create, list or revoke', async () => {
    expect((await mia.get(o('/enrollment-tokens'))).status).toBe(403);
    expect((await mia.post(o('/enrollment-tokens'), { name: 'x' })).status).toBe(403);
    expect((await mia.del(o(`/enrollment-tokens/${tokenId}`))).status).toBe(403);
    // Another organization cannot see or revoke it.
    expect((await other.get(`/orgs/${otherOrg}/enrollment-tokens`)).body).toEqual([]);
    expect((await other.del(`/orgs/${otherOrg}/enrollment-tokens/${tokenId}`)).status).toBe(404);
  });
});

describe('signing in on an enrolled computer', () => {
  let enrolledAccess: string;

  it('without a token, approval is still required (unchanged)', async () => {
    const r = await login({ email: 'bo@enroll.test' }); // Bo is in the other org, which does not require approval
    expect(r.status).toBe(201);
    const w = await login({ email: 'walt@enroll.test', organization_id: orgId });
    expect(w.status).toBe(201);
    expect(w.body.status).toBe('PENDING');
  });

  it('with a token, the device joins its organization already approved, without asking which one', async () => {
    // Walt is in two organizations; the token decides, with no organization_required round trip.
    const r = await login({ email: 'walt@enroll.test', enrollment_token: token });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ organization_id: orgId, status: 'ACTIVE' });
    enrolledAccess = r.body.access_token;
    const c = new Client(t);
    c.bearer = enrolledAccess;
    expect((await c.get('/agent/bootstrap')).body.device.status).toBe('ACTIVE');
    const tokens = (await admin.get(o('/enrollment-tokens'))).body;
    expect(tokens[0]).toMatchObject({ use_count: 1 });
    expect(tokens[0].last_used_at).not.toBeNull();
    const devices = (await admin.get(o('/devices'))).body as Array<{ id: string; enrolled: boolean; status: string }>;
    expect(devices.find((d) => d.id === r.body.device_id)).toMatchObject({ enrolled: true, status: 'ACTIVE' });
  });

  it('a token never replaces the password or the second factor', async () => {
    const r = await login({ email: 'walt@enroll.test', password: 'wrong-password-1', enrollment_token: token });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('invalid_credentials');
  });

  it('refuses another organization: choosing it, or a person who is not a member', async () => {
    const before = (await system<{ n: number }>(sql`select count(*)::int as n from devices`))[0]!.n;
    const chose = await login({ email: 'walt@enroll.test', organization_id: otherOrg, enrollment_token: token });
    expect(chose.status).toBe(403);
    expect(chose.body.code).toBe('enrollment_other_org');
    const stranger = await login({ email: 'bo@enroll.test', enrollment_token: token });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe('enrollment_other_org');
    expect((await system<{ n: number }>(sql`select count(*)::int as n from devices`))[0]!.n).toBe(before);
  });

  it('refuses the browser sign-in for another organization', async () => {
    const bo = new Client(t);
    await bo.post('/auth/login', { email: 'bo@enroll.test', password: PASSWORD });
    const { verifier, challenge } = pkce();
    const code = await bo.post('/agent/authorize', { code_challenge: challenge, organization_id: otherOrg });
    const r = await new Client(t).post('/agent/register', { code: code.body.code, code_verifier: verifier, enrollment_token: token, device: DEVICE });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('enrollment_other_org');
  });

  it('accepts the browser sign-in for its own organization, approved', async () => {
    const walt = new Client(t);
    await walt.post('/auth/login', { email: 'walt@enroll.test', password: PASSWORD });
    const { verifier, challenge } = pkce();
    const code = await walt.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const r = await new Client(t).post('/agent/register', { code: code.body.code, code_verifier: verifier, enrollment_token: token, device: DEVICE });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('ACTIVE');
  });

  it('rejects a malformed or unknown token', async () => {
    expect((await login({ email: 'walt@enroll.test', enrollment_token: 'wpe_ not a token' })).status).toBe(400);
    const unknown = await login({ email: 'walt@enroll.test', enrollment_token: `wpe_${'A'.repeat(43)}` });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe('enrollment_invalid');
  });

  it('after revoking, new sign-ins are refused but enrolled computers keep working', async () => {
    expect((await admin.del(o(`/enrollment-tokens/${tokenId}`))).status).toBe(204);
    expect((await admin.get(o('/enrollment-tokens'))).body[0].status).toBe('REVOKED');
    const r = await login({ email: 'walt@enroll.test', enrollment_token: token });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('enrollment_invalid');
    const c = new Client(t);
    c.bearer = enrolledAccess;
    expect((await c.post('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: null })).status).toBe(200);
    // Revoking twice is fine.
    expect((await admin.del(o(`/enrollment-tokens/${tokenId}`))).status).toBe(204);
  });

  it('refuses an expired token', async () => {
    const r = await admin.post(o('/enrollment-tokens'), { name: 'Short', expires_at: new Date(t.clock.now.getTime() + 3600_000).toISOString() });
    t.clock.set(new Date(t.clock.now.getTime() + 2 * 3600_000));
    const e = await login({ email: 'walt@enroll.test', enrollment_token: r.body.token });
    expect(e.status).toBe(401);
    expect(e.body.code).toBe('enrollment_invalid');
    expect((await admin.get(o('/enrollment-tokens'))).body.find((x: { id: string }) => x.id === r.body.id).status).toBe('EXPIRED');
  });

  it('keeps the sign-in rate limit with a token', async () => {
    const fresh = await admin.post(o('/enrollment-tokens'), { name: 'Limit' });
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await login({ email: 'walt@enroll.test', password: 'wrong-password-1', enrollment_token: fresh.body.token }, { 'x-test-rate-limit': 'on' })).status);
    expect(statuses).toContain(429);
  });
});
