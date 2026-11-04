import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Phase 2 property test (offline sync): random mixes of web timers, used live, and desktop sessions
// recorded offline and delivered late, in random batches, sometimes while a web timer is running.
// Whatever the order, every second recorded by either source appears in exactly one time entry: no
// moment is lost, none is counted twice, and nothing is rejected.
const MIN = 60_000;
const RUNS = Number(process.env.OFFLINE_SYNC_RUNS ?? 24);

type Span = { a: number; b: number }; // minutes from the day's 06:00
type Action = { at: number; order: number; run: () => Promise<void> };

/** Small seeded generator, so a failure names its seed and can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `n` non-overlapping spans of at least 5 minutes inside [lo, hi). */
function spans(r: () => number, n: number, lo: number, hi: number): Span[] {
  const cuts = Array.from({ length: n * 2 }, () => lo + Math.floor(r() * (hi - lo))).sort((x, y) => x - y);
  const out: Span[] = [];
  for (let i = 0; i < cuts.length; i += 2) if (cuts[i + 1]! - cuts[i]! >= 5) out.push({ a: cuts[i]!, b: cuts[i + 1]! });
  return out;
}

function union(list: Span[]): Span[] {
  const sorted = [...list].sort((x, y) => x.a - y.a);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.a <= last.b) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-09-01T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@prop.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('offline sync property: recorded time is kept exactly once', () => {
  it(`holds for ${RUNS} random interleavings`, async () => {
    const memberIds: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const seed = 1000 + run;
      const r = rng(seed);
      const name = `P${run}`;
      const m = await addMember(t, admin, orgId, name, `p${run}@prop.test`);
      memberIds.push(m.membershipId);
      expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: memberIds })).status).toBe(200);
      // A tight limit on some runs: offline time must still never be rejected.
      if (r() < 0.4) await admin.put(o(`/policies/WORKER/${m.membershipId}`), { limits: { dailySeconds: 3600 } });
      const { verifier, challenge } = pkce();
      const code = await m.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
      const agent = new Client(t);
      agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;

      // Each run is its own member, so days may repeat; they stay within three weeks of sign-in.
      const day = new Date(Date.UTC(2026, 7, 10 + (run % 20), 6, 0, 0));
      const time = (min: number) => new Date(day.getTime() + min * MIN);
      const web = spans(r, 1 + Math.floor(r() * 3), 0, 600);
      const desk = spans(r, 1 + Math.floor(r() * 3), 0, 600);
      // The desktop reconnects after its last session ended, possibly while a web timer is running.
      const lastEnd = Math.max(...desk.map((d) => d.b));
      const syncAt = lastEnd + 3 + Math.floor(r() * (660 - lastEnd));

      // Desktop events in their recorded order, delivered in 1–3 batches at the sync time.
      const events = desk.flatMap((d) => {
        const sid = newId();
        return [
          { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: time(d.a).toISOString(), project_id: projectId },
          { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: time(d.b).toISOString() },
        ];
      });
      const cuts = [0, ...Array.from({ length: Math.floor(r() * 3) }, () => Math.floor(r() * events.length)).sort((x, y) => x - y), events.length];
      const results: Array<{ status: string; code?: string }> = [];
      const actions: Action[] = [];
      // A live web start at the limit is refused (as it should be); that span was never recorded.
      const refused = new Set<Span>();
      for (const w of web) {
        actions.push({
          at: w.a,
          order: 1,
          run: async () => {
            const res = await m.client.post(o('/tracking/start'), { project_id: projectId });
            if (res.status === 422 && res.body.code === 'limit_reached') refused.add(w);
            else expect(res.status, `seed ${seed}: web start`).toBe(200);
          },
        });
        actions.push({ at: w.b, order: 0, run: async () => void (await m.client.post(o('/tracking/stop'))) });
      }
      for (let i = 0; i + 1 < cuts.length; i++) {
        const batch = events.slice(cuts[i], cuts[i + 1]);
        if (!batch.length) continue;
        actions.push({ at: syncAt, order: 2, run: async () => void results.push(...(await agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: batch })).body.results) });
      }
      actions.sort((x, y) => x.at - y.at || x.order - y.order);
      for (const act of actions) {
        t.clock.set(time(act.at));
        await act.run();
      }
      t.clock.set(time(700));
      await m.client.post(o('/tracking/stop'));

      const label = `seed ${seed}: web ${JSON.stringify(web)} desktop ${JSON.stringify(desk)} sync ${syncAt}`;
      expect(results.filter((x) => x.status !== 'accepted' && x.status !== 'duplicate'), label).toEqual([]);
      const from = day.toISOString().slice(0, 10);
      const listed = await admin.get(o(`/time-entries?from=${from}&to=${from}&membership_ids=${m.membershipId}`));
      expect(listed.status, `${label}: ${JSON.stringify(listed.body)}`).toBe(200);
      const entries = (listed.body as Array<{ started_at: string; ended_at: string }>)
        .map((e) => ({ a: (Date.parse(e.started_at) - day.getTime()) / MIN, b: (Date.parse(e.ended_at) - day.getTime()) / MIN }))
        .sort((x, y) => x.a - y.a);
      // Never counted twice: entries don't overlap.
      for (let i = 1; i < entries.length; i++) expect(entries[i]!.a, `${label}: overlap at ${entries[i]!.a}`).toBeGreaterThanOrEqual(entries[i - 1]!.b);
      // Never lost: the entries cover exactly what either source recorded.
      expect(union(entries), label).toEqual(union([...web.filter((w) => !refused.has(w)), ...desk]));
      // No session left running, and nothing still "backfilling".
      expect((await m.client.get(o('/tracking/current'))).body.session, label).toBeNull();
    }
  }, 300_000);
});
