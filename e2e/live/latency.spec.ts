import { LIVE_STATE } from './env';
import { expect, test } from './fixtures';

/**
 * Report-only latency of the signed-in API on the live site: p50 / p95 per endpoint and, once deployed,
 * the database work from Server-Timing. Attached to the report as latency.json; it never fails on speed.
 */
test.use({ storageState: LIVE_STATE });

const SAMPLES = 5;

test('signed-in API latency (report only)', async ({ page, data }, testInfo) => {
  test.slow();
  const org = `/api/v1/orgs/${data.orgId}`;
  const endpoints = ['/api/v1/me', org, `${org}/projects`, `${org}/workers?page=1&page_size=50`, `${org}/notifications`];
  const rows: Array<{ endpoint: string; p50: number; p95: number; db?: string }> = [];

  for (const endpoint of endpoints) {
    const times: number[] = [];
    let db: string | undefined;
    for (let i = 0; i < SAMPLES; i++) {
      const started = Date.now();
      const res = await page.request.get(endpoint);
      times.push(Date.now() - started);
      expect(res.status(), endpoint).toBe(200);
      db = res.headers()['server-timing'] ?? db;
    }
    times.sort((a, b) => a - b);
    rows.push({ endpoint: endpoint.replace(data.orgId, ':org'), p50: times[Math.floor(SAMPLES / 2)]!, p95: times[SAMPLES - 1]!, db });
  }

  await testInfo.attach('latency.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  for (const r of rows) testInfo.annotations.push({ type: 'latency', description: `${r.endpoint}: p50 ${r.p50} ms, p95 ${r.p95} ms${r.db ? `, ${r.db}` : ''}` });
});
