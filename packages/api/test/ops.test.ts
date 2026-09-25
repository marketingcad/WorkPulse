import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { dispatchOutbox, runTick } from '../src/jobs';
import { opsMetrics, readiness } from '../src/services/ops';
import type { Deps } from '../src/context';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Phase 14 gate: readiness and monitoring, chaos (database outage, event backlog, poison events),
// and a load smoke test for desktop ingest.
let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const cron = { authorization: 'Bearer cron-secret' };

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
/** A copy of the dependencies whose database fails while `down` is set (a simulated outage). */
function flakyDeps(base: Deps) {
  const state = { down: false };
  const db = new Proxy(base.db, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (state.down) return Promise.reject(new Error('connection terminated unexpectedly'));
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { deps: { ...base, db } as Deps, state };
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@ops.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Site' })).body.id;
  await t.flush();
});
afterAll(() => t.close());

describe('health and monitoring', () => {
  it('readiness checks the database; metrics need the cron secret and fire no alerts when healthy', async () => {
    const r = await new Client(t).get('/health/ready');
    expect([r.status, r.body.ok]).toEqual([200, true]);
    expect((await new Client(t).get('/ops/metrics')).status).toBe(401);
    const m = await new Client(t).req<{ metrics: Record<string, number>; alerts: unknown[] }>('GET', '/ops/metrics', undefined, cron);
    expect(m.status).toBe(200);
    expect(m.body.metrics).toMatchObject({ outbox_pending: 0, outbox_parked: 0, webhooks_dead_24h: 0 });
    expect(m.body.alerts).toEqual([]);
  });

  it('readiness reports a database outage as 503', async () => {
    const { deps, state } = flakyDeps(t.deps);
    state.down = true;
    expect(await readiness(deps)).toMatchObject({ ok: false, error: 'connection terminated unexpectedly' });
  });
});

describe('chaos', () => {
  it('a database outage fails the tick without losing events; the backlog drains after recovery and the alert clears', async () => {
    const { deps, state } = flakyDeps(t.deps);
    // Work keeps producing events (the app writes the outbox in the same transaction as the change).
    for (let i = 0; i < 30; i++) await admin.post(o('/projects'), { name: `P${i}` });
    state.down = true;
    await expect(runTick(deps)).rejects.toThrow(/connection terminated/);
    t.clock.set(new Date(t.clock.now.getTime() + 6 * 60_000));
    const during = await opsMetrics(t.deps);
    expect(during.metrics.outbox_pending).toBeGreaterThanOrEqual(30);
    expect(during.alerts.map((a) => a.key)).toContain('outbox_backlog');
    state.down = false;
    let rounds = 0;
    while ((await opsMetrics(t.deps)).metrics.outbox_pending > 0 && rounds++ < 10) await dispatchOutbox(deps, 20);
    const after = await opsMetrics(t.deps);
    expect(after.metrics.outbox_pending).toBe(0);
    expect(after.alerts).toEqual([]);
  });

  it('a poison event is retried, then parked, without blocking other events', async () => {
    const poison = newId();
    await asOwner(sql`insert into outbox_events (id, organization_id, event_type, envelope) values (${poison}, ${orgId}, 'time.changed', ${JSON.stringify({ event_id: poison, event_type: 'time.changed', organization_id: orgId, payload: { membership_id: 'not-a-uuid', dates: ['2026-01-01'] } })}::jsonb)`);
    for (let i = 0; i < 12; i++) {
      await admin.post(o('/projects'), { name: `Q${i}` }); // healthy events keep arriving
      await dispatchOutbox(t.deps, 50);
    }
    const [row] = await asOwner<{ attempts: number; processed_at: Date | null; last_error: string }>(sql`select attempts, processed_at, last_error from outbox_events where id = ${poison}`);
    expect(row).toMatchObject({ attempts: 10, processed_at: null });
    expect(row!.last_error).toBeTruthy();
    const m = await opsMetrics(t.deps);
    expect(m.metrics.outbox_parked).toBe(1);
    expect(m.alerts.map((a) => a.key)).toContain('outbox_parked');
    // Only the parked event is left; everything else was delivered.
    expect(m.metrics.outbox_pending).toBe(1);
    await asOwner(sql`delete from outbox_events where id = ${poison}`);
  });
});

// Latency budgets only mean something without other test files competing for the CPU: CI runs this
// on its own (LOAD_SMOKE=1, see .github/workflows/ci.yml); the parallel suite skips it.
describe.skipIf(!process.env.LOAD_SMOKE)('load smoke', () => {
  it('20 desktop agents syncing activity batches: ingest p95 under 500ms', async () => {
    const agents: Array<{ client: Client; sessionId: string }> = [];
    const members: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { client, membershipId } = await addMember(t, admin, orgId, `Agent ${i}`, `agent${i}@ops.test`);
      members.push(membershipId);
      const { verifier, challenge } = pkce();
      const code = await client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
      const a = new Client(t);
      a.bearer = (await a.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: `PC ${i}`, platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
      agents.push({ client: a, sessionId: newId() });
    }
    await admin.patch(o(`/projects/${projectId}`), { member_ids: members });
    const start = new Date(t.clock.now.getTime() - 3600_000);
    const times: number[] = [];
    const send = async (a: { client: Client; sessionId: string }, events: unknown[]) => {
      const t0 = performance.now();
      const r = await a.client.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events });
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
      expect(r.body.results.every((x: { status: string }) => x.status === 'accepted')).toBe(true);
    };
    for (const a of agents) await send(a, [{ event_id: newId(), type: 'session.start', session_id: a.sessionId, seq: 1, occurred_at: start.toISOString(), project_id: projectId }]);
    // Five rounds: each agent sends 10 minutes of activity and app usage (what one 30-second sync carries after being offline a while).
    for (let round = 0; round < 5; round++) {
      await Promise.all(
        agents.map((a) => {
          const base = start.getTime() + round * 10 * 60_000;
          const minutes = Array.from({ length: 10 }, (_, i) => ({ minute_start: new Date(base + i * 60_000).toISOString(), keyboard: 40, mouse: 90, active_seconds: 45, tracked_seconds: 60 }));
          const spans = Array.from({ length: 5 }, (_, i) => ({ span_id: newId(), app_name: 'Code', app_id: null, started_at: new Date(base + i * 120_000).toISOString(), ended_at: new Date(base + (i + 1) * 120_000).toISOString() }));
          return send(a, [
            { event_id: newId(), type: 'activity.minutes', session_id: a.sessionId, occurred_at: new Date(base).toISOString(), minutes },
            { event_id: newId(), type: 'app.spans', session_id: a.sessionId, occurred_at: new Date(base).toISOString(), spans },
          ]);
        }),
      );
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    expect(times).toHaveLength(20 + 100);
    expect(p95).toBeLessThan(500);
  }, 180_000);
});
