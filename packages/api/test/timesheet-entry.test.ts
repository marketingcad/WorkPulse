import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clock: Wednesday 2026-09-23, 16:00 in America/New_York (UTC-4).
const NOW = new Date('2026-09-23T20:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let acmeProject: string;
let otherProject: string;
let acme: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type Entry = { id: string; started_at: string; ended_at: string; duration_seconds: number; billable: boolean; duration_only?: boolean; client_name?: string | null; project_id: string };
const entries = async (c: Client, qs: string) => (await c.get(o(`/time-entries?${qs}`))).body as Entry[];
const local = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@entry.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@entry.test'));
  acme = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  acmeProject = (await admin.post(o('/projects'), { name: 'Site', client_id: acme, member_ids: [waltId], billable_default: true })).body.id;
  otherProject = (await admin.post(o('/projects'), { name: 'Internal', member_ids: [waltId], billable_default: false })).body.id;
});
afterAll(() => t.close());

describe('duration-only entries', () => {
  it('places the time in the first free slot from 09:00 and marks it duration-only', async () => {
    // Existing time 09:00–11:00 local on Monday.
    expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: acmeProject, started_at: '2026-09-21T13:00:00Z', ended_at: '2026-09-21T15:00:00Z', reason: 'x' })).status).toBe(201);
    const r = await admin.post(o('/manual-time'), { membership_id: waltId, project_id: otherProject, local_date: '2026-09-21', duration_seconds: 90 * 60, reason: 'x' });
    expect(r.status).toBe(201);
    const day = await entries(admin, `from=2026-09-21&to=2026-09-21&membership_ids=${waltId}`);
    const added = day.find((e) => e.project_id === otherProject)!;
    expect(added).toMatchObject({ duration_seconds: 5400, duration_only: true });
    expect(local(added.started_at)).toBe('11:00');
  });

  it('refuses when the day has no free slot before now', async () => {
    // Today: 00:00–10:00 is taken and it is only 16:00, so 7 hours cannot fit.
    expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: otherProject, started_at: '2026-09-23T04:00:00Z', ended_at: '2026-09-23T14:00:00Z', reason: 'x' })).status).toBe(201);
    const r = await admin.post(o('/manual-time'), { membership_id: waltId, project_id: otherProject, local_date: '2026-09-23', duration_seconds: 7 * H, reason: 'x' });
    expect(r.body.code).toBe('no_free_time');
  });

  it('needs either start and end, or a date and a duration', async () => {
    expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: acmeProject, reason: 'x' })).status).toBe(400);
  });
});

describe('part-billable entries', () => {
  it('splits logged time into a billable and a non-billable entry', async () => {
    const r = await admin.post(o('/manual-time'), { membership_id: waltId, project_id: acmeProject, local_date: '2026-09-22', duration_seconds: 3 * H, billable_seconds: 1 * H, reason: 'x' });
    expect(r.status).toBe(201);
    const day = await entries(admin, `from=2026-09-22&to=2026-09-22&membership_ids=${waltId}`);
    expect(day.map((e) => [e.billable, e.duration_seconds])).toEqual([
      [true, 3600],
      [false, 7200],
    ]);
    // The pieces are contiguous.
    expect(day[0]!.ended_at).toBe(day[1]!.started_at);
    // Week total: Monday's 2h billable (Site) + Tuesday's 1h billable part; the 2h remainder is not billable.
    const ts = (await admin.get(o(`/timesheets?membership_id=${waltId}&date=2026-09-22`))).body;
    expect(ts.billable_seconds).toBe(2 * H + 1 * H);
  });

  it('rejects billable time above the time logged', async () => {
    expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: acmeProject, local_date: '2026-09-18', duration_seconds: H, billable_seconds: 2 * H, reason: 'x' })).status).toBe(400);
  });

  it('splits requests approved later the same way', async () => {
    const r = await walt.post(o('/manual-time'), { project_id: acmeProject, local_date: '2026-09-17', duration_seconds: 2 * H, billable_seconds: 30 * 60, reason: 'call' });
    expect(r.status).toBe(201);
    if (r.body.status === 'PENDING') expect((await admin.post(o(`/manual-time/${r.body.id}/approve`), {})).status).toBe(204);
    const day = await entries(admin, `from=2026-09-17&to=2026-09-17&membership_ids=${waltId}`);
    expect(day.map((e) => [e.billable, e.duration_seconds])).toEqual([
      [true, 1800],
      [false, 5400],
    ]);
  });
});

describe('company timesheet list', () => {
  it('filters by client and project and returns the client name', async () => {
    const byClient = await entries(admin, `from=2026-09-01&to=2026-09-30&client_id=${acme}`);
    expect(byClient.length).toBeGreaterThan(0);
    expect(byClient.every((e) => e.client_name === 'Acme' && e.project_id === acmeProject)).toBe(true);
    const byProject = await entries(admin, `from=2026-09-01&to=2026-09-30&project_ids=${otherProject}`);
    expect(byProject.every((e) => e.project_id === otherProject)).toBe(true);
  });

  it('applies bulk changes entry by entry and reports failures', async () => {
    const day = await entries(admin, `from=2026-09-22&to=2026-09-22&membership_ids=${waltId}`);
    const ids = day.map((e) => e.id);
    const r = await admin.post(o('/time-entries/bulk'), { ids, action: 'set_non_billable', reason: 'internal' });
    expect(r.status).toBe(200);
    expect(r.body.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect((await entries(admin, `from=2026-09-22&to=2026-09-22&membership_ids=${waltId}`)).every((e) => !e.billable)).toBe(true);

    // Submitting locks Walt's week: deleting a locked entry fails, the rest still go through.
    const locked = (await entries(admin, `from=2026-09-21&to=2026-09-21&membership_ids=${waltId}`))[0]!.id;
    expect((await walt.post(o('/timesheets/submit'), { date: '2026-09-21' })).status).toBe(200);
    const open = (await entries(admin, `from=2026-09-17&to=2026-09-17&membership_ids=${waltId}`))[0]!.id;
    const d = await admin.post(o('/time-entries/bulk'), { ids: [locked, open], action: 'delete', reason: 'cleanup' });
    expect(d.body.find((x: { id: string }) => x.id === locked)).toMatchObject({ ok: false });
    expect(d.body.find((x: { id: string }) => x.id === open)).toMatchObject({ ok: true });
  });
});
