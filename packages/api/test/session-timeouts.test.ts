import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { sweepSessions } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Gate 1: when the server stops or interrupts a session on its own, at the exact boundary of each
 * window. The sweep compares with a strict "more than", so a session survives at the limit and is
 * acted on one second later. Defaults (packages/domain/src/policy.ts): heartbeat grace 180 s, a
 * desktop session may stay interrupted (offline) for 24 h, a pause may last 4 h. When the server
 * stops a session it ends it where the work ended, so the time that counts never includes the gap.
 *
 * Each test uses its own organization so policies and live sessions never meet.
 */
let t: Harness;
afterAll(() => t?.close());

let admin: Client;
let orgId: string;
let worker: Client;
let projectId: string;

beforeEach(async () => {
  t ??= await createHarness();
  const n = newId().slice(-8);
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', `ada-${n}@t.test`, `Org ${n}`));
  const m = await addMember(t, admin, orgId, 'Walt Worker', `walt-${n}@t.test`);
  worker = m.client;
  projectId = (await admin.post(`/orgs/${orgId}/projects`, { name: 'Website', member_ids: [m.membershipId] })).body.id;
});

const state = async () => (await worker.get(`/orgs/${orgId}/tracking/current`)).body.session?.state ?? 'NONE';
const workedSeconds = async (sessionId: string) => {
  const day = (o: number) => new Date(t.clock.now.getTime() + o * 86400_000).toISOString().slice(0, 10);
  const r = await worker.get(`/orgs/${orgId}/time-entries?from=${day(-3)}&to=${day(1)}`);
  return (r.body as Array<{ session_id: string | null; duration_seconds: number }>).filter((e) => e.session_id === sessionId).reduce((s, e) => s + e.duration_seconds, 0);
};

async function desktopSession(): Promise<{ device: Client; sid: string }> {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const device = new Client(t);
  device.bearer = (await device.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'windows', agent_version: '0.2.0' } })).body.access_token;
  const sid = newId();
  const r = await device.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: t.clock.now.toISOString(), project_id: projectId }] });
  expect(r.body.results[0].status).toBe('accepted');
  // The app confirms its timer with its first heartbeat (the confirm window); then it goes quiet.
  await device.post('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: sid });
  expect(await state()).toBe('ACTIVE');
  return { device, sid };
}

describe('a desktop session that goes quiet', () => {
  it('should_stay_active_at_exactly_180_seconds_without_a_heartbeat_and_be_interrupted_one_second_later', async () => {
    await desktopSession();
    t.clock.advance(180_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('ACTIVE');
    t.clock.advance(1_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('INTERRUPTED');
  });

  it('should_wait_the_full_24_hour_offline_window_then_stop_without_counting_the_offline_gap', async () => {
    const { sid } = await desktopSession();
    t.clock.advance(10 * 60_000); // the device goes silent right after starting
    await sweepSessions(t.deps);
    expect(await state()).toBe('INTERRUPTED');
    // The window runs from the interruption, which is dated at the last sign of life (the start here).
    t.clock.advance(24 * 3600_000 - 10 * 60_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('INTERRUPTED');
    t.clock.advance(1_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('NONE');
    await t.flush();
    // Nothing after the last sign of life is paid or billed.
    expect(await workedSeconds(sid)).toBe(0);
  });

  it('should_follow_an_organization_that_shortens_the_heartbeat_grace', async () => {
    expect((await admin.put(`/orgs/${orgId}/policies/ORG/${orgId}`, { tracking: { heartbeatGraceSeconds: 60 } })).status).toBe(200);
    await desktopSession();
    t.clock.advance(60_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('ACTIVE');
    t.clock.advance(1_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('INTERRUPTED');
  });
});

describe('a paused session', () => {
  async function workThenPause(minutes: number): Promise<string> {
    const start = await worker.post(`/orgs/${orgId}/tracking/start`, { project_id: projectId });
    expect(start.status).toBeLessThan(300);
    t.clock.advance(minutes * 60_000);
    expect((await worker.post(`/orgs/${orgId}/tracking/pause`, {})).status).toBeLessThan(300);
    expect(await state()).toBe('PAUSED');
    return (await worker.get(`/orgs/${orgId}/tracking/current`)).body.session.id as string;
  }

  it('should_survive_exactly_4_hours_paused_and_stop_one_second_later_counting_only_the_work_before_the_pause', async () => {
    const sid = await workThenPause(25);
    t.clock.advance(4 * 3600_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('PAUSED');
    t.clock.advance(1_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('NONE');
    await t.flush();
    expect(await workedSeconds(sid)).toBe(25 * 60);
  });

  it('should_follow_an_organization_that_allows_only_a_30_minute_pause', async () => {
    expect((await admin.put(`/orgs/${orgId}/policies/ORG/${orgId}`, { tracking: { maxPauseMinutes: 30 } })).status).toBe(200);
    const sid = await workThenPause(5);
    t.clock.advance(30 * 60_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('PAUSED');
    t.clock.advance(1_000);
    await sweepSessions(t.deps);
    expect(await state()).toBe('NONE');
    await t.flush();
    expect(await workedSeconds(sid)).toBe(5 * 60);
  });
});
