import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timeEntries, timeReviewFlags, withSystem } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { and, eq } from 'drizzle-orm';
import { removeInterval } from '../src/services/tracking';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Product QA audit (28 October 2026), phase 2: offline sync never drops or supersedes recorded time.
// Q6 — a desktop session synced late never ends the running web timer.
// Q7 — time recorded offline is accepted and flagged, not rejected, for limits and project changes.
// T7 — discarding a paused-then-resumed idle period never removes the work after Resume.
// T9 — idle discard and screenshot deletion never cut duration-only entries.
// Duration-only and tracked time on one day is flagged for review.
const MIN = 60_000;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const iso = (d: Date) => d.toISOString();
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00Z`);

type Entry = { started_at: string; ended_at: string; duration_seconds: number; project_id: string; task_id: string | null; locked?: boolean };

/** A member on the project with a registered desktop agent. */
async function worker(name: string) {
  const m = await addMember(t, admin, orgId, name, `${name.toLowerCase()}@p2.test`);
  const members = ((await admin.get(o(`/projects/${projectId}`))).body.member_ids as string[]) ?? [];
  expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [...members, m.membershipId] })).status).toBe(200);
  const { verifier, challenge } = pkce();
  const code = await m.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
  const entries = async (from: string, to = from) =>
    ((await admin.get(o(`/time-entries?from=${from}&to=${to}&membership_ids=${m.membershipId}`))).body as Entry[]).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const total = async (from: string, to = from) => (await entries(from, to)).reduce((s, e) => s + e.duration_seconds, 0);
  /** Deliver an offline session (start … stop) now, as the desktop's queue does when it reconnects. */
  const syncSession = async (start: Date, end: Date, extra: { project_id?: string; task_id?: string | null } = {}) => {
    const sid = newId();
    const r = await agent.post('/agent/ingest/batch', {
      sent_at: iso(t.clock.now),
      events: [
        { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: iso(start), project_id: extra.project_id ?? projectId, task_id: extra.task_id ?? null },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: iso(end) },
      ],
    });
    return { sid, results: r.body.results as Array<{ status: string; code?: string }>, session: r.body.session as { id: string } | null };
  };
  const flags = () => withSystem(t.deps.db, (tx) => tx.select().from(timeReviewFlags).where(eq(timeReviewFlags.membershipId, m.membershipId)));
  return { ...m, agent, entries, total, syncSession, flags };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-21T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p2.test'));
  await admin.patch(o(''), { timezone: 'UTC' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('Q6: a late desktop sync never ends the running web timer', () => {
  it('a session from before the web timer started is filled in beside it', async () => {
    const w = await worker('Wen');
    const day = '2026-10-05';
    t.clock.set(at(day, '10:00'));
    expect((await w.client.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
    t.clock.set(at(day, '11:00'));
    const sync = await w.syncSession(at(day, '09:00'), at(day, '09:30'));
    expect(sync.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const current = (await w.client.get(o('/tracking/current'))).body;
    expect(current.session?.source).toBe('WEB'); // was null: the web timer was superseded
    expect(sync.session?.id).toBe(current.session.id);
    t.clock.set(at(day, '12:00'));
    await w.client.post(o('/tracking/stop'));
    expect(await w.total(day)).toBe(30 * 60 + 2 * 3600); // was 30 min: 10:00–12:00 was lost
  });

  it('a session recorded offline after the web timer started doesn’t supersede it either, and overlap counts once', async () => {
    const w = await worker('Wil');
    const day = '2026-10-06';
    t.clock.set(at(day, '08:00'));
    await w.client.post(o('/tracking/start'), { project_id: projectId });
    t.clock.set(at(day, '11:00'));
    const sync = await w.syncSession(at(day, '09:00'), at(day, '09:30'));
    expect(sync.results.every((r) => r.status === 'accepted')).toBe(true);
    expect((await w.client.get(o('/tracking/current'))).body.session?.source).toBe('WEB');
    t.clock.set(at(day, '12:00'));
    await w.client.post(o('/tracking/stop'));
    const es = await w.entries(day);
    expect(await w.total(day)).toBe(4 * 3600); // 08:00–12:00 once, the offline half hour inside it
    for (let i = 1; i < es.length; i++) expect(es[i]!.started_at >= es[i - 1]!.ended_at).toBe(true);
  });

  it('a desktop start delivered now still takes over the web timer', async () => {
    const w = await worker('Wes');
    const day = '2026-10-07';
    t.clock.set(at(day, '09:00'));
    await w.client.post(o('/tracking/start'), { project_id: projectId });
    t.clock.set(at(day, '10:00'));
    const sid = newId();
    await w.agent.post('/agent/ingest/batch', { sent_at: iso(t.clock.now), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: iso(t.clock.now), project_id: projectId }] });
    expect((await w.client.get(o('/tracking/current'))).body.session?.id).toBe(sid);
  });
});

describe('Q7: time recorded offline is accepted and flagged, never rejected', () => {
  it('yesterday’s offline session is kept after today’s limit is reached', async () => {
    const w = await worker('Lin');
    await admin.put(o(`/policies/WORKER/${w.membershipId}`), { limits: { dailySeconds: 8 * 3600 } });
    t.clock.set(at('2026-10-13', '09:00'));
    await w.client.post(o('/tracking/start'), { project_id: projectId });
    t.clock.set(at('2026-10-13', '17:00'));
    await w.client.post(o('/tracking/stop'));
    t.clock.set(at('2026-10-13', '17:30'));
    const sync = await w.syncSession(at('2026-10-12', '18:00'), at('2026-10-12', '20:00'));
    expect(sync.results.map((r) => r.status)).toEqual(['accepted', 'accepted']); // was rejected: limit_reached, session_not_found
    expect(await w.total('2026-10-12')).toBe(2 * 3600); // was 0
    expect(await w.flags()).toEqual([]); // Monday is within its own limit
  });

  it('an offline day over the limit is kept whole and flagged for the approver', async () => {
    const w = await worker('Liv');
    await admin.put(o(`/policies/WORKER/${w.membershipId}`), { limits: { dailySeconds: 2 * 3600 } });
    t.clock.set(at('2026-10-15', '09:00'));
    const sync = await w.syncSession(at('2026-10-14', '09:00'), at('2026-10-14', '12:00'));
    expect(sync.results.every((r) => r.status === 'accepted')).toBe(true);
    expect(await w.total('2026-10-14')).toBe(3 * 3600);
    const f = await w.flags();
    expect(f.map((x) => [x.localDate, x.reason])).toEqual([['2026-10-14', 'offline_over_limit']]);
    // The approver is told, and the period shows "Needs review" in the approval queue.
    await t.flush();
    const notes = (await admin.get(o('/notifications'))).body as Array<{ type: string; title: string }> | { data: Array<{ type: string; title: string }> };
    const list = Array.isArray(notes) ? notes : notes.data;
    expect(list.some((n) => n.type === 'time.needs_review' && n.title.includes('2026-10-14'))).toBe(true);
    t.clock.set(at('2026-10-15', '09:05'));
    expect((await w.client.post(o('/timesheets/submit'), { date: '2026-10-14' })).status).toBeLessThan(300);
    const queue = (await admin.get(o('/timesheets/approvals'))).body as Array<{ membership_id: string; flags: string[] }>;
    expect(queue.find((q) => q.membership_id === w.membershipId)?.flags).toContain('needs_review');
  });

  it('time on a project archived since, or a task archived since, is kept and flagged', async () => {
    const w = await worker('Pia');
    const side = (await admin.post(o('/projects'), { name: 'Side', billable_default: true })).body.id as string;
    expect((await admin.patch(o(`/projects/${side}`), { member_ids: [w.membershipId] })).status).toBe(200);
    const task = (await admin.post(o(`/projects/${projectId}/tasks`), { title: 'Old task' })).body.id as string;
    await admin.post(o(`/projects/${side}/archive`));
    await admin.del(o(`/tasks/${task}`));
    t.clock.set(at('2026-10-20', '09:00'));
    const onSide = await w.syncSession(at('2026-10-19', '09:00'), at('2026-10-19', '10:00'), { project_id: side });
    const onTask = await w.syncSession(at('2026-10-19', '11:00'), at('2026-10-19', '11:30'), { task_id: task });
    expect([...onSide.results, ...onTask.results].map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted']); // was rejected
    const es = await w.entries('2026-10-19');
    expect(es.map((e) => [e.project_id, e.task_id, e.duration_seconds])).toEqual([
      [side, null, 3600],
      [projectId, null, 1800],
    ]);
    expect((await w.flags()).map((x) => x.reason).sort()).toEqual(['offline_project_unavailable', 'offline_task_unavailable']);
  });

  it('time recorded while tracking was turned off for the member is still refused', async () => {
    const w = await worker('Tod');
    expect((await admin.patch(o(`/workers/${w.membershipId}`), { tracking_enabled: false })).status).toBe(200);
    t.clock.set(at('2026-10-21', '09:00'));
    const sync = await w.syncSession(at('2026-10-20', '09:00'), at('2026-10-20', '10:00'));
    expect(sync.results[0]).toMatchObject({ status: 'rejected', code: 'tracking_disabled' });
  });
});

describe('T7 and T9: idle discard removes only idle time', () => {
  it('T7: discarding a paused-then-resumed idle period keeps the work after Resume', async () => {
    const w = await worker('Ida');
    await admin.put(o(`/policies/WORKER/${w.membershipId}`), { idle: { behavior: 'pause' } });
    const day = '2026-10-08';
    const sid = newId();
    const idleId = newId();
    t.clock.set(at(day, '09:00'));
    await w.agent.post('/agent/ingest/batch', { sent_at: iso(t.clock.now), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: iso(t.clock.now), project_id: projectId }] });
    t.clock.set(at(day, '09:30'));
    await w.agent.post('/agent/ingest/batch', { sent_at: iso(t.clock.now), events: [{ event_id: newId(), type: 'idle.started', session_id: sid, occurred_at: iso(t.clock.now), idle_id: idleId, started_at: iso(t.clock.now) }] });
    // Resumed on the web at 09:40; the first keyboard input only comes at 09:50.
    t.clock.set(at(day, '09:40'));
    expect((await w.client.post(o('/tracking/resume'))).status).toBe(200);
    t.clock.set(at(day, '10:00'));
    const minutes = Array.from({ length: 10 }, (_, i) => ({ minute_start: iso(new Date(at(day, '09:50').getTime() + i * MIN)), keyboard: 30, mouse: 0, active_seconds: 50, tracked_seconds: 60 }));
    await w.agent.post('/agent/ingest/batch', {
      sent_at: iso(t.clock.now),
      events: [
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: iso(t.clock.now), minutes },
        { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: iso(t.clock.now) },
      ],
    });
    expect(await w.total(day)).toBe(30 * 60 + 20 * 60);
    const pending = (await admin.get(o(`/idle-events?from=${day}&to=${day}&membership_ids=${w.membershipId}&status=PENDING`))).body as Array<{ id: string }>;
    expect((await admin.post(o(`/idle-events/${pending[0]!.id}/resolve`), { resolution: 'DISCARDED' })).status).toBe(204);
    expect(await w.total(day)).toBe(30 * 60 + 20 * 60); // was 40 min: 09:40–09:50 after Resume was removed
  });

  it('T9: removing a span on the clock never cuts a duration-only entry', async () => {
    const w = await worker('Dov');
    const day = '2026-10-09';
    t.clock.set(at('2026-10-10', '12:00'));
    expect((await admin.post(o('/manual-time'), { membership_id: w.membershipId, project_id: projectId, local_date: day, duration_seconds: 7200, reason: 'Workshop' })).status).toBe(201);
    const [e] = await w.entries(day);
    await withSystem(t.deps.db, (tx) =>
      removeInterval(tx, { organizationId: orgId, membershipId: w.membershipId, start: new Date(e!.started_at), end: new Date(e!.ended_at), action: 'IDLE_DISCARD', reason: 'test', actor: { type: 'system', id: null } }),
    );
    expect(await w.total(day)).toBe(7200); // was 0
  });
});

describe('Duration-only and tracked time on one day', () => {
  it('flags the day once for review', async () => {
    const w = await worker('Mia');
    const day = '2026-10-16';
    t.clock.set(at(day, '09:00'));
    await w.client.post(o('/tracking/start'), { project_id: projectId });
    t.clock.set(at(day, '11:00'));
    await w.client.post(o('/tracking/stop'));
    expect(await w.flags()).toEqual([]);
    t.clock.set(at(day, '18:00'));
    expect((await admin.post(o('/manual-time'), { membership_id: w.membershipId, project_id: projectId, local_date: day, duration_seconds: 3600, reason: 'Call' })).status).toBe(201);
    await w.client.post(o('/tracking/start'), { project_id: projectId });
    t.clock.set(at(day, '18:30'));
    await w.client.post(o('/tracking/stop'));
    expect((await w.flags()).map((f) => [f.localDate, f.reason])).toEqual([[day, 'duration_only_and_tracked']]);
    const live = await withSystem(t.deps.db, (tx) => tx.select().from(timeEntries).where(and(eq(timeEntries.membershipId, w.membershipId), eq(timeEntries.localDate, day))));
    expect(live.some((x) => x.durationOnly) && live.some((x) => x.source === 'TRACKED')).toBe(true);
  });
});
