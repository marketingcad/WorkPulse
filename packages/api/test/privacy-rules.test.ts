import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processReportRuns } from '../src/services/report-runs';
import { redactForAudit } from '../src/services/events';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Privacy and the audit log (QA pass, feature 24).
 *
 * - BUG-42: after a member's data was erased, the personal-data exports made of them stayed: the
 *   requester could download the full file from Exports for as long as it was kept.
 * - BUG-43: the audit log hid secrets only under eight exact key names, and never in its metadata.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type Run = { id: string; report_key: string; status: string; download_url: string | null; params?: { membership_id?: string } };

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@privacy-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('erasing a member (BUG-42)', () => {
  it('also deletes the personal-data exports made of them, by anyone', async () => {
    const walt = await addMember(t, admin, orgId, 'Walt', 'walt@privacy-rules.test');
    expect((await admin.post(o(`/workers/${walt.membershipId}/data-export`))).status).toBe(202);
    expect((await walt.client.post(o(`/workers/${walt.membershipId}/data-export`))).status).toBe(202);
    await processReportRuns(t.deps);
    const before = (await admin.get<Run[]>(o('/report-runs'))).body.filter((r) => r.report_key === 'data-export');
    expect(before).toHaveLength(1);
    expect(before[0]!.download_url).toBeTruthy();
    const keysBefore = [...t.storage.objects.keys()].filter((k) => k.includes('/exports/'));
    expect(keysBefore.length).toBeGreaterThanOrEqual(2);

    expect((await admin.post(o(`/workers/${walt.membershipId}/anonymize`))).status).toBe(200);

    // Nothing of Walt's data can be downloaded any more, and the files are gone from storage.
    const after = (await admin.get<Run[]>(o('/report-runs'))).body.filter((r) => r.report_key === 'data-export');
    expect(after.every((r) => !r.download_url)).toBe(true);
    for (const k of keysBefore) expect(t.storage.objects.has(k)).toBe(false);
  });

  it('keeps the exports made of other people', async () => {
    const lee = await addMember(t, admin, orgId, 'Lee', 'lee@privacy-rules.test');
    const kim = await addMember(t, admin, orgId, 'Kim', 'kim@privacy-rules.test');
    expect((await admin.post(o(`/workers/${kim.membershipId}/data-export`))).status).toBe(202);
    await processReportRuns(t.deps);
    const kimRun = (await admin.get<Run[]>(o('/report-runs'))).body.find((r) => r.report_key === 'data-export' && r.download_url);
    expect(kimRun).toBeTruthy();
    expect((await admin.post(o(`/workers/${lee.membershipId}/anonymize`))).status).toBe(200);
    const still = (await admin.get<Run[]>(o('/report-runs'))).body.find((r) => r.id === kimRun!.id);
    expect(still?.download_url).toBeTruthy();
  });
});

describe('what the audit log keeps (BUG-43)', () => {
  it('hides secret-looking values under any common name, at any depth', () => {
    const out = redactForAudit({
      name: 'Acme',
      apiKey: 'k1',
      api_key: 'k2',
      accessToken: 't1',
      refresh_token: 't2',
      clientSecret: 's1',
      private_key: 'p1',
      credentials: { user: 'u', pass: 'x' },
      config: { webhook: { signing_secret: 's2', url: 'https://example.test/hook' } },
      list: [{ password: 'pw' }],
      token_count: 3,
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    for (const secret of ['k1', 'k2', 't1', 't2', 's1', 'p1', '"x"', 's2', 'pw']) expect(text).not.toContain(secret);
    // Ordinary values stay readable.
    expect(out.name).toBe('Acme');
    expect(text).toContain('https://example.test/hook');
    expect(out.token_count).toBe(3);
  });

  it('applies to metadata too', async () => {
    const { audit } = await import('../src/services/events');
    const rows: Array<Record<string, unknown>> = [];
    const x = { org: { id: orgId }, actor: { principal: { type: 'user' }, membershipId: 'm' }, requestId: 'r', tx: { insert: () => ({ values: async (v: Record<string, unknown>) => void rows.push(v) }) } };
    await audit(x as never, { action: 'test.metadata', metadata: { run_id: 'r1', apiKey: 'should-not-stay' } });
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain('should-not-stay');
    expect((rows[0]!.metadata as { run_id: string }).run_id).toBe('r1');
  });
});
