import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTick } from '../src/jobs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Reports and exports (QA pass, feature 18).
 *
 * - BUG-87: a schedule in its own time zone resolved "last week" on the organization's date, which
 *   can still be the day before: a Monday-morning report in Tokyo sent the week before last.
 * - BUG-88: deleting a saved report left no audit row (creating and changing one do).
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type AuditRow = { action: string; target_id: string };
const auditFor = async (id: string) => {
  const b = (await admin.get<{ data: AuditRow[] } | AuditRow[]>(o(`/audit-logs?page=1&page_size=100`))).body;
  return (Array.isArray(b) ? b : b.data).filter((r) => r.target_id === id);
};

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-20T15:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@report-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('a schedule in its own time zone (BUG-87)', () => {
  it('resolves "last week" on its own date', async () => {
    // The organization is in New York; Monday 08:00 in Tokyo is still Sunday evening there.
    const s = await admin.post(o('/saved-reports'), { report_key: 'time-activity', name: 'Tokyo weekly', params: { range: 'last_week' }, schedule_cron: '0 8 * * 1', schedule_timezone: 'Asia/Tokyo', recipients: ['ada@report-rules.test'] });
    expect(s.status).toBe(201);
    t.mailer.sent.length = 0;
    t.clock.set(new Date('2026-11-22T23:00:30Z')); // Monday 23 Nov, 08:00 in Tokyo
    expect((await runTick(t.deps)).reports.queued).toBe(1);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Tokyo weekly')).map((m) => m.subject)).toEqual(['Tokyo weekly — 2026-11-16 to 2026-11-22']);
  });
});

describe('a schedule whose owner has left', () => {
  it('stops running', async () => {
    const { client: sam, membershipId } = await addMember(t, admin, orgId, 'Sam', 'sam@report-rules.test', 'SYSTEM_ADMIN');
    const s = await sam.post(o('/saved-reports'), { report_key: 'time-activity', name: 'Sam daily', params: { range: 'yesterday' }, schedule_cron: '0 * * * *', recipients: ['sam@report-rules.test', 'ada@report-rules.test'] });
    expect(s.status).toBe(201);
    expect((await admin.del(o(`/workers/${membershipId}`))).status).toBe(204);
    t.mailer.sent.length = 0;
    t.clock.advance(3600_000);
    await runTick(t.deps);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Sam daily'))).toHaveLength(0);
  });
});

describe('deleting a saved report (BUG-88)', () => {
  it('is in the audit log', async () => {
    const s = await admin.post<{ id: string }>(o('/saved-reports'), { report_key: 'time-activity', name: 'Old view', params: { range: 'last_week' } });
    expect((await admin.del(o(`/saved-reports/${s.body.id}`))).status).toBe(204);
    expect((await auditFor(s.body.id)).map((r) => r.action)).toContain('saved_report.deleted');
  });
});
