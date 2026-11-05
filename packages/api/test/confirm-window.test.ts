import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { sweepSessions } from '../src/jobs';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Gate 1: the confirm window (docs/plan/03-data-model.md §8). A timer started in the desktop app is
 * CREATED and holds no time until that app confirms it (a heartbeat naming it, or any event for it);
 * then work counts from the start. The window (default 120 s, a policy setting) runs from when the
 * server received the start. Past it, unconfirmed:
 * - if the app kept talking to the server without confirming, it is not running this timer: STOPPED
 *   (NEVER_CONFIRMED), no time, and nothing sent for it later is added;
 * - if the app went silent right after the start, the offline rules apply: interrupted at the start,
 *   recovered with no gap if it comes back with its history, otherwise stopped with no time.
 * The server decides all of this; the app only reports.
 */
let t: Harness;
afterAll(() => t?.close());

let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
let device: Client;

const o = (p: string) => `/orgs/${orgId}${p}`;
const iso = (d: Date) => d.toISOString();

async function newDevice(name: string): Promise<Client> {
  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const c = new Client(t);
  c.bearer = (await c.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name, platform: 'windows', agent_version: '0.2.0' } })).body.access_token;
  return c;
}

beforeEach(async () => {
  t ??= await createHarness();
  t.clock.set(new Date('2026-11-04T14:00:00Z'));
  const n = newId().slice(-8);
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', `ada-${n}@t.test`, `Org ${n}`));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt Worker', `walt-${n}@t.test`));
  projectId = (await admin.post(o('/projects'), { name: 'Website', member_ids: [workerId] })).body.id;
  device = await newDevice('Laptop');
});

const ingest = (c: Client, events: unknown[]) => c.post('/agent/ingest/batch', { sent_at: iso(t.clock.now), events });
const start = (sid: string, at = t.clock.now) => ingest(device, [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: iso(at), project_id: projectId }]);
const heartbeat = (c: Client, sid: string | null) => c.post('/agent/heartbeat', { sent_at: iso(t.clock.now), session_id: sid });
const stop = (sid: string, seq = 2) => ingest(device, [{ event_id: newId(), type: 'session.stop', session_id: sid, seq, occurred_at: iso(t.clock.now) }]);
async function session(sid: string) {
  const day = iso(t.clock.now).slice(0, 10);
  const r = await admin.get(o(`/sessions?from=2026-11-01&to=${day}`));
  return (r.body as Array<{ id: string; state: string; end_reason: string | null; worked_seconds: number }>).find((s) => s.id === sid)!;
}
const advance = (seconds: number) => t.clock.advance(seconds * 1000);

describe('confirming a desktop start', () => {
  it('should_wait_in_created_holding_no_time_until_the_app_confirms_it', async () => {
    const sid = newId();
    expect((await start(sid)).body.results[0].status).toBe('accepted');
    expect(await session(sid)).toMatchObject({ state: 'CREATED', worked_seconds: 0 });
    expect((await worker.get(o('/tracking/current'))).body.session).toMatchObject({ id: sid, state: 'CREATED' });
  });

  it('should_count_work_from_the_start_when_a_heartbeat_confirms_it_not_from_the_confirmation', async () => {
    const sid = newId();
    await start(sid);
    advance(50);
    expect((await heartbeat(device, sid)).body.session).toMatchObject({ id: sid, state: 'ACTIVE' });
    advance(550);
    await stop(sid);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'USER', worked_seconds: 600 });
  });

  it('should_be_confirmed_by_any_event_for_it_such_as_its_activity_or_its_stop', async () => {
    const a = newId();
    await start(a);
    advance(60);
    await ingest(device, [{ event_id: newId(), type: 'activity.minutes', session_id: a, occurred_at: iso(t.clock.now), minutes: [{ minute_start: iso(new Date(t.clock.now.getTime() - 60_000)), keyboard: 3, mouse: 9, active_seconds: 40, tracked_seconds: 60 }] }]);
    expect((await session(a)).state).toBe('ACTIVE');
    await stop(a);

    // A stop is confirmation too: a short timer started and stopped from the app counts.
    const b = newId();
    await start(b);
    advance(45);
    expect((await stop(b)).body.results[0].status).toBe('accepted');
    expect(await session(b)).toMatchObject({ state: 'STOPPED', end_reason: 'USER', worked_seconds: 45 });
  });

  // Found by the Electron E2E: Live tracking listed only confirmed sessions, so for up to a minute
  // after clocking in a manager neither saw the worker nor could force-stop the timer.
  it('should_show_a_starting_timer_in_live_tracking_and_let_a_manager_stop_it_with_no_time', async () => {
    const sid = newId();
    await start(sid);
    const live = (await admin.get(o('/tracking/live'))).body as Array<{ membership_id: string; session_id: string | null; status: string }>;
    expect(live.find((w) => w.membership_id === workerId)).toMatchObject({ session_id: sid, status: 'WORKING' });
    expect((await admin.post(o(`/sessions/${sid}/force-stop`), {})).body).toMatchObject({ state: 'STOPPED' });
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'ADMIN', worked_seconds: 0 });
  });

  it('should_not_be_confirmed_by_another_device_of_the_same_person', async () => {
    const sid = newId();
    await start(sid);
    const other = await newDevice('Desktop PC');
    advance(30);
    await heartbeat(other, sid);
    expect((await session(sid)).state).toBe('CREATED');
  });
});

describe('a start the app never confirms while it keeps talking', () => {
  // The app heartbeats, but without this session (it lost it, or never really started it).
  it.each([
    [119, 'CREATED', null],
    [120, 'CREATED', null],
    [121, 'STOPPED', 'NEVER_CONFIRMED'],
  ])('should_be_%is_after_receipt_%s', async (seconds, state, reason) => {
    const sid = newId();
    await start(sid);
    advance(30);
    await heartbeat(device, null);
    advance(seconds - 30);
    await sweepSessions(t.deps);
    expect(await session(sid)).toMatchObject({ state, end_reason: reason, worked_seconds: 0 });
  });

  it('should_refuse_everything_sent_for_it_afterwards_so_it_never_gains_time_or_monitoring_data', async () => {
    const sid = newId();
    await start(sid);
    advance(30);
    await heartbeat(device, null);
    advance(91);
    await sweepSessions(t.deps);
    advance(600);
    const late = await ingest(device, [
      { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: iso(t.clock.now), minutes: [{ minute_start: iso(new Date(t.clock.now.getTime() - 60_000)), keyboard: 5, mouse: 5, active_seconds: 50, tracked_seconds: 60 }] },
      { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: iso(t.clock.now) },
    ]);
    expect(late.body.results.map((r: { status: string; code?: string }) => [r.status, r.code])).toEqual([
      ['rejected', 'session_not_confirmed'],
      ['rejected', 'session_not_confirmed'],
    ]);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'NEVER_CONFIRMED', worked_seconds: 0 });
    // Its heartbeat cannot bring it back either.
    expect((await heartbeat(device, sid)).body.session).toBeNull();
    // Managers see it under "Time not added", with the reason in plain words.
    const refused = (await admin.get(o(`/time-not-added?from=2026-11-01&to=${iso(t.clock.now).slice(0, 10)}`))).body as Array<{ membership_id: string; kind: string; code: string }>;
    expect(refused).toContainEqual(expect.objectContaining({ membership_id: workerId, kind: 'time', code: 'session_not_confirmed' }));
  });
});

describe('a start whose app went silent', () => {
  it('should_be_interrupted_with_no_time_then_recovered_with_no_gap_when_the_app_returns_with_its_history', async () => {
    const sid = newId();
    const startedAt = new Date(t.clock.now);
    await start(sid);
    advance(121);
    await sweepSessions(t.deps);
    expect(await session(sid)).toMatchObject({ state: 'INTERRUPTED', worked_seconds: 0 });
    // Back after an hour, with what it recorded meanwhile.
    t.clock.set(new Date(startedAt.getTime() + 3600_000));
    const back = await ingest(device, [
      { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: iso(new Date(startedAt.getTime() + 30 * 60_000)), minutes: [{ minute_start: iso(new Date(startedAt.getTime() + 30 * 60_000)), keyboard: 5, mouse: 5, active_seconds: 40, tracked_seconds: 60 }] },
      { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: iso(t.clock.now) },
    ]);
    expect(back.body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted']);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'USER', worked_seconds: 3600 });
  });

  it('should_end_with_no_time_when_the_app_never_comes_back', async () => {
    const sid = newId();
    await start(sid);
    advance(121);
    await sweepSessions(t.deps);
    advance(24 * 3600 + 1);
    await sweepSessions(t.deps);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'INTERRUPTED', worked_seconds: 0 });
  });
});

describe('when the window runs and who is exempt', () => {
  it('should_measure_from_receipt_so_a_start_delayed_by_the_network_gets_the_full_window_and_still_counts_from_its_start', async () => {
    const sid = newId();
    const occurred = new Date(t.clock.now.getTime() - 100_000); // the request took 100 s to arrive
    await start(sid, occurred);
    advance(30);
    await heartbeat(device, null);
    advance(90); // 120 s after receipt, 220 s after the click
    await sweepSessions(t.deps);
    expect((await session(sid)).state).toBe('CREATED');
    await heartbeat(device, sid);
    advance(60);
    await stop(sid);
    // From the click (100 s before receipt) to the stop.
    expect((await session(sid)).worked_seconds).toBe(100 + 120 + 60);
  });

  it('should_follow_an_organization_that_allows_five_minutes_and_refuse_a_window_under_a_minute', async () => {
    expect((await admin.put(o(`/policies/ORG/${orgId}`), { tracking: { confirmTimeoutSeconds: 30 } })).status).toBe(400);
    expect((await admin.put(o(`/policies/ORG/${orgId}`), { tracking: { confirmTimeoutSeconds: 300 } })).status).toBe(200);
    const sid = newId();
    await start(sid);
    advance(30);
    await heartbeat(device, null);
    advance(270);
    await sweepSessions(t.deps);
    expect((await session(sid)).state).toBe('CREATED');
    advance(1);
    await sweepSessions(t.deps);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'NEVER_CONFIRMED', worked_seconds: 0 });
  });

  it('should_start_web_timers_and_time_recorded_offline_active_at_once', async () => {
    const web = await worker.post(o('/tracking/start'), { project_id: projectId });
    expect(web.body.session).toMatchObject({ source: 'WEB', state: 'ACTIVE' });
    await worker.post(o('/tracking/stop'));
    // Recorded offline 10 minutes ago and delivered now, with its history: nothing to confirm.
    const sid = newId();
    await start(sid, new Date(t.clock.now.getTime() - 10 * 60_000));
    expect((await session(sid)).state).toBe('ACTIVE');
  });

  it('should_count_nothing_for_an_unconfirmed_start_replaced_by_a_web_timer', async () => {
    const sid = newId();
    await start(sid);
    advance(40);
    expect((await worker.post(o('/tracking/start'), { project_id: projectId })).status).toBeLessThan(300);
    expect(await session(sid)).toMatchObject({ state: 'STOPPED', end_reason: 'SUPERSEDED', worked_seconds: 0 });
    await worker.post(o('/tracking/stop'));
  });
});
