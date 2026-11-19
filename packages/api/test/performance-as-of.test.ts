import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * The Performance pages show stored scores (refreshed once a day, or when an admin recalculates), not
 * live ones. After an approval they kept showing the old approved time while other screens showed the
 * new one, and nothing said how old the scores were (QA round 7, BUG-31). Every score page now says
 * when its scores were calculated.
 */
const T1 = new Date('2026-11-18T15:00:00Z');
const H = 3600;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: { client: Client; membershipId: string };
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

const PAGES = (id: string) => [
  '/performance/overview?period=MONTH',
  '/performance/leaderboard?period=MONTH',
  '/performance/teams?period=MONTH',
  '/performance/members?period=MONTH',
  `/performance/members/${id}/profile?period=MONTH`,
];

async function approve(date: string, hours: number) {
  const s = new Date(`${date}T14:00:00Z`);
  expect((await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + hours * H * 1000).toISOString(), reason: 'fixture' })).status).toBe(201);
  const ts = await walt.client.post(o('/timesheets/submit'), { date });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  await t.flush();
}

const waltApproved = async () => ((await admin.get(o('/performance/members?period=MONTH'))).body.rows as Array<{ id: string; approved_seconds: number }>).find((r) => r.id === walt.membershipId)!.approved_seconds;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(T1);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@perf-as-of.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@perf-as-of.test');
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [walt.membershipId] })).body.id;
  await approve('2026-11-02', 2);
}, 60_000);
afterAll(() => t.close());

describe('performance scores say when they were calculated', () => {
  let first: string;

  it('every score page reports the time of its scores', async () => {
    for (const path of PAGES(walt.membershipId)) {
      const r = await admin.get(o(path));
      expect(r.status, path).toBe(200);
      expect(r.body.calculated_at, path).toBe(T1.toISOString());
    }
    first = T1.toISOString();
    expect(await waltApproved()).toBe(2 * H);
  });

  it('an approval does not change them: the pages keep the earlier figures, and say when they are from', async () => {
    t.clock.set(new Date(T1.getTime() + 2 * H * 1000));
    await approve('2026-11-09', 3);
    expect(await waltApproved()).toBe(2 * H); // the stored score, not yet the new 3 hours
    for (const path of PAGES(walt.membershipId)) expect((await admin.get(o(path))).body.calculated_at, path).toBe(first);
  });

  it('recalculating brings in the new time and moves the time forward', async () => {
    expect((await admin.post(o('/performance/recalculate'), { period: 'MONTH' })).status).toBe(200);
    expect(await waltApproved()).toBe(5 * H);
    const later = new Date(T1.getTime() + 2 * H * 1000).toISOString();
    for (const path of PAGES(walt.membershipId)) expect((await admin.get(o(path))).body.calculated_at, path).toBe(later);
  });
});
