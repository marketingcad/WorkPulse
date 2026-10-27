import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Regression: tracked time is never counted twice, even when the desktop's clock is off.
 *
 * Production (Oct 16 and 20, 2026) had back-to-back desktop sessions overlapping by 36–764 ms. The
 * ingest corrects each batch by `server now − sent_at`, which includes that batch's network delay, so
 * two batches from the same device get slightly different corrections. A slow stop followed by a fast
 * start then puts the next session's start before the previous session's end.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
let agent: Client;

const SKEW = 3_000; // the device's clock is 3 s behind the server (over the 2 s correction threshold)

/** A batch the device sends at device time `sentAt` and the server receives `latencyMs` later. */
async function send(events: unknown[], sentAt: number, latencyMs: number) {
  t.clock.set(new Date(sentAt + SKEW + latencyMs));
  const r = await agent.post('/agent/ingest/batch', { sent_at: new Date(sentAt).toISOString(), events });
  expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(events.map(() => 'accepted'));
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@overlap.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@overlap.test'));
  projectId = (await admin.post(`/orgs/${orgId}/projects`, { name: 'P', member_ids: [workerId] })).body.id;
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  agent = new Client(t);
  agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
});
afterAll(() => t.close());

describe('back-to-back desktop sessions', () => {
  it('a slow stop followed by a fast start never overlaps the two sessions', async () => {
    const a = newId();
    const b = newId();
    const d0 = t.clock.now.getTime() - SKEW; // device time
    await send([{ event_id: newId(), type: 'session.start', session_id: a, seq: 1, occurred_at: new Date(d0).toISOString(), project_id: projectId }], d0, 100);

    // Ten minutes later the member stops A (sent at once, 900 ms in transit)…
    const stopAt = d0 + 10 * 60_000;
    await send([{ event_id: newId(), type: 'session.stop', session_id: a, seq: 2, occurred_at: new Date(stopAt).toISOString() }], stopAt, 900);
    // …and starts B 100 ms later; that batch leaves 1 s later and takes 100 ms. It arrives after the stop.
    const startAt = stopAt + 100;
    await send([{ event_id: newId(), type: 'session.start', session_id: b, seq: 1, occurred_at: new Date(startAt).toISOString(), project_id: projectId }], startAt + 1_000, 100);
    // B runs five minutes; entries are written once its segment closes.
    const stopB = startAt + 5 * 60_000;
    await send([{ event_id: newId(), type: 'session.stop', session_id: b, seq: 2, occurred_at: new Date(stopB).toISOString() }], stopB, 100);

    const day = new Date(d0).toISOString().slice(0, 10);
    const entries = (await worker.get(`/orgs/${orgId}/time-entries?from=${day}&to=${day}`)).body as Array<{ session_id: string; started_at: string; ended_at: string }>;
    const ofA = entries.filter((e) => e.session_id === a);
    const ofB = entries.filter((e) => e.session_id === b);
    expect([ofA.length > 0, ofB.length > 0]).toEqual([true, true]);
    const aEnd = Math.max(...ofA.map((e) => new Date(e.ended_at).getTime()));
    const bStart = Math.min(...ofB.map((e) => new Date(e.started_at).getTime()));
    expect(bStart, `B starts ${aEnd - bStart} ms before A ends`).toBeGreaterThanOrEqual(aEnd);
  });
});
