import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { hotReads, runHotRead, setupHotOrg, type HotOrg } from './support/hot-reads';

/**
 * Query budgets for the hot reads (Phase 14). Each endpoint runs against an organization at scale 1
 * (20 members) and scale 5 (100 members) with 60 days of history. The number of SQL statements, from
 * Server-Timing, must not grow with the organization (an N+1 shows up as a count that does) and must
 * stay within the budget below. Counts are deterministic; timings in PGlite are not, so they are not
 * asserted here. The same reads feed the index review (scripts/perf-index-review.ts).
 */
let t: Harness;
const orgs: HotOrg[] = [];

beforeAll(async () => {
  t = await createHarness();
  for (const scale of [1, 5]) orgs.push(await setupHotOrg(t, scale));
}, 180_000);
afterAll(() => t.close());

/**
 * The most SQL statements each read may send (measured 19 Nov 2026, the same at scale 1 and 5). A count
 * above its budget fails: find the extra query, batch it, or raise the budget on purpose in review.
 */
const BUDGET: Record<string, number> = {
  'dashboard widgets': 22,
  'live tracking': 8,
  'time entries, 7 days': 6,
  'attendance today': 12,
  'time & activity report, 30 days': 5,
  'timesheet of a member': 10,
  'timesheet approvals': 5,
  members: 7,
  projects: 9,
  clients: 5,
  'summary (insights), 7 days': 13,
  'sessions, 7 days': 9,
  'activity of a member, one day': 11,
  'screenshots, one day': 6,
  'portal summary, 30 days': 20,
  'portal insights': 16,
  'manager: dashboard widgets': 21,
  'manager: live tracking': 8,
  'manager: time entries, 7 days': 6,
  'manager: attendance today': 11,
  'manager: timesheet approvals': 5,
  // 55 at scale 1 and 87 at scale 5 before milestones were read in one query (two per project).
  'manager: AI insights overview': 40,
  'AI insights overview': 48,
};

describe('hot reads: query counts do not grow with the organization', () => {
  const rows: string[] = [];
  afterAll(() => {
    // Set PERF_REPORT=<file> to keep the table (the reporter hides output from passing tests).
    if (process.env.PERF_REPORT) writeFileSync(process.env.PERF_REPORT, `${rows.join('\n')}\n`);
  });

  // The list needs the harness clock; it is read when the tests run, after beforeAll.
  const names = hotReads({ clock: { now: new Date() } } as Harness).map((r) => r.name);

  it('every hot read has a budget', () => {
    expect([...names].sort()).toEqual(Object.keys(BUDGET).sort());
  });

  it.each(names)('%s', async (name) => {
    const r = hotReads(t).find((x) => x.name === name)!;
    const small = await runHotRead(orgs[0]!, r);
    const large = await runHotRead(orgs[1]!, r);
    rows.push(`${name.padEnd(34)} scale1 ${small.queries}  scale5 ${large.queries}  budget ${BUDGET[name]}`);
    expect([small.status, large.status]).toEqual([200, 200]);
    // The same work for 20 members or 100: anything else is a query per row (N+1).
    expect(large.queries, 'query count grows with the organization').toBe(small.queries);
    expect(small.queries).toBeLessThanOrEqual(BUDGET[name]!);
  });
});
