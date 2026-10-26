import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { clients } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { dispatchOutbox } from '../src/jobs';
import { assertPublicUrl, isPrivateAddress, postToPublicUrl, publicOnlyLookup } from '../src/lib/ssrf';
import { RETRY_SCHEDULE_MINUTES, deliverWebhooks } from '../src/services/platform';
import { registerProvider, runSyncs } from '../src/services/integrations';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Phase 12 gate: scoped API keys, signed webhooks with retries, SSRF guard, integration framework.
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let respond = 200;

/** The verification sample from docs/api/README.md, as a consumer would write it. */
function verifyTallyworkSignature(secret: string, header: string, rawBody: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
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
  t.clock.set(new Date('2026-09-23T20:00:00Z'));
  t.deps.httpPost = async (url, headers, body) => {
    sent.push({ url, headers, body });
    return { status: respond, body: respond === 200 ? 'ok' : 'nope' };
  };
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@int.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@int.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [workerId] })).body.id;
  await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: '2026-09-15T13:00:00Z', ended_at: '2026-09-15T15:00:00Z', reason: 'x' });
});
afterAll(() => t.close());

describe('acceptance: an external consumer', () => {
  let key: string;
  let secret: string;
  const consumer = () => {
    const c = new Client(t);
    c.bearer = key;
    return c;
  };

  it('reads timesheets with read:timesheets, is denied billing and everything else', async () => {
    const k = await admin.post(o('/api-keys'), { name: 'Payroll sync', scopes: ['read:timesheets'] });
    expect(k.status).toBe(201);
    key = k.body.key;
    const c = consumer();
    expect((await c.get(o(`/timesheets?membership_id=${workerId}&date=2026-09-15`))).body).toMatchObject({ membership_id: workerId, total_seconds: 7200 });
    expect((await c.get(o('/timesheets/approvals'))).status).toBe(403); // the approval queue needs the approve permission
    expect((await c.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).status).toBe(403);
    // Endpoints tied to the key creator's own account are closed to keys, whatever the scope.
    for (const [m, p, b] of [['GET', '/notifications'], ['GET', '/notification-preferences'], ['PUT', '/dashboard/layout', { scope: 'ALL', widgets: [] }], ['POST', '/tracking/start', { project_id: projectId }], ['GET', '/stream'], ['GET', '/report-runs'], ['POST', '/timesheets/submit', { date: '2026-09-15' }]] as const) {
      expect((await c.req(m, o(p), b)).status, `${m} ${p}`).toBe(403);
    }
  });

  it('receives a signed timesheet.approved webhook it can verify', async () => {
    const w = await admin.post(o('/webhooks'), { url: 'https://93.184.216.34/hooks/tallywork', events: ['timesheet.approved'], enabled: true });
    expect(w.status).toBe(201);
    secret = w.body.secret;
    const ts = await worker.post(o('/timesheets/submit'), { date: '2026-09-15' });
    await admin.post(o(`/timesheets/${ts.body.id}/approve`), {});
    await dispatchOutbox(t.deps, 100);
    sent.length = 0;
    expect(await deliverWebhooks(t.deps)).toBe(1);
    const [req] = sent;
    expect(req!.url).toBe('https://93.184.216.34/hooks/tallywork');
    expect(req!.headers['Tallywork-Event']).toBe('timesheet.approved');
    const body = JSON.parse(req!.body);
    expect(body).toMatchObject({ event_type: 'timesheet.approved', organization_id: orgId, data: { membership_id: workerId, period_start: '2026-09-14' } });
    const now = Math.floor(t.clock.now.getTime() / 1000);
    expect(verifyTallyworkSignature(secret, req!.headers['Tallywork-Signature']!, req!.body, now)).toBe(true);
    expect(verifyTallyworkSignature(secret, req!.headers['Tallywork-Signature']!, req!.body.replace('approved', 'rejected'), now)).toBe(false); // tampered
    expect(verifyTallyworkSignature(secret, req!.headers['Tallywork-Signature']!, req!.body, now + 600)).toBe(false); // replayed late
    expect(verifyTallyworkSignature('whsec_wrong', req!.headers['Tallywork-Signature']!, req!.body, now)).toBe(false);
  });
});

describe('API keys', () => {
  it('never exceed their creator: scopes are intersected with the creator’s current role', async () => {
    const { client: sysadmin, membershipId: sysId } = await addMember(t, admin, orgId, 'Sam', 'sam@int.test', 'SYSTEM_ADMIN');
    const k = (await sysadmin.post(o('/api-keys'), { name: 'Finance', scopes: ['read:billing'] })).body.key;
    const c = new Client(t);
    c.bearer = k;
    expect((await c.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).status).toBe(200);
    const roles = (await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>;
    await admin.patch(o(`/workers/${sysId}`), { role_id: roles.find((r) => r.key === 'WORKER')!.id });
    expect((await c.get(o('/billing/amounts-owed?from=2026-09-01&to=2026-09-30'))).status).toBe(403);
    // A creator cannot grant what they do not have.
    expect((await worker.post(o('/api-keys'), { name: 'x', scopes: ['read:time'] })).status).toBe(403);
  });

  it('are shown once and never stored or logged in clear', async () => {
    const r = await admin.post(o('/api-keys'), { name: 'Once', scopes: ['read:projects'] });
    // tw_live_<prefix>_<secret>: the secret is base64url and can itself contain "_".
    const secretPart = (r.body.key as string).split('_').slice(3).join('_');
    expect(secretPart.length).toBeGreaterThanOrEqual(40);
    const listed = JSON.stringify((await admin.get(o('/api-keys'))).body);
    expect(listed).not.toContain(secretPart);
    expect(listed).toContain(r.body.key.split('_').slice(0, 3).join('_')); // prefix only
    const stored = JSON.stringify(await asOwner(sql`select * from api_keys`));
    const logged = JSON.stringify(await asOwner(sql`select * from audit_logs`));
    expect(stored).not.toContain(secretPart);
    expect(logged).not.toContain(secretPart);
    // Revoked keys stop working immediately.
    const c = new Client(t);
    c.bearer = r.body.key;
    expect((await c.get(o('/projects'))).status).toBe(200);
    await admin.del(o(`/api-keys/${r.body.id}`));
    expect((await c.get(o('/projects'))).status).toBe(401);
  });

  it('are rate limited per key', async () => {
    const c = new Client(t);
    c.bearer = (await admin.post(o('/api-keys'), { name: 'Busy', scopes: ['read:projects'] })).body.key;
    const statuses: number[] = [];
    for (let i = 0; i < 601; i++) statuses.push((await c.req('GET', o('/projects'), undefined, { 'x-test-rate-limit': 'on' })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(600);
    expect(statuses.at(-1)).toBe(429);
  }, 120_000);

  it('write scopes only open their own resource', async () => {
    const k = (await admin.post(o('/api-keys'), { name: 'PM sync', scopes: ['write:projects', 'read:projects'] })).body.key;
    const c = new Client(t);
    c.bearer = k;
    expect((await c.post(o('/projects'), { name: 'From API' })).status).toBe(201);
    expect((await c.post(o('/clients'), { name: 'Nope' })).status).toBe(403);
    expect((await c.put(o(`/policies/ORG/${orgId}`), { screenshots: { enabled: true } })).status).toBe(403);
  });
});

describe('webhooks', () => {
  let endpoint: string;
  it('retry on the documented schedule, then give up; replay sends again', async () => {
    const w = await admin.post(o('/webhooks'), { url: 'https://93.184.216.34/retry', events: ['*'], enabled: true });
    endpoint = w.body.id;
    await admin.post(o(`/webhooks/${endpoint}/test`));
    respond = 500;
    const due = async () => (await admin.get(o(`/webhooks/${endpoint}/deliveries`))).body[0] as { id: string; attempt: number; status: string; next_attempt_at: string | null };
    const start = t.clock.now.getTime();
    let expectedAt = start;
    for (let i = 0; i < RETRY_SCHEDULE_MINUTES.length + 1; i++) {
      t.clock.set(new Date(expectedAt + 1000));
      await deliverWebhooks(t.deps);
      const d = await due();
      expect(d.attempt).toBe(i + 1);
      if (i < RETRY_SCHEDULE_MINUTES.length) {
        expectedAt = t.clock.now.getTime() + RETRY_SCHEDULE_MINUTES[i]! * 60_000;
        expect([d.status, Date.parse(d.next_attempt_at!)]).toEqual(['PENDING', expectedAt]);
        // Nothing is sent before it is due.
        t.clock.set(new Date(expectedAt - 1000));
        expect(await deliverWebhooks(t.deps)).toBe(0);
      } else {
        expect([d.status, d.next_attempt_at]).toEqual(['DEAD', null]);
      }
    }
    respond = 200;
    const dead = await due();
    const replay = await admin.post(o(`/webhooks/${endpoint}/deliveries/${dead.id}/replay`));
    expect(replay.status).toBe(200);
    expect(await deliverWebhooks(t.deps)).toBe(1);
    expect((await due()).status).toBe('SUCCEEDED');
  });

  it('rotating the secret invalidates the old one', async () => {
    const before = sent.length;
    const r = await admin.post(o(`/webhooks/${endpoint}/rotate-secret`));
    expect(r.body.secret).toMatch(/^whsec_/);
    await admin.post(o(`/webhooks/${endpoint}/test`));
    await deliverWebhooks(t.deps);
    const req = sent[sent.length - 1]!;
    expect(sent.length).toBe(before + 1);
    const now = Math.floor(t.clock.now.getTime() / 1000);
    expect(verifyTallyworkSignature(r.body.secret, req.headers['Tallywork-Signature']!, req.body, now)).toBe(true);
    expect(JSON.stringify((await admin.get(o('/webhooks'))).body)).not.toContain(r.body.secret);
  });
});

describe('SSRF guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', 'fec0::1', 'ff02::1', '2001:db8::1'])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it.each([
    ['http://93.184.216.34/x', 'insecure_url'],
    ['https://localhost/x', 'private_url'],
    ['https://metadata.internal/x', 'private_url'],
    ['https://169.254.169.254/latest/meta-data', 'private_url'],
    ['https://[::1]/x', 'private_url'],
    ['https://[::ffff:127.0.0.1]/x', 'private_url'],
    ['https://2130706433/x', 'private_url'], // decimal 127.0.0.1
    ['https://0x7f000001/x', 'private_url'], // hex
    ['https://0177.0.0.1/x', 'private_url'], // octal
    ['https://user:pw@93.184.216.34/x', 'invalid_url'],
  ])('rejects %s when saving', async (url, code) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({ code });
  });

  it('checks the address again when connecting (DNS rebinding) and never follows redirects', async () => {
    // A name that resolves to a private address is refused at connect time, whatever it resolved to before.
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup('localhost', {}, (e) => resolve(e)));
    expect(err?.code).toBe('EPRIVATE');
    await expect(postToPublicUrl('https://127.0.0.1/x', {}, '{}', 1000)).rejects.toThrow(/non-public/);
    await expect(postToPublicUrl('https://localhost/x', {}, '{}', 1000)).rejects.toMatchObject({ code: 'private_url' });
    // Saving refuses the same (and the web form can't bypass it).
    expect((await admin.post(o('/webhooks'), { url: 'https://10.0.0.5/x', events: ['*'], enabled: true })).status).toBe(400);
  });
});

describe('integration framework', () => {
  beforeAll(() => {
    // A provider that imports clients from its settings, as a real one would from an external API.
    registerProvider({
      key: 'test-crm',
      name: 'Test CRM',
      configSchema: z.object({ accounts: z.array(z.object({ id: z.string(), name: z.string() })) }) as unknown as z.ZodType<Record<string, unknown>>,
      async sync(ctx) {
        if (ctx.secret !== 'crm-token') throw new Error('CRM rejected the credentials');
        let created = 0;
        let updated = 0;
        for (const a of (ctx.config as { accounts: Array<{ id: string; name: string }> }).accounts) {
          const existing = await ctx.refs.find('client', a.id);
          if (existing) {
            await ctx.tx.update(clients).set({ name: a.name }).where(sql`${clients.id} = ${existing}`);
            updated++;
          } else {
            const [c] = await ctx.tx.insert(clients).values({ id: newId(), organizationId: ctx.organizationId, name: a.name }).returning({ id: clients.id });
            await ctx.refs.link('client', c!.id, a.id);
            created++;
          }
        }
        return { created, updated };
      },
    });
  });

  it('connects with encrypted credentials, syncs idempotently via external refs, and records errors', async () => {
    expect((await admin.get(o('/integrations/providers'))).body).toEqual(expect.arrayContaining([{ key: 'test-crm', name: 'Test CRM' }]));
    expect((await worker.post(o('/integrations'), { provider: 'test-crm', name: 'CRM', config: { accounts: [] } })).status).toBe(403);
    expect((await admin.post(o('/integrations'), { provider: 'test-crm', name: 'CRM', config: { accounts: 'nope' } })).status).toBe(400);
    const conn = await admin.post(o('/integrations'), { provider: 'test-crm', name: 'CRM', config: { accounts: [{ id: 'A-1', name: 'Globex' }, { id: 'A-2', name: 'Initech' }] }, secret: 'crm-token' });
    expect(conn.status).toBe(201);
    expect(conn.body).toMatchObject({ has_secret: true });
    expect(JSON.stringify(conn.body)).not.toContain('crm-token');
    expect(JSON.stringify(await asOwner(sql`select secret_enc from integration_connections`))).not.toContain('crm-token');

    await admin.post(o(`/integrations/${conn.body.id}/sync`));
    const ran = await runSyncs(t.deps);
    if (ran !== 1) throw new Error('SYNC ' + JSON.stringify((await admin.get(o('/integrations'))).body));
    await admin.post(o(`/integrations/${conn.body.id}/sync`));
    await runSyncs(t.deps);
    const names = ((await admin.get(o('/clients'))).body as Array<{ name: string }>).map((c) => c.name);
    expect(names.filter((n) => n === 'Globex' || n === 'Initech').sort()).toEqual(['Globex', 'Initech']); // no duplicates
    const listed = (await admin.get(o('/integrations'))).body[0];
    expect(listed).toMatchObject({ status: 'ACTIVE', last_error: null, sync_pending: false });

    const bad = (await admin.post(o('/integrations'), { provider: 'test-crm', name: 'Bad', config: { accounts: [] }, secret: 'wrong' })).body;
    await admin.post(o(`/integrations/${bad.id}/sync`));
    await runSyncs(t.deps);
    const failed = ((await admin.get(o('/integrations'))).body as Array<{ id: string; status: string; last_error: string }>).find((c) => c.id === bad.id)!;
    expect(failed).toMatchObject({ status: 'ERROR', last_error: 'CRM rejected the credentials' });

    const k = new Client(t);
    k.bearer = (await admin.post(o('/api-keys'), { name: 'k', scopes: ['read:clients'] })).body.key;
    expect((await k.get(o('/integrations'))).status).toBe(403);
  });
});
