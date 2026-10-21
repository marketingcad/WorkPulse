import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId, nextCleanupAt } from '@tallywork/domain';
import { runTick } from '../src/jobs';
import { cleanupBatch, processScreenshotCleanup } from '../src/services/screenshot-cleanup';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Screenshot retention & cleanup: settings, preview, approval, the background run (batches, storage
// first, retries, recovery), and that nothing else is touched.
let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let ben: Client;
let benId: string;
let sessionId: string;
let other: Client;
let otherOrg: string;
let otherSession: string;
let otherMember: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const DAY = 86_400_000;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

/** A stored screenshot (image + thumbnail) captured `ms` before now. */
async function shot(ms: number, org = orgId, member = benId, session = sessionId, bytes = 1000) {
  const id = newId();
  const key = `org/${org}/screenshots/${member}/${id}.jpg`;
  await t.storage.put(key, Buffer.from('img'), 'image/jpeg');
  await t.storage.put(`${key}.thumb`, Buffer.from('t'), 'image/jpeg');
  const at = new Date(t.clock.now.getTime() - ms).toISOString();
  await asOwner(sql`insert into screenshots (id, organization_id, session_id, membership_id, captured_at, storage_key, bytes, status, window_start) values (${id}, ${org}, ${session}, ${member}, ${at}, ${key}, ${bytes}, 'READY', ${at})`);
  return { id, key };
}
const exists = async (id: string) => (await asOwner<{ id: string }>(sql`select id from screenshots where id = ${id}`)).length === 1;
const stored = (key: string) => t.storage.objects.has(key) && t.storage.objects.has(`${key}.thumb`);
const gone = (key: string) => !t.storage.objects.has(key) && !t.storage.objects.has(`${key}.thumb`);
const countOf = async (table: string) => (await asOwner<{ n: number }>(sql`select count(*)::int n from ${sql.raw(table)} where organization_id = ${orgId}`))[0]!.n;
const auditActions = async () => (await asOwner<{ action: string }>(sql`select action from audit_logs where organization_id = ${orgId} and action like 'screenshot_cleanup.%' order by created_at, id`)).map((r) => r.action);

async function wipeScreenshots() {
  await asOwner(sql`delete from screenshots`);
  await asOwner(sql`delete from screenshot_cleanup_runs`);
  t.storage.objects.clear();
}
async function approve() {
  const p = await admin.post(o('/screenshot-cleanup/preview'));
  expect(p.status).toBe(201);
  const a = await admin.post(o('/screenshot-cleanup/approve'), { preview_id: p.body.id });
  expect(a.status).toBe(200);
  return p.body;
}
const settings = (over: Record<string, unknown> = {}) => ({ enabled: true, retention_days: 30, frequency: 'DAILY', run_at: '02:00', weekday: 0, timezone: 'UTC', retry_failed: true, ...over });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-21T07:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@clean.test'));
  ({ client: manager } = await addMember(t, admin, orgId, 'Mona', 'mona@clean.test', 'TEAM_MANAGER'));
  ({ client: ben, membershipId: benId } = await addMember(t, admin, orgId, 'Ben', 'ben@clean.test'));
  const project = (await admin.post(o('/projects'), { name: 'Site', member_ids: [benId] })).body.id;
  sessionId = (await ben.post(o('/tracking/start'), { project_id: project })).body.session.id;
  t.clock.set(new Date('2026-10-21T08:00:00Z'));
  await ben.post(o('/tracking/stop'));

  // A second organization, whose screenshots must never be touched.
  ({ client: other, orgId: otherOrg } = await signup(t, 'Olga', 'olga@other.test'));
  let worker: Client;
  ({ client: worker, membershipId: otherMember } = await addMember(t, other, otherOrg, 'Oscar', 'oscar@other.test'));
  const p2 = (await other.post(`/orgs/${otherOrg}/projects`, { name: 'X', member_ids: [otherMember] })).body.id;
  otherSession = (await worker.post(`/orgs/${otherOrg}/tracking/start`, { project_id: p2 })).body.session.id;
  await worker.post(`/orgs/${otherOrg}/tracking/stop`);
  t.clock.set(new Date('2026-10-21T10:00:00Z'));
});
afterAll(() => t.close());
beforeEach(async () => {
  await wipeScreenshots();
  // Back to the defaults, approval cleared.
  await asOwner(sql`delete from screenshot_cleanup_settings`);
  t.clock.set(new Date('2026-10-21T10:00:00Z'));
});

describe('settings', () => {
  it('starts enabled: 30 days, daily at 02:00 in the organization’s time zone, not yet approved', async () => {
    const r = await admin.get(o('/screenshot-cleanup'));
    expect(r.status).toBe(200);
    const tz = (await admin.get(o(''))).body.organization.timezone;
    expect(r.body).toMatchObject({ enabled: true, retention_days: 30, frequency: 'DAILY', run_at: '02:00', timezone: null, effective_timezone: tz, retry_failed: true, approval: { approved: false }, can_manage: true });
    expect(r.body.next_run_at).toBe(nextCleanupAt(t.clock.now, { frequency: 'DAILY', runAt: '02:00', weekday: 0 }, tz).toISOString());
  });

  it('saves, and runs at 02:00 in a chosen time zone', async () => {
    const r = await admin.put(o('/screenshot-cleanup'), settings({ retention_days: 14, timezone: 'Asia/Manila' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ retention_days: 14, timezone: 'Asia/Manila', effective_timezone: 'Asia/Manila' });
    // 10:00 UTC is 18:00 in Manila; the next 02:00 Manila is 18:00 UTC.
    expect(r.body.next_run_at).toBe('2026-10-21T18:00:00.000Z');
    expect((await admin.get(o('/screenshot-cleanup'))).body.retention_days).toBe(14);
    expect(await auditActions()).toContain('screenshot_cleanup.updated');
  });

  it('refuses invalid settings', async () => {
    for (const bad of [settings({ retention_days: 0 }), settings({ retention_days: 4000 }), settings({ run_at: '24:00' }), settings({ run_at: '2am' }), settings({ timezone: 'Mars/Olympus' }), settings({ frequency: 'HOURLY' }), settings({ weekday: 7 })]) {
      const r = await admin.put(o('/screenshot-cleanup'), bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('only administrators who manage retention can change it, preview, approve or run it', async () => {
    for (const c of [ben, manager]) {
      expect((await c.get(o('/screenshot-cleanup'))).status).toBe(403);
      expect((await c.put(o('/screenshot-cleanup'), settings())).status).toBe(403);
      expect((await c.post(o('/screenshot-cleanup/preview'))).status).toBe(403);
      expect((await c.post(o('/screenshot-cleanup/approve'), { preview_id: newId() })).status).toBe(403);
      expect((await c.post(o('/screenshot-cleanup/runs'))).status).toBe(403);
      expect((await c.get(o('/screenshot-cleanup/runs'))).status).toBe(403);
    }
    // Another organization's administrator cannot reach this one.
    expect((await other.get(o('/screenshot-cleanup'))).status).toBe(404);
  });
});

describe('preview and approval', () => {
  it('previews without deleting: counts, size, oldest and newest, and the cutoff', async () => {
    const a = await shot(45 * DAY, orgId, benId, sessionId, 2000);
    const b = await shot(31 * DAY, orgId, benId, sessionId, 3000);
    const keep = await shot(29 * DAY);
    const p = await admin.post(o('/screenshot-cleanup/preview'));
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ trigger: 'PREVIEW', status: 'PREVIEWED', cutoff: '2026-09-21T10:00:00.000Z', preview: { eligible: 2, eligible_bytes: 5000, excluded: 0 } });
    expect(p.body.preview.oldest_at).toBe(new Date(t.clock.now.getTime() - 45 * DAY).toISOString());
    expect(p.body.preview.newest_at).toBe(new Date(t.clock.now.getTime() - 31 * DAY).toISOString());
    for (const s of [a, b, keep]) {
      expect(await exists(s.id)).toBe(true);
      expect(stored(s.key)).toBe(true);
    }
    expect(await auditActions()).toContain('screenshot_cleanup.previewed');
  });

  it('nothing is deleted before approval: not by a manual request, not by the schedule', async () => {
    const old = await shot(60 * DAY);
    const r = await admin.post(o('/screenshot-cleanup/runs'));
    expect([r.status, r.body.code]).toEqual([409, 'approval_required']);
    await admin.get(o('/screenshot-cleanup')); // the schedule needs a settings row to be due
    await admin.put(o('/screenshot-cleanup'), settings());
    t.clock.set(new Date('2026-10-22T02:05:00Z'));
    await runTick(t.deps);
    expect(await exists(old.id)).toBe(true);
    expect(stored(old.key)).toBe(true);
    expect((await asOwner(sql`select id from screenshot_cleanup_runs where trigger <> 'PREVIEW'`)).length).toBe(0);
    // The schedule moved on to the next day.
    expect((await admin.get(o('/screenshot-cleanup'))).body.next_run_at).toBe('2026-10-23T02:00:00.000Z');
  });

  it('approval is for the policy previewed: a shorter period afterwards needs a new preview', async () => {
    const p = (await admin.post(o('/screenshot-cleanup/preview'))).body;
    await admin.put(o('/screenshot-cleanup'), settings({ retention_days: 14 }));
    const stale = await admin.post(o('/screenshot-cleanup/approve'), { preview_id: p.id });
    expect([stale.status, stale.body.code]).toEqual([409, 'preview_stale']);

    await approve();
    const ok = (await admin.get(o('/screenshot-cleanup'))).body;
    expect(ok.approval).toMatchObject({ approved: true, approved_by_name: 'Ada' });
    // Shortening the period again withdraws the approval; a longer one keeps it.
    expect((await admin.put(o('/screenshot-cleanup'), settings({ retention_days: 60 }))).body.approval.approved).toBe(true);
    expect((await admin.put(o('/screenshot-cleanup'), settings({ retention_days: 7 }))).body.approval.approved).toBe(false);
    expect(await auditActions()).toContain('screenshot_cleanup.approved');
  });

  it('answers with rate limiting on, and allows at most 10 manual runs an hour', async () => {
    const within = <T>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no response within ${ms}ms`)), ms))]);
    const on = { 'x-test-rate-limit': 'on' };
    const p = await within(admin.req<{ id: string }>('POST', o('/screenshot-cleanup/preview'), undefined, on));
    expect(p.status).toBe(201);
    expect((await within(admin.req('POST', o('/screenshot-cleanup/approve'), { preview_id: p.body.id }, on))).status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await within(admin.req('POST', o('/screenshot-cleanup/runs'), undefined, on))).status);
      await processScreenshotCleanup(t.deps);
    }
    expect(statuses).toEqual([...Array(10).fill(202), 429]);
    // An hour later it is allowed again.
    t.clock.set(new Date(t.clock.now.getTime() + 3600_000 + 1000));
    expect((await within(admin.req('POST', o('/screenshot-cleanup/runs'), undefined, on))).status).toBe(202);
  });

  it('a preview older than a day cannot be approved', async () => {
    const p = (await admin.post(o('/screenshot-cleanup/preview'))).body;
    t.clock.set(new Date(t.clock.now.getTime() + DAY + 60_000));
    expect((await admin.post(o('/screenshot-cleanup/approve'), { preview_id: p.id })).status).toBe(409);
  });
});

describe('cleanup run', () => {
  it('deletes expired screenshots and their files; keeps newer ones, the one exactly at the cutoff, other organizations and all other records', async () => {
    const old1 = await shot(45 * DAY, orgId, benId, sessionId, 2000);
    const old2 = await shot(30 * DAY + 1, orgId, benId, sessionId, 3000);
    const atCutoff = await shot(30 * DAY);
    const fresh = await shot(2 * DAY);
    const foreign = await shot(90 * DAY, otherOrg, otherMember, otherSession);
    const before = { entries: await countOf('time_entries'), sessions: await countOf('tracking_sessions'), billing: await countOf('billing_entries') };
    await approve();

    const r = await admin.post(o('/screenshot-cleanup/runs'));
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ trigger: 'MANUAL', status: 'RUNNING', cutoff: '2026-09-21T10:00:00.000Z' });
    // A second request while it runs is refused.
    expect((await admin.post(o('/screenshot-cleanup/runs'))).body.code).toBe('cleanup_running');

    await processScreenshotCleanup(t.deps);
    const run = (await admin.get(o(`/screenshot-cleanup/runs/${r.body.id}`))).body;
    expect(run).toMatchObject({ status: 'SUCCEEDED', scanned: 2, deleted: 2, objects_removed: 4, bytes_reclaimed: 5000, failed: 0 });
    for (const s of [old1, old2]) {
      expect(await exists(s.id)).toBe(false);
      expect(gone(s.key)).toBe(true);
    }
    for (const s of [atCutoff, fresh, foreign]) {
      expect(await exists(s.id)).toBe(true);
      expect(stored(s.key)).toBe(true);
    }
    expect({ entries: await countOf('time_entries'), sessions: await countOf('tracking_sessions'), billing: await countOf('billing_entries') }).toEqual(before);
    expect(await auditActions()).toEqual(expect.arrayContaining(['screenshot_cleanup.requested', 'screenshot_cleanup.completed']));
    // History and status.
    const history = (await admin.get(o('/screenshot-cleanup/runs'))).body;
    expect(history.map((h: { trigger: string }) => h.trigger)).toEqual(['MANUAL', 'PREVIEW']);
    expect((await admin.get(o('/screenshot-cleanup'))).body.last_run).toMatchObject({ id: r.body.id, status: 'SUCCEEDED' });
    // Another organization cannot read this run.
    expect((await other.get(`/orgs/${otherOrg}/screenshot-cleanup/runs/${r.body.id}`)).status).toBe(404);
  });

  it('runs on schedule at 02:00 in the organization’s time, in batches, and moves to the next day', async () => {
    const olds = [];
    for (let i = 0; i < 5; i++) olds.push(await shot((40 + i) * DAY));
    await admin.put(o('/screenshot-cleanup'), settings());
    await approve();
    t.clock.set(new Date('2026-10-22T01:59:00Z'));
    await runTick(t.deps);
    expect(await exists(olds[0]!.id)).toBe(true);
    t.clock.set(new Date('2026-10-22T02:00:30Z'));
    await runTick(t.deps);
    for (const s of olds) expect(await exists(s.id)).toBe(false);
    const s = (await admin.get(o('/screenshot-cleanup'))).body;
    expect(s.last_run).toMatchObject({ trigger: 'SCHEDULED', status: 'SUCCEEDED', deleted: 5 });
    expect(s.next_run_at).toBe('2026-10-23T02:00:00.000Z');
    expect(await auditActions()).toEqual(expect.arrayContaining(['screenshot_cleanup.started', 'screenshot_cleanup.completed']));
  });

  it('when turned off, the schedule deletes nothing', async () => {
    const old = await shot(60 * DAY);
    await approve();
    await admin.put(o('/screenshot-cleanup'), settings({ enabled: false }));
    expect((await admin.get(o('/screenshot-cleanup'))).body.next_run_at).toBeNull();
    t.clock.set(new Date('2026-10-25T02:05:00Z'));
    await runTick(t.deps);
    expect(await exists(old.id)).toBe(true);
  });

  it('a failed storage deletion is recorded, the row is kept, and a later run retries it', async () => {
    const bad = await shot(50 * DAY);
    const good = await shot(40 * DAY);
    await approve();
    const realDelete = t.storage.delete.bind(t.storage);
    t.storage.delete = async (keys: string[]) => {
      if (keys.some((k) => k.startsWith(bad.key))) throw new Error(`Supabase Storage delete failed (503): https://x.supabase.co/${bad.key} token=abc`);
      return realDelete(keys);
    };
    try {
      const r = (await admin.post(o('/screenshot-cleanup/runs'))).body;
      await processScreenshotCleanup(t.deps);
      const run = (await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body;
      expect(run).toMatchObject({ status: 'PARTIAL', deleted: 1, failed: 1 });
      // The error is kept without the URL, the object key or the token.
      expect(run.error).toMatch(/could not be deleted from storage/);
      expect(run.error).not.toMatch(/supabase\.co|token=abc|org\//);
      expect(await exists(bad.id)).toBe(true);
      expect(stored(bad.key)).toBe(true);
      expect(await exists(good.id)).toBe(false);
      const [row] = await asOwner<{ purge_attempts: number; purge_error: string }>(sql`select purge_attempts, purge_error from screenshots where id = ${bad.id}`);
      expect(row!.purge_attempts).toBe(1);
    } finally {
      t.storage.delete = realDelete;
    }
    // Once storage works again and the retry wait is over, the next run removes it.
    t.clock.set(new Date(t.clock.now.getTime() + 10 * 60_000));
    const r2 = (await admin.post(o('/screenshot-cleanup/runs'))).body;
    await processScreenshotCleanup(t.deps);
    expect((await admin.get(o(`/screenshot-cleanup/runs/${r2.id}`))).body).toMatchObject({ status: 'SUCCEEDED', deleted: 1, retries: 1 });
    expect(await exists(bad.id)).toBe(false);
    expect(gone(bad.key)).toBe(true);
  });

  it('a run interrupted between batches loses nothing: the next tick finishes it', async () => {
    const olds = [];
    for (let i = 0; i < 5; i++) olds.push(await shot((40 + i) * DAY));
    await approve();
    const r = (await admin.post(o('/screenshot-cleanup/runs'))).body;
    // One batch of two, then the worker "dies".
    expect(await cleanupBatch(t.deps, orgId, r.id, 2)).toBe('more');
    let run = (await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body;
    expect(run).toMatchObject({ status: 'RUNNING', deleted: 2 });
    // A restarted worker continues from what is left.
    await processScreenshotCleanup(t.deps);
    run = (await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body;
    expect(run).toMatchObject({ status: 'SUCCEEDED', deleted: 5, scanned: 5 });
    for (const s of olds) expect(gone(s.key)).toBe(true);
  });

  it('a storage deletion that succeeded before a crash is safe to repeat', async () => {
    const old = await shot(50 * DAY);
    await approve();
    const r = (await admin.post(o('/screenshot-cleanup/runs'))).body;
    // The files went, but the database step never committed: the row is still there.
    await t.storage.delete([old.key, `${old.key}.thumb`]);
    await processScreenshotCleanup(t.deps);
    expect((await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body).toMatchObject({ status: 'SUCCEEDED', deleted: 1 });
    expect(await exists(old.id)).toBe(false);
  });

  it('two workers at once do not delete or count anything twice', async () => {
    for (let i = 0; i < 8; i++) await shot((40 + i) * DAY);
    await approve();
    const r = (await admin.post(o('/screenshot-cleanup/runs'))).body;
    await Promise.all([processScreenshotCleanup(t.deps), processScreenshotCleanup(t.deps)]);
    expect((await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body).toMatchObject({ status: 'SUCCEEDED', deleted: 8, scanned: 8 });
    expect(await asOwner(sql`select id from screenshot_cleanup_runs where status = 'RUNNING'`)).toEqual([]);
  });

  it('a shorter period while a run is going stops it before it deletes more', async () => {
    for (let i = 0; i < 4; i++) await shot((40 + i) * DAY);
    await approve();
    const r = (await admin.post(o('/screenshot-cleanup/runs'))).body;
    expect(await cleanupBatch(t.deps, orgId, r.id, 1)).toBe('more');
    await admin.put(o('/screenshot-cleanup'), settings({ retention_days: 7 }));
    await processScreenshotCleanup(t.deps);
    expect((await admin.get(o(`/screenshot-cleanup/runs/${r.id}`))).body).toMatchObject({ status: 'CANCELLED', deleted: 1 });
    expect((await asOwner(sql`select id from screenshots where organization_id = ${orgId}`)).length).toBe(3);
  });

  it('repeated failures notify administrators once per incident, not on every run', async () => {
    await asOwner(sql`delete from notifications where type = 'screenshot_cleanup.alert'`);
    await approve();
    const realDelete = t.storage.delete.bind(t.storage);
    t.storage.delete = async () => {
      throw new Error('Storage unavailable');
    };
    try {
      for (let i = 0; i < 3; i++) {
        await shot((40 + i) * DAY);
        await admin.post(o('/screenshot-cleanup/runs'));
        await processScreenshotCleanup(t.deps);
        t.clock.set(new Date(t.clock.now.getTime() + 3600_000));
      }
    } finally {
      t.storage.delete = realDelete;
    }
    const runs = await asOwner<{ status: string }>(sql`select status from screenshot_cleanup_runs where trigger = 'MANUAL' order by started_at`);
    expect(runs.map((r) => r.status)).toEqual(['FAILED', 'FAILED', 'FAILED']);
    const alerts = await asOwner<{ title: string }>(sql`select title from notifications where organization_id = ${orgId} and type = 'screenshot_cleanup.alert'`);
    expect(alerts.map((a) => a.title)).toEqual(['Screenshot cleanup keeps failing']);
  });

  it('reports storage from the recorded sizes', async () => {
    await shot(45 * DAY, orgId, benId, sessionId, 4000);
    await shot(2 * DAY, orgId, benId, sessionId, 1000);
    await shot(90 * DAY, otherOrg, otherMember, otherSession, 9999);
    const s = (await admin.get(o('/screenshot-cleanup/storage'))).body;
    expect(s).toEqual({ screenshots: 2, recorded_bytes: 5000, reclaimable_screenshots: 1, reclaimable_bytes: 4000, stuck: 0 });
  });
});
