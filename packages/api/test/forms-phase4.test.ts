import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWorkforceAlerts } from '../src/jobs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Product QA audit (28 October 2026), phase 4: form integrity.
// U2 — an entry edit is made against the revision the editor saw, and only changed fields are sent.
// U5 — a member's schedule versions never overlap and never leave a gap.
// U6 — a billable expense is in its client's currency.
// T5 — the missing-time reminder runs on each member's clock.
// T6 — reopening a timesheet with per-hour accrual doesn't count as time off used.
const H = 3600_000;

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-20T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@p4.test'));
  await admin.patch(o(''), { timezone: 'America/New_York' });
  projectId = (await admin.post(o('/projects'), { name: 'Site', billable_default: true })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('U2: editing a time entry', () => {
  it('a stale edit is refused instead of overwriting a change saved meanwhile', async () => {
    const { membershipId: w } = await addMember(t, admin, orgId, 'Wes', 'wes@p4.test');
    await admin.patch(o(`/projects/${projectId}`), { member_ids: [w] });
    const add = await admin.post(o('/manual-time'), { membership_id: w, project_id: projectId, started_at: '2026-10-13T13:00:00Z', ended_at: '2026-10-13T14:00:00Z', reason: 'fixture', note: 'first' });
    expect(add.status).toBe(201);
    const [e] = (await admin.get(o(`/time-entries?from=2026-10-13&to=2026-10-13&membership_ids=${w}`))).body as Array<{ id: string; revision: number; timezone: string; billable: boolean; note: string }>;
    expect(e!.timezone).toBe('America/New_York');
    // Someone marks it non-billable…
    expect((await admin.patch(o(`/time-entries/${e!.id}`), { billable: false, revision: e!.revision })).status).toBe(200);
    // …while a dialog opened before that saves a note: refused, and the change stays.
    const stale = await admin.patch(o(`/time-entries/${e!.id}`), { note: 'second', revision: e!.revision });
    expect([stale.status, stale.body.code]).toEqual([409, 'stale_revision']);
    // Sending only the note (no billable) with the current revision keeps it non-billable.
    const [now] = (await admin.get(o(`/time-entries?from=2026-10-13&to=2026-10-13&membership_ids=${w}`))).body as Array<{ id: string; revision: number; billable: boolean; note: string }>;
    expect((await admin.patch(o(`/time-entries/${e!.id}`), { note: 'second', revision: now!.revision })).status).toBe(200);
    const [after] = (await admin.get(o(`/time-entries?from=2026-10-13&to=2026-10-13&membership_ids=${w}`))).body as Array<{ billable: boolean; note: string }>;
    expect([after!.billable, after!.note]).toEqual([false, 'second']);
  });
});

describe('U5: schedule versions', () => {
  type Version = { id: string; effective_from: string; effective_to: string | null };
  const versions = async (m: string) => ((await admin.get(o(`/schedules?membership_ids=${m}`))).body as Version[]).sort((a, b) => a.effective_from.localeCompare(b.effective_from)).map((v) => [v.effective_from, v.effective_to]);
  const create = (m: string, from: string, to?: string) => admin.post(o('/schedules'), { membership_id: m, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: from, ...(to ? { effective_to: to } : {}) });

  it('a backdated version ends where the next one starts, and an end before the start is refused', async () => {
    const { membershipId: m } = await addMember(t, admin, orgId, 'Sid', 'sid@p4.test');
    expect((await create(m, '2026-09-01')).status).toBe(201);
    expect((await create(m, '2026-06-01')).status).toBe(201);
    expect(await versions(m)).toEqual([
      ['2026-06-01', '2026-09-01'], // was open-ended: two versions applied from September
      ['2026-09-01', null],
    ]);
    const bad = await create(m, '2026-10-01', '2026-09-30');
    expect([bad.status, bad.body.errors?.[0]?.field]).toEqual([400, 'effective_to']);
  });

  it('an edit that overlaps another version is refused; deleting the latest reopens the one before', async () => {
    const { membershipId: m } = await addMember(t, admin, orgId, 'Sue', 'sue@p4.test');
    await create(m, '2026-01-01');
    const second = (await create(m, '2026-05-01')).body as Version;
    const third = (await create(m, '2026-08-01')).body as Version;
    const overlap = await admin.put(o(`/schedules/${second.id}`), { membership_id: m, timezone: 'UTC', days: [{ dow: 1, start: '09:00', end: '17:00' }], effective_from: '2026-05-01', effective_to: '2026-09-01' });
    expect(overlap.status).toBe(400); // was 200: May–September and August onward both applied
    expect((await admin.del(o(`/schedules/${third.id}`))).status).toBe(204);
    expect(await versions(m)).toEqual([
      ['2026-01-01', '2026-05-01'],
      ['2026-05-01', null], // was ended on 1 August, leaving no schedule after it
    ]);
    expect((await admin.del(o(`/schedules/${second.id}`))).status).toBe(204);
    expect(await versions(m)).toEqual([['2026-01-01', null]]);
  });
});

describe('U6: billable expenses are in the client’s currency', () => {
  it('refuses a billable expense in another currency, with the one to use', async () => {
    const eur = (await admin.post(o('/clients'), { name: 'Euro Co', currency: 'EUR' })).body.id as string;
    const p = (await admin.post(o('/projects'), { name: 'Euro site', client_id: eur })).body.id as string;
    const body = { project_id: p, category: 'Travel', amount_minor: 5000, spent_on: '2026-10-10', billable: true, reimbursable: true };
    const usd = await admin.post(o('/expenses'), { ...body, currency: 'USD' });
    expect([usd.status, usd.body.errors?.[0]?.field]).toEqual([400, 'currency']); // was 201, and never invoiced
    expect((await admin.post(o('/expenses'), { ...body, currency: 'EUR' })).status).toBe(201);
    // Not billable: any currency (it is only reimbursed).
    expect((await admin.post(o('/expenses'), { ...body, billable: false, currency: 'USD' })).status).toBe(201);
  });
});

describe('T5: the missing-time reminder runs on each member’s clock', () => {
  it('reminds someone in Manila at their check time, while it is still early morning in New York', async () => {
    await admin.patch(o(''), { settings: { minDailySeconds: 8 * 3600, missingTimeReminder: true, missingTimeCheckAt: '17:00' } });
    const { membershipId: mnl } = await addMember(t, admin, orgId, 'Mia', 'mia@p4.test');
    expect((await admin.patch(o(`/workers/${mnl}`), { timezone: 'Asia/Manila' })).status).toBe(200);
    // Thursday 22 Oct, 17:05 in Manila = 05:05 in New York.
    t.clock.set(new Date('2026-10-22T09:05:00Z'));
    t.mailer.sent.length = 0;
    await runWorkforceAlerts(t.deps);
    const to = t.mailer.sent.filter((m) => m.subject === 'Your timesheet is missing time').map((m) => m.to);
    expect(to).toContain('mia@p4.test'); // was nobody: the org's clock said 05:05
    expect(to).not.toContain('wes@p4.test'); // New York hasn't reached 17:00
  });
});

describe('T6: time off used', () => {
  it('reopening a timesheet with per-hour accrual is not time off used', async () => {
    const { client: ann, membershipId: annId } = await addMember(t, admin, orgId, 'Ann', 'ann@p4.test');
    await admin.patch(o(`/projects/${projectId}`), { member_ids: [annId] });
    const comp = (await admin.post(o('/time-off/policies'), { name: 'Comp', accrual: { type: 'per_hour_worked', amountHours: 0.05, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [annId] })).body.id as string;
    t.clock.set(new Date('2026-10-20T12:00:00Z'));
    await admin.post(o('/manual-time'), { membership_id: annId, project_id: projectId, started_at: '2026-10-13T13:00:00Z', ended_at: new Date(Date.parse('2026-10-13T13:00:00Z') + 10 * H).toISOString(), reason: 'fixture' });
    const ts = (await ann.post(o('/timesheets/submit'), { date: '2026-10-13' })).body.id as string;
    expect((await admin.post(o(`/timesheets/${ts}/approve`), {})).status).toBe(200);
    expect((await admin.post(o(`/timesheets/${ts}/reopen`), { comment: 'fix' })).status).toBe(200);
    const b = ((await admin.get(o(`/time-off/balances?membership_id=${annId}`))).body as Array<{ policy_id: string; balance_hours: number; used_hours: number }>).find((x) => x.policy_id === comp)!;
    expect([b.balance_hours, b.used_hours]).toEqual([0, 0]); // used was 0.5 after the reopen
  });
});
