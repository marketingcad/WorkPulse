import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runTick } from '../src/jobs';
import { processReportRuns } from '../src/services/report-runs';
import { csvStream, toCsv } from '../src/lib/export';
import type { ReportResult } from '../src/services/reports';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Phase 11 gate: every report is scope-correct and reconciles with its source tables; exports
// run in the background and stream; scheduled reports fire in the schedule's time zone.
const NOW = new Date('2026-09-23T20:00:00Z');
const RANGE = { from: '2026-09-14', to: '2026-09-20' };

let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let anna: Client;
let annaId: string;
let ben: Client;
let benId: string;
let projectId: string;
let clientId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const run = async (c: Client, key: string, extra: object = {}) => {
  const r = await c.post(o(`/reports/${key}/query`), { ...RANGE, ...extra });
  expect(r.status, `${key}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  return r.body as { rows: Array<Record<string, unknown>>; totals?: Record<string, number>; columns: Array<{ key: string }> };
};
async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
async function tracked(c: Client, startIso: string, minutes: number) {
  t.clock.set(new Date(startIso));
  expect((await c.post(o('/tracking/start'), { project_id: projectId })).status).toBe(200);
  t.clock.set(new Date(Date.parse(startIso) + minutes * 60_000));
  await c.post(o('/tracking/stop'));
}
async function relogin() {
  for (const [c, e] of [[admin, 'ada'], [manager, 'mona'], [anna, 'anna'], [ben, 'ben']] as const) {
    c.cookie = '';
    await c.post('/auth/login', { email: `${e}@rep.test`, password: 'correct-horse-battery' });
  }
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-09-14T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@rep.test'));
  let managerId: string;
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Mona', 'mona@rep.test', 'TEAM_MANAGER'));
  ({ client: anna, membershipId: annaId } = await addMember(t, admin, orgId, 'Anna', 'anna@rep.test'));
  ({ client: ben, membershipId: benId } = await addMember(t, admin, orgId, 'Ben', 'ben@rep.test'));
  const team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' });
  await admin.put(o(`/teams/${team}/members/${annaId}`), { role: 'MEMBER' });
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  projectId = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId, member_ids: [annaId, benId], billable_default: true })).body.id;
  await admin.post(o('/rates'), { kind: 'BILL', scope: 'PROJECT', scope_id: projectId, amount_minor: 10000, currency: 'USD', effective_from: '2020-01-01' });
  await admin.post(o('/rates'), { kind: 'PAY', scope: 'ORG', amount_minor: 3000, currency: 'USD', effective_from: '2020-01-01' });

  // Tracked time (web timer), manual time, a break, time off, an expense — for both workers.
  await tracked(anna, '2026-09-15T13:00:00Z', 90);
  await tracked(ben, '2026-09-15T13:00:00Z', 45);
  t.clock.set(new Date('2026-09-16T13:00:00Z'));
  await anna.post(o('/tracking/start'), { project_id: projectId });
  t.clock.set(new Date('2026-09-16T13:30:00Z'));
  await anna.post(o('/tracking/pause'), {});
  t.clock.set(new Date('2026-09-16T13:40:00Z'));
  await anna.post(o('/tracking/resume'), {});
  t.clock.set(new Date('2026-09-16T14:00:00Z'));
  await anna.post(o('/tracking/stop'));
  t.clock.set(NOW);
  await relogin();
  for (const [id, h] of [[annaId, 2], [benId, 3]] as const) {
    await admin.post(o('/manual-time'), { membership_id: id, project_id: projectId, started_at: '2026-09-17T13:00:00Z', ended_at: new Date(Date.parse('2026-09-17T13:00:00Z') + h * 3600_000).toISOString(), reason: 'Workshop' });
  }
  const pol = (await admin.post(o('/time-off/policies'), { name: 'Leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
  expect((await anna.post(o('/time-off/requests'), { policy_id: pol, start_date: '2026-09-18', end_date: '2026-09-18' })).status).toBe(201);
  expect((await ben.post(o('/time-off/requests'), { policy_id: pol, start_date: '2026-09-18', end_date: '2026-09-22' })).status).toBe(201); // spills past the range
  await anna.post(o('/expenses'), { category: 'Travel', amount_minor: 4200, currency: 'USD', spent_on: '2026-09-16', project_id: projectId, billable: true });
  await ben.post(o('/expenses'), { category: 'Meals', amount_minor: 1300, currency: 'USD', spent_on: '2026-09-16', project_id: projectId, billable: false });
  for (const c of [anna, ben]) {
    const ts = await c.post(o('/timesheets/submit'), { date: '2026-09-14' });
    await admin.post(o(`/timesheets/${ts.body.id}/approve`), {});
  }
  await t.flush();
});
afterAll(() => t.close());

describe('scope on every report', () => {
  it('a team manager never sees anyone outside the team, in any report', async () => {
    const catalog = (await manager.get(o('/reports'))).body as Array<{ key: string }>;
    expect(catalog.length).toBeGreaterThan(5);
    for (const { key } of catalog) {
      const r = await run(manager, key);
      const text = JSON.stringify(r.rows);
      expect(text.includes('Ben') || text.includes(benId), `${key} leaks Ben`).toBe(false);
    }
  });

  it('a worker only sees themselves, in any report they can open', async () => {
    const catalog = (await ben.get(o('/reports'))).body as Array<{ key: string }>;
    for (const { key } of catalog) {
      const text = JSON.stringify((await run(ben, key)).rows);
      expect(text.includes('Anna') || text.includes(annaId), `${key} leaks Anna`).toBe(false);
    }
    expect(catalog.map((c) => c.key)).not.toContain('payroll');
    expect((await ben.post(o('/reports/payroll/query'), RANGE)).status).toBe(403);
  });

  it('all 19 reports run for an admin; 14 are offered (5 are covered by another report)', async () => {
    const catalog = (await admin.get(o('/reports'))).body as Array<{ key: string; hidden: boolean }>;
    expect(catalog).toHaveLength(19);
    expect(catalog.filter((r) => !r.hidden)).toHaveLength(14);
    for (const { key } of catalog) await run(admin, key);
  });
});

describe('totals reconcile with source tables', () => {
  let entries: { tracked: number; manual: number };
  beforeAll(async () => {
    const [e] = await asOwner<{ tracked: number; manual: number }>(sql`
      select coalesce(sum(duration_seconds) filter (where source = 'TRACKED'), 0)::int tracked, coalesce(sum(duration_seconds) filter (where source = 'MANUAL'), 0)::int manual
        from time_entries where organization_id = ${orgId} and deleted_at is null and local_date between ${RANGE.from} and ${RANGE.to}`);
    entries = e!;
    expect(entries).toEqual({ tracked: (90 + 45 + 50) * 60, manual: 5 * 3600 });
  });

  it('time & activity and daily totals', async () => {
    expect((await run(admin, 'time-activity')).totals).toMatchObject({ tracked: entries.tracked, manual: entries.manual, total: entries.tracked + entries.manual });
    const daily = await run(admin, 'daily-totals');
    const dailySum = daily.rows.reduce((s, r) => s + Object.entries(r).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k)).reduce((a, [, v]) => a + Number(v ?? 0), 0), 0);
    expect(dailySum || daily.totals?.total).toBe(entries.tracked + entries.manual);
  });

  it('work sessions and breaks', async () => {
    const s = await run(admin, 'work-sessions');
    expect(s.totals!.worked).toBe(entries.tracked);
    expect(s.totals!.breaks).toBe(10 * 60);
    expect((await run(admin, 'work-breaks')).totals!.breaks).toBe(10 * 60);
  });

  it('manual time, payroll and amounts owed', async () => {
    expect((await run(admin, 'manual-time')).totals!.duration_seconds).toBe(entries.manual);
    const pay = await run(admin, 'payroll');
    expect(pay.totals!.regular! + pay.totals!.overtime!).toBe(entries.tracked + entries.manual);
    expect(pay.totals!.earnings).toBe(Math.round(((entries.tracked + entries.manual) * 3000) / 3600));
    // Time off inside the range only: Anna 8h, Ben Fri 18th (8h) — not the 21st and 22nd.
    const off = Object.fromEntries(pay.rows.map((r) => [r.worker, r.time_off_hours]));
    expect(off).toMatchObject({ Anna: 8, Ben: 8 });
    const owed = await run(admin, 'amounts-owed');
    expect(owed.totals!.approved_seconds).toBe(entries.tracked + entries.manual);
  });

  it('billing, expenses and time off', async () => {
    const [b] = await asOwner<{ s: number; a: number }>(sql`select coalesce(sum(seconds),0)::int s, coalesce(sum(bill_amount_minor),0)::int a from billing_entries where organization_id = ${orgId} and voided_at is null and billable`);
    expect((await run(admin, 'billing')).totals).toMatchObject({ approved_seconds: b!.s, approved: b!.a });
    expect((await run(admin, 'expenses')).totals!.amount_minor).toBe(4200 + 1300);
    expect((await run(admin, 'time-off')).totals!.hours).toBe(8 + 24); // requests, as filed
  });
});

describe('exports', () => {
  it('run in the background and are delivered by a signed, expiring download link', async () => {
    const q = await admin.post(o('/reports/time-activity/export-runs'), { ...RANGE, format: 'CSV' });
    expect([q.status, q.body.status]).toEqual([202, 'QUEUED']);
    expect(await processReportRuns(t.deps)).toBe(1);
    const [r] = (await admin.get(o('/report-runs'))).body;
    expect(r).toMatchObject({ id: q.body.id, status: 'DONE', format: 'CSV' });
    const file = await new Client(t).get(r.download_url.replace('/api/v1', ''));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/attachment; filename="time-activity_2026-09-14_2026-09-20\.csv"/);
    expect(String(file.body)).toContain('Anna');
    // Other members cannot see the run; the link expires.
    expect((await manager.get(o('/report-runs'))).body.find((x: { id: string }) => x.id === r.id)).toBeUndefined();
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    try {
      expect((await new Client(t).get(r.download_url.replace('/api/v1', ''))).status).toBe(404);
    } finally {
      Date.now = realNow;
    }
    await t.flush();
    expect(((await admin.get(o('/notifications'))).body.data as Array<{ type: string }>).some((n) => n.type === 'report.ready')).toBe(true);
  });

  it('a queued export runs with the permissions of whoever asked for it', async () => {
    const q = await manager.post(o('/reports/time-activity/export-runs'), { ...RANGE, format: 'XLSX' });
    expect(q.status).toBe(202);
    await processReportRuns(t.deps);
    const [r] = (await manager.get(o('/report-runs'))).body;
    expect(r.status).toBe('DONE');
    expect((await ben.post(o('/reports/payroll/export-runs'), { ...RANGE, format: 'CSV' })).status).toBe(403);
  });

  it('CSV streams a chunk at a time: a million rows without building the file in memory', async () => {
    const rows = Array.from({ length: 1_000_000 }, (_, i) => ({ worker: `Worker ${i % 50}`, project: 'Site', seconds: i % 3600 }));
    const result: ReportResult = { columns: [{ key: 'worker', label: 'Member', type: 'text' as const }, { key: 'project', label: 'Project', type: 'text' as const }, { key: 'seconds', label: 'Time', type: 'duration' as const }], rows, summary: [] };
    // The file is produced lazily in small pieces (pull-based): no piece is more than one chunk of
    // rows, so memory stays bounded however large the export is.
    let bytes = 0;
    let chunks = 0;
    let largest = 0;
    const reader = csvStream(result).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks++;
      largest = Math.max(largest, value.byteLength);
    }
    expect(bytes).toBeGreaterThan(20_000_000); // ~25 MB of CSV in total
    expect(chunks).toBeGreaterThan(500);
    expect(largest).toBeLessThan(128 * 1024);
    // Same bytes as the in-memory encoder (for a small result).
    const small: ReportResult = { ...result, rows: rows.slice(0, 5) };
    // (compare bytes: decoding as text would drop the byte-order mark)
    expect(Buffer.from(await new Response(csvStream(small)).arrayBuffer()).equals(Buffer.from(toCsv(small)))).toBe(true);
  }, 120_000);
});

describe('scheduled reports', () => {
  it('validates the schedule and keeps recipients inside the organization', async () => {
    const base = { report_key: 'time-activity', name: 'Weekly hours', params: { range: 'last_week' }, schedule_cron: '0 8 * * 1', recipients: ['mona@rep.test'] };
    expect((await manager.post(o('/saved-reports'), { ...base, schedule_cron: '99 * * * *' })).status).toBe(400);
    const ext = await manager.post(o('/saved-reports'), { ...base, recipients: ['someone@gmail.com'] });
    expect([ext.status, ext.body.title]).toEqual([400, 'Recipients must be members of this organization: someone@gmail.com']);
    expect((await manager.post(o('/saved-reports'), { ...base, params: {} })).status).toBe(400); // no dates
    expect((await ben.post(o('/saved-reports'), { ...base, report_key: 'payroll', recipients: ['ben@rep.test'] })).status).toBe(403);
  });

  it('fires in the schedule time zone, once, with the relative range resolved on the day', async () => {
    // Mondays 08:00 in New York (EDT) = 12:00 UTC.
    const s = await manager.post(o('/saved-reports'), { report_key: 'time-activity', name: 'Weekly hours', params: { range: 'last_week', format: 'CSV' }, schedule_cron: '0 8 * * 1', schedule_timezone: 'America/New_York', recipients: ['mona@rep.test', 'ada@rep.test'] });
    expect(s.status).toBe(201);
    t.mailer.sent.length = 0;
    t.clock.set(new Date('2026-09-28T11:59:00Z')); // 07:59 local: not yet
    expect((await runTick(t.deps)).reports.queued).toBe(0);
    t.clock.set(new Date('2026-09-28T12:00:30Z')); // 08:00 local
    const tick = await runTick(t.deps);
    expect(tick.reports).toMatchObject({ queued: 1 });
    expect((await runTick(t.deps)).reports.queued).toBe(0); // same minute, and the next: once
    const mails = t.mailer.sent.filter((m) => m.subject.startsWith('Weekly hours'));
    expect(mails.map((m) => m.to).sort()).toEqual(['ada@rep.test', 'mona@rep.test']);
    expect(mails[0]!.subject).toBe('Weekly hours — 2026-09-21 to 2026-09-27');
    const link = /\/api\/v1\/media\/\S+/.exec(mails[0]!.text)![0]!;
    const file = String((await new Client(t).get(link.replace('/api/v1', ''))).body);
    // Run as the owner (a team manager): only her team.
    expect(file).not.toContain('Ben');
  });

  it('a missed tick still runs the schedule once (within the hour)', async () => {
    const s = await admin.post(o('/saved-reports'), { report_key: 'payroll', name: 'Daily payroll', params: { range: 'yesterday' }, schedule_cron: '30 6 * * *', recipients: ['ada@rep.test'] });
    expect(s.status).toBe(201);
    t.mailer.sent.length = 0;
    t.clock.set(new Date('2026-09-29T11:05:00Z')); // 07:05 local: the 06:30 tick was missed
    await relogin();
    expect((await runTick(t.deps)).reports.queued).toBe(1);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Daily payroll')).map((m) => m.subject)).toEqual(['Daily payroll — 2026-09-28 to 2026-09-28']);
    expect((await runTick(t.deps)).reports.queued).toBe(0);
  });
});
