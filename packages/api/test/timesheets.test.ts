import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Phase 7 gate: timesheet lifecycle, locking, revision chains, approval snapshots.
// Fixed clock: Wednesday 2026-09-23 16:00 in New York (EDT, UTC-4). Weeks start on Monday.
const NOW = new Date('2026-09-23T20:00:00Z');
const LAST_WEEK = '2026-09-14';
const THIS_WEEK = '2026-09-21';

let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let projectId: string;
let otherProjectId: string;
let lastWeekTs: string;

const o = (p: string) => `/orgs/${orgId}${p}`;
const entries = async (from: string, to: string) => (await worker.get(o(`/time-entries?from=${from}&to=${to}`))).body as Array<{ id: string; project_id: string; started_at: string; ended_at: string; duration_seconds: number; locked: boolean; source: string }>;

/** Admin adds (auto-approved) manual time for the worker. */
async function addTime(startIso: string, hours: number) {
  const start = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: workerId, project_id: projectId, started_at: start.toISOString(), ended_at: new Date(start.getTime() + hours * 3600_000).toISOString(), reason: 'setup' });
  expect(r.status).toBe(201);
  expect(r.body.status).toBe('APPROVED');
}

/** Read tables directly as the owner (bypassing RLS) to inspect immutable history rows. */
async function asOwner<T>(q: SQL): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@ts.test'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt', 'walt@ts.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Alpha', member_ids: [workerId] })).body.id;
  otherProjectId = (await admin.post(o('/projects'), { name: 'Beta', member_ids: [workerId] })).body.id;
  expect((await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: workerId, amount_minor: 4000, currency: 'USD', effective_from: '2020-01-01' })).status).toBe(201);
  // Last week: Monday 10:00–12:00 local.
  await addTime('2026-09-14T14:00:00Z', 2);
});
afterAll(() => t.close());

describe('timesheet lifecycle', () => {
  it('walks every allowed transition and rejects the invalid ones', async () => {
    const draft = await worker.get(o(`/timesheets?date=${LAST_WEEK}`));
    expect(draft.body).toMatchObject({ status: 'DRAFT', period_start: LAST_WEEK, period_end: '2026-09-20', total_seconds: 7200 });

    const sub = await worker.post(o('/timesheets/submit'), { date: LAST_WEEK });
    expect(sub.body.status).toBe('SUBMITTED');
    lastWeekTs = sub.body.id;
    const act = (a: string, comment?: string) => admin.post(o(`/timesheets/${lastWeekTs}/${a}`), comment ? { comment } : {});

    expect((await worker.post(o('/timesheets/submit'), { date: LAST_WEEK })).status).toBe(409); // already submitted
    expect((await act('reopen')).status).toBe(409); // only approved timesheets reopen
    expect((await act('request-changes')).status).toBe(400); // comment required
    expect((await act('reject')).status).toBe(400);

    const changes = await act('request-changes', 'Add the client name to Monday');
    expect(changes.body.status).toBe('DRAFT');
    expect((await entries(LAST_WEEK, '2026-09-20')).every((e) => !e.locked)).toBe(true);

    expect((await worker.post(o('/timesheets/submit'), { date: LAST_WEEK })).body.status).toBe('SUBMITTED');
    const rejected = await act('reject', 'Wrong project');
    expect(rejected.body).toMatchObject({ status: 'REJECTED', comment: 'Wrong project' });
    expect((await entries(LAST_WEEK, '2026-09-20')).every((e) => !e.locked)).toBe(true);

    expect((await worker.post(o('/timesheets/submit'), { date: LAST_WEEK })).body.status).toBe('SUBMITTED');
    expect((await entries(LAST_WEEK, '2026-09-20')).every((e) => e.locked)).toBe(true);
    expect((await act('approve')).body.status).toBe('APPROVED');
    expect((await act('approve')).status).toBe(409);
    expect((await act('reject', 'too late')).status).toBe(409);

    const history = await worker.get(o(`/timesheets/${lastWeekTs}/history`));
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(['SUBMIT', 'REQUEST_CHANGES', 'SUBMIT', 'REJECT', 'SUBMIT', 'APPROVE']);
    expect(history.body.map((h: { to: string }) => h.to)).toEqual(['SUBMITTED', 'DRAFT', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);
  });

  it('bulk approval reports per-timesheet results', async () => {
    const r = await admin.post(o('/timesheets/bulk-approve'), { ids: [lastWeekTs] });
    expect(r.body).toEqual([{ id: lastWeekTs, ok: false, error: expect.stringMatching(/approved/i) }]);
  });
});

describe('revision chain (trim, reassign, split, delete)', () => {
  it('records every edit as a contiguous revision with the reason', async () => {
    await addTime('2026-09-22T13:00:00Z', 4); // Tuesday 09:00–13:00 local
    const [e] = await entries('2026-09-22', '2026-09-22');
    const id = e!.id;

    const trim = await worker.patch(o(`/time-entries/${id}`), { ended_at: '2026-09-22T16:30:00Z', reason: 'Lunch started early' });
    expect(trim.body.duration_seconds).toBe(3.5 * 3600);
    const reassign = await worker.patch(o(`/time-entries/${id}`), { project_id: otherProjectId, reason: 'Was Beta work' });
    expect(reassign.body.project_id).toBe(otherProjectId);

    expect((await worker.post(o(`/time-entries/${id}/split`), { at: '2026-09-22T15:00:00Z' })).status).toBe(400); // reason required by policy
    const split = await worker.post(o(`/time-entries/${id}/split`), { at: '2026-09-22T15:00:00Z', reason: 'Two tasks' });
    const [, tail] = split.body.ids as [string, string];
    const delRes = await worker.req('DELETE', o(`/time-entries/${tail}`), { reason: 'Duplicate of meeting' });
    expect(delRes.status).toBe(204);

    const day = await entries('2026-09-22', '2026-09-22');
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ id, project_id: otherProjectId, ended_at: '2026-09-22T15:00:00.000Z', duration_seconds: 2 * 3600 });

    const revs = (await worker.get(o(`/time-entries/${id}/revisions`))).body as Array<{ revision: number; action: string; reason: string | null; actor_name: string | null }>;
    expect(revs.map((r) => r.revision)).toEqual([1, 2, 3, 4]);
    expect(revs.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE', 'SPLIT']);
    expect(revs.slice(1).map((r) => r.reason)).toEqual(['Lunch started early', 'Was Beta work', 'Two tasks']);
    expect(revs.slice(1).every((r) => r.actor_name === 'Walt')).toBe(true);

    const tailRevs = (await worker.get(o(`/time-entries/${tail}/revisions`))).body as Array<{ revision: number; action: string; after: { split_from?: string } }>;
    expect(tailRevs.map((r) => [r.revision, r.action])).toEqual([[1, 'SPLIT'], [2, 'DELETE']]);
    expect(tailRevs[0]!.after.split_from).toBe(id);
  });
});

describe('locking', () => {
  it('rejects every change to time in a submitted or approved period with 422', async () => {
    const [locked] = await entries(LAST_WEEK, '2026-09-20');
    expect(locked!.locked).toBe(true);
    const codes = async (p: Promise<{ status: number; body: { code?: string } }>) => {
      const r = await p;
      return [r.status, r.body?.code];
    };
    expect(await codes(worker.patch(o(`/time-entries/${locked!.id}`), { note: 'x', reason: 'fix' }))).toEqual([422, 'time_locked']);
    expect(await codes(admin.patch(o(`/time-entries/${locked!.id}`), { note: 'x' }))).toEqual([422, 'time_locked']);
    expect(await codes(worker.post(o(`/time-entries/${locked!.id}/split`), { at: '2026-09-14T15:00:00Z', reason: 'x' }))).toEqual([422, 'time_locked']);
    expect(await codes(worker.req('DELETE', o(`/time-entries/${locked!.id}`), { reason: 'x' }))).toEqual([422, 'time_locked']);

    // New manual time cannot be added to the approved week, by the worker or a manager.
    const manual = { project_id: projectId, started_at: '2026-09-16T14:00:00Z', ended_at: '2026-09-16T15:00:00Z', reason: 'forgot' };
    expect(await codes(worker.post(o('/manual-time'), manual))).toEqual([422, 'timesheet_locked']);
    expect(await codes(admin.post(o('/manual-time'), { ...manual, membership_id: workerId }))).toEqual([422, 'timesheet_locked']);

    // An open entry cannot be moved into the approved week.
    const [open] = await entries(THIS_WEEK, '2026-09-27');
    expect(await codes(worker.patch(o(`/time-entries/${open!.id}`), { started_at: '2026-09-18T13:00:00Z', ended_at: '2026-09-18T14:00:00Z', reason: 'wrong day' }))).toEqual([422, 'timesheet_locked']);

    // A request made while the week was open cannot be approved once the week is submitted.
    const pending = await worker.post(o('/manual-time'), { project_id: projectId, started_at: '2026-09-21T13:00:00Z', ended_at: '2026-09-21T14:00:00Z', reason: 'Site visit' });
    expect(pending.body.status).toBe('PENDING');
    expect((await worker.post(o('/timesheets/submit'), { date: THIS_WEEK })).body.status).toBe('SUBMITTED');
    expect(await codes(admin.post(o(`/manual-time/${pending.body.id}/approve`), {}))).toEqual([422, 'timesheet_locked']);
    const after = (await admin.get(o('/manual-time'))).body.find((r: { id: string }) => r.id === pending.body.id);
    expect(after.status).toBe('PENDING');
    expect((await entries('2026-09-21', '2026-09-21'))).toHaveLength(0);
  });
});

describe('approval snapshot', () => {
  const owed = async () => {
    await t.flush();
    const r = await admin.get(o(`/billing/amounts-owed?from=${LAST_WEEK}&to=2026-09-20`));
    const w = r.body.find((x: { membership_id: string }) => x.membership_id === workerId);
    return { seconds: w?.approved_seconds ?? 0, amount: w?.approved_amount_minor ?? 0 };
  };

  it('is kept unchanged when the timesheet is reopened, edited and approved again', async () => {
    expect(await owed()).toEqual({ seconds: 7200, amount: 8000 });

    const reopen = await admin.post(o(`/timesheets/${lastWeekTs}/reopen`), { comment: 'Monday was one hour' });
    expect(reopen.body.status).toBe('DRAFT');
    expect(await owed()).toEqual({ seconds: 0, amount: 0 }); // approved amounts are withdrawn, not rewritten

    const [e] = await entries(LAST_WEEK, '2026-09-20');
    expect((await worker.patch(o(`/time-entries/${e!.id}`), { ended_at: '2026-09-14T15:00:00Z', reason: 'Only one hour' })).status).toBe(200);
    expect((await worker.post(o('/timesheets/submit'), { date: LAST_WEEK })).body.status).toBe('SUBMITTED');
    expect((await admin.post(o(`/timesheets/${lastWeekTs}/approve`), {})).body.status).toBe('APPROVED');
    expect(await owed()).toEqual({ seconds: 3600, amount: 4000 });

    // Both snapshots survive: the first approval (2h, revision 1) is superseded, never rewritten or deleted.
    const snaps = await asOwner<{ revision: number; duration_seconds: number; superseded: boolean }>(
      sql`select revision, duration_seconds, superseded_at is not null as superseded from timesheet_entries where timesheet_id = ${lastWeekTs} order by snapshot_at, revision`,
    );
    expect(snaps.filter((s) => s.superseded).map((s) => [s.revision, s.duration_seconds])).toEqual([[1, 7200], [1, 7200], [1, 7200]]);
    expect(snaps.filter((s) => !s.superseded).map((s) => [s.revision, s.duration_seconds])).toEqual([[2, 3600]]);

    const billing = await asOwner<{ revision: number; seconds: number; voided: boolean }>(
      sql`select revision, seconds, voided_at is not null as voided from billing_entries where timesheet_id = ${lastWeekTs} order by created_at`,
    );
    expect(billing.map((b) => [b.revision, b.seconds, b.voided])).toEqual([
      [1, 7200, true],
      [2, 3600, false],
    ]);
  });
});

describe('desktop agent', () => {
  let agent: Client;
  let wendy: Client;
  let wendyId: string;
  const ingest = (events: unknown[]) => agent.post('/agent/ingest/batch', { sent_at: t.clock.now.toISOString(), events });
  const manual = (startIso: string, extra: Record<string, unknown> = {}) => {
    const event_id = newId();
    return { event_id, occurred_at: t.clock.now.toISOString(), type: 'manual_time.request', project_id: projectId, started_at: startIso, ended_at: new Date(Date.parse(startIso) + 3600_000).toISOString(), reason: 'Offline workshop', ...extra };
  };

  beforeAll(async () => {
    ({ client: wendy, membershipId: wendyId } = await addMember(t, admin, orgId, 'Wendy', 'wendy@ts.test'));
    expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [workerId, wendyId] })).status).toBe(200);
    const { verifier, challenge } = pkce();
    const code = await wendy.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    agent = new Client(t);
    const reg = await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.1.0' } });
    agent.bearer = reg.body.access_token;
  });

  it('reminds about an unsubmitted timesheet: last period (overdue) or the current one on its last day', async () => {
    expect((await agent.get('/agent/bootstrap')).body.timesheet_due).toBeNull(); // no time yet
    const r = await admin.post(o('/manual-time'), { membership_id: wendyId, project_id: projectId, started_at: '2026-09-15T14:00:00Z', ended_at: '2026-09-15T15:00:00Z', reason: 'setup' });
    expect(r.status).toBe(201);
    expect((await agent.get('/agent/bootstrap')).body.timesheet_due).toEqual({ period_start: LAST_WEEK, period_end: '2026-09-20', status: 'DRAFT', total_seconds: 3600, overdue: true });
    expect((await wendy.post(o('/timesheets/submit'), { date: LAST_WEEK })).body.status).toBe('SUBMITTED');
    expect((await agent.get('/agent/bootstrap')).body.timesheet_due).toBeNull();

    await admin.post(o('/manual-time'), { membership_id: wendyId, project_id: projectId, started_at: '2026-09-22T14:00:00Z', ended_at: '2026-09-22T15:00:00Z', reason: 'setup' });
    expect((await agent.get('/agent/bootstrap')).body.timesheet_due).toBeNull(); // Wednesday: not due yet
    t.clock.set(new Date('2026-09-27T20:00:00Z')); // Sunday, last day of the week
    try {
      expect((await agent.get('/agent/bootstrap')).body.timesheet_due).toMatchObject({ period_start: THIS_WEEK, overdue: false, total_seconds: 3600 });
    } finally {
      t.clock.set(NOW);
    }
  });

  it('accepts manual time requests queued offline, idempotently, with the web rules', async () => {
    const ev = manual('2026-09-21T14:00:00Z');
    const first = await ingest([ev]);
    expect(first.body.results).toEqual([{ event_id: ev.event_id, status: 'accepted' }]);
    expect((await ingest([ev])).body.results[0].status).toBe('duplicate');

    const req = (await admin.get(o('/manual-time'))).body.find((m: { id: string }) => m.id === ev.event_id);
    expect(req).toMatchObject({ membership_id: wendyId, status: 'PENDING', reason: 'Offline workshop', duration_seconds: 3600 });
    expect((await admin.post(o(`/manual-time/${ev.event_id}/approve`), {})).status).toBe(204);
    const revs = await admin.get(o(`/time-entries?from=2026-09-21&to=2026-09-21&membership_ids=${wendyId}`));
    expect(revs.body.map((e: { source: string }) => e.source)).toEqual(['MANUAL']);

    const res = await ingest([manual('2026-09-16T14:00:00Z'), manual('2026-09-23T13:00:00Z', { reason: undefined }), manual('2026-09-21T14:30:00Z')]);
    expect(res.body.results.map((r: { status: string; code?: string }) => [r.status, r.code])).toEqual([
      ['rejected', 'timesheet_locked'], // last week is submitted
      ['rejected', 'validation_error'], // reason required by policy
      ['rejected', 'time_overlap'],
    ]);
  });
});

describe('late desktop time', () => {
  it('is locked, flagged and must be reviewed before a submitted timesheet can be approved', async () => {
    const { client: lars, membershipId: larsId } = await addMember(t, admin, orgId, 'Lars', 'lars@ts.test');
    expect((await admin.patch(o(`/projects/${projectId}`), { member_ids: [...(await admin.get(o(`/projects/${projectId}`))).body.member_ids, larsId] })).status).toBe(200);
    await admin.post(o('/manual-time'), { membership_id: larsId, project_id: projectId, started_at: '2026-09-14T14:00:00Z', ended_at: '2026-09-14T15:00:00Z', reason: 'setup' });
    const ts = (await lars.post(o('/timesheets/submit'), { date: LAST_WEEK })).body.id as string;

    const { verifier, challenge } = pkce();
    const code = await lars.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.0' } })).body.access_token;
    const offlineSession = (start: string, end: string) => {
      const sid = newId();
      return agent.post('/agent/ingest/batch', {
        sent_at: t.clock.now.toISOString(),
        events: [
          { event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: start, project_id: projectId },
          { event_id: newId(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: end },
        ],
      });
    };

    // Evidence is accepted, but locked and reported.
    expect((await offlineSession('2026-09-16T13:00:00Z', '2026-09-16T15:00:00Z')).body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted']);
    const late = (await lars.get(o('/time-entries?from=2026-09-16&to=2026-09-16'))).body;
    expect(late.map((e: { duration_seconds: number; locked: boolean }) => [e.duration_seconds, e.locked])).toEqual([[7200, true]]);
    expect((await lars.patch(o(`/time-entries/${late[0].id}`), { note: 'x', reason: 'x' })).status).toBe(422);
    expect((await admin.get(o(`/timesheets?membership_id=${larsId}&date=${LAST_WEEK}`))).body).toMatchObject({ status: 'SUBMITTED', late_seconds: 7200 });
    const queued = (await admin.get(o('/timesheets/approvals'))).body.find((q: { timesheet_id: string }) => q.timesheet_id === ts);
    expect(queued).toMatchObject({ late_seconds: 7200, flags: expect.arrayContaining(['late_time']) });
    await t.flush();
    const note = (await admin.get(o('/notifications'))).body.data.find((n: { type: string }) => n.type === 'timesheet.late_time');
    expect(note.title).toBe("120 min of time was added to Lars's submitted timesheet");

    // The submitted snapshot no longer matches: approval is blocked until it is resubmitted.
    const blocked = await admin.post(o(`/timesheets/${ts}/approve`), {});
    expect([blocked.status, blocked.body.code]).toEqual([422, 'timesheet_changed_since_submit']);
    expect((await admin.post(o('/timesheets/bulk-approve'), { ids: [ts] })).body[0].ok).toBe(false);
    await admin.post(o(`/timesheets/${ts}/request-changes`), { comment: 'Desktop time came in late; please check it' });
    const resub = await lars.post(o('/timesheets/submit'), { date: LAST_WEEK });
    expect(resub.body).toMatchObject({ status: 'SUBMITTED', total_seconds: 3 * 3600, late_seconds: 0 });
    expect((await admin.post(o(`/timesheets/${ts}/approve`), {})).body.status).toBe('APPROVED');

    // After approval: still locked and flagged; the approval (and pay) is unchanged until a reopen.
    await offlineSession('2026-09-17T13:00:00Z', '2026-09-17T13:30:00Z');
    expect((await admin.get(o(`/timesheets?membership_id=${larsId}&date=${LAST_WEEK}`))).body).toMatchObject({ status: 'APPROVED', late_seconds: 1800 });
    const snap = await asOwner<{ n: number }>(sql`select coalesce(sum(duration_seconds),0)::int as n from timesheet_entries where timesheet_id = ${ts} and superseded_at is null`);
    expect(snap[0]!.n).toBe(3 * 3600);
    expect((await admin.post(o(`/timesheets/${ts}/reopen`), { comment: 'include late time' })).body.status).toBe('DRAFT');
    expect((await lars.get(o('/time-entries?from=2026-09-17&to=2026-09-17'))).body[0].locked).toBe(false);
  });

  it('draft periods are unaffected', async () => {
    expect((await worker.get(o(`/timesheets?date=2026-09-28`))).body.late_seconds).toBe(0);
  });
});
