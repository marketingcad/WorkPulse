import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { achievementAwards, performanceScoreSnapshots, withTenant } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, signup, type Harness } from './harness';
import { performanceDaily } from '../src/services/performance-jobs';
import { saveSnapshot } from '../src/services/performance';

/**
 * Performance Center fixes from the pre-UI review:
 * - scores stay open for SCORE_SETTLE_DAYS after a period ends, so late approvals and reviews count;
 * - reading an old date never computes final history, and a closed period cannot be recalculated;
 * - saving a snapshot is one statement that never overwrites a final one;
 * - `workers_see_own_score` and `leaderboard_managers` hold on every route;
 * - a profile's goals and achievements follow their own permissions;
 * - the overview's achievements-by-month covers its six months whatever the period.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let managerId: string;
let worker: Client;
let workerId: string;
let team: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const at = (iso: string) => t.clock.set(new Date(iso));
const daily = () => withTenant(t.h.db, orgId, (tx) => performanceDaily(tx, t.deps, orgId));
const snapshot = (periodType: string, periodStart: string, subjectId = workerId) =>
  withTenant(t.h.db, orgId, async (tx) => (await tx.select().from(performanceScoreSnapshots).where(and(eq(performanceScoreSnapshots.subjectId, subjectId), eq(performanceScoreSnapshots.periodType, periodType as 'MONTH'), eq(performanceScoreSnapshots.periodStart, periodStart))))[0]);
const reviewsCounted = (s: Awaited<ReturnType<typeof snapshot>>) => (s?.metrics as { inputs: { quality: { reviews: number } } }).inputs.quality.reviews;

beforeAll(async () => {
  t = await createHarness();
  at('2026-11-12T14:00:00Z');
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@pi.test'));
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Maya', 'maya@pi.test', 'TEAM_MANAGER'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Zara', 'zara@pi.test'));
  team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' });
  await admin.put(o(`/teams/${team}/members/${workerId}`), { role: 'MEMBER' });
}, 90_000);
afterAll(() => t.close());

describe('the overview', () => {
  it('counts achievements in each of its six months, also when viewing by week', async () => {
    const teamPlayer = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'team_player').id;
    const award = await admin.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: workerId, reason: 'Covered the launch' });
    expect(award.status).toBe(201);
    // Given in August: outside the six weeks of the score trend, inside the six months of the chart.
    await withTenant(t.h.db, orgId, (tx) => tx.update(achievementAwards).set({ createdAt: new Date('2026-08-20T15:00:00Z') }).where(eq(achievementAwards.id, award.body.id)));
    const r = await admin.get(o('/performance/overview?period=WEEK'));
    expect(r.status).toBe(200);
    const august = r.body.achievements_by_month.find((m: { month: string }) => m.month === '2026-08-01');
    expect(august.bronze + august.silver + august.gold + august.platinum).toBe(1);
  });
});

describe('who sees scores and ranks', () => {
  it('a worker reads their own score only when the organization shares scores with workers', async () => {
    const own = o(`/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`);
    expect((await worker.get(own)).status).toBe(403);
    expect((await worker.get(o(`/performance/members/${workerId}/history`))).status).toBe(403);
    await admin.put(o('/performance/settings'), { workers_see_own_score: true });
    expect((await worker.get(own)).status).toBe(200);
    expect((await worker.get(o(`/performance/members/${workerId}/history`))).status).toBe(200);
    // Still nobody else's, and never the manager-facing profile with its rank.
    expect((await worker.get(o(`/performance/members/${managerId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(404);
    expect((await worker.get(o(`/performance/members/${workerId}/profile`))).status).toBe(403);
    await admin.put(o('/performance/settings'), { workers_see_own_score: false });
  });

  it('hiding leaderboards from managers also hides ranks on Team performance and profiles', async () => {
    await admin.put(o('/performance/settings'), { leaderboard_managers: false });
    const teams = await manager.get(o('/performance/teams?period=MONTH'));
    expect(teams.status).toBe(200);
    expect(teams.body.ranks_hidden).toBe(true);
    for (const x of teams.body.teams) expect(x.rank).toBeNull();
    const profile = await manager.get(o(`/performance/members/${workerId}/profile?period=MONTH`));
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ ranks_hidden: true, rank: null, rank_group_size: null });
    // Admins still see them.
    const asAdmin = await admin.get(o(`/performance/members/${workerId}/profile?period=MONTH`));
    expect(asAdmin.body).toMatchObject({ ranks_hidden: false });
    expect(asAdmin.body.rank_group_size).not.toBeNull();
    await admin.put(o('/performance/settings'), { leaderboard_managers: true });
    expect((await manager.get(o('/performance/teams?period=MONTH'))).body.ranks_hidden).toBe(false);
  });

  it('a profile shows goals and achievements only to someone who may read them', async () => {
    const goal = await admin.post(o('/performance/goals'), { title: 'Ship 4 tasks', subject_type: 'MEMBER', subject_id: workerId, metric: 'TASKS_COMPLETED', target: 4, start_date: '2026-11-01', end_date: '2026-11-30' });
    expect(goal.status).toBe(201);
    const full = await admin.get(o(`/performance/members/${workerId}/profile?period=MONTH`));
    expect(full.body.goals.length).toBeGreaterThan(0);
    expect(full.body.achievements.length).toBeGreaterThan(0);

    const role = await admin.post(o('/roles'), { name: 'Score reader', grants: { 'performance:read': 'org', 'members:read': 'org' } });
    expect(role.status).toBe(201);
    const inv = await admin.post(o('/invitations'), { email: 'sol@pi.test', name: 'Sol', role_id: role.body.id });
    const reader = new Client(t);
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    expect((await reader.post('/auth/invitations/accept', { token, name: 'Sol', password: 'correct-horse-battery' })).status).toBe(200);
    const limited = await reader.get(o(`/performance/members/${workerId}/profile?period=MONTH`));
    // Before the fix: 403 (achievements) or the goals leaked. Now: the profile, without those sections.
    expect(limited.status).toBe(200);
    expect(limited.body).toMatchObject({ goals: [], achievements: [] });
    expect(limited.body.score.membership_id).toBe(workerId);
  });
});

describe('reading and recalculating old periods', () => {
  it('a read for a long-past date computes nothing and saves no history', async () => {
    const before = await withTenant(t.h.db, orgId, (tx) => tx.select({ id: performanceScoreSnapshots.id }).from(performanceScoreSnapshots));
    const board = await admin.get(o('/performance/leaderboard?period=MONTH&date=2022-01-15'));
    expect(board.status).toBe(200);
    for (const row of board.body.rows) expect(row).toMatchObject({ score: null, rank: null });
    expect((await admin.get(o('/performance/overview?period=MONTH&date=2022-01-15'))).status).toBe(200);
    expect((await worker.get(o('/performance/leaderboard?period=MONTH&date=2022-01-15'))).status).toBe(403);
    expect((await admin.get(o('/performance/members?period=MONTH&date=2022-01-15'))).status).toBe(200);
    const old = await withTenant(t.h.db, orgId, (tx) => tx.select().from(performanceScoreSnapshots).where(like(performanceScoreSnapshots.periodStart, '2022-%')));
    expect(old).toHaveLength(0);
    const after = await withTenant(t.h.db, orgId, (tx) => tx.select({ id: performanceScoreSnapshots.id }).from(performanceScoreSnapshots));
    expect(after.length).toBe(before.length);
  });

  it('an admin cannot recalculate a settled period, only one still open', async () => {
    const closed = await admin.post(o('/performance/recalculate'), { period: 'MONTH', date: '2022-01-15' });
    expect(closed.status).toBe(422);
    expect(closed.body.code).toBe('period_closed');
    expect((await admin.post(o('/performance/recalculate'), { period: 'MONTH' })).status).toBe(200);
    expect((await manager.post(o('/performance/recalculate'), { period: 'MONTH' })).status).toBe(403);
  });
});

describe('saving a snapshot', () => {
  const base = { subjectType: 'ORG' as const, periodType: 'MONTH' as const, periodStart: '2030-01-01', periodEnd: '2030-01-31', ruleVersion: 1, coverage: 0, metrics: {}, eligible: true, rankGroup: null };
  const save = (score: number, final: boolean, subjectId: string) =>
    withTenant(t.h.db, orgId, async (tx) => {
      const [rule] = await tx.select({ ruleId: performanceScoreSnapshots.ruleId }).from(performanceScoreSnapshots).limit(1);
      return saveSnapshot(tx, orgId, { ...base, subjectId, ruleId: rule!.ruleId, score, final, calculatedAt: t.clock.now });
    });

  it('updates an open snapshot in place, and returns a final one unchanged', async () => {
    const subject = newId();
    const first = await save(50, false, subject);
    const second = await save(60, true, subject);
    expect(second).toMatchObject({ id: first.id, score: 60, final: true });
    const third = await save(10, false, subject);
    expect(third).toMatchObject({ id: first.id, score: 60, final: true });
  });

  it('two first reads of a new period both succeed', async () => {
    // No quarter has been read or calculated yet in this organization.
    const [a, m] = await Promise.all([admin.get(o('/performance/overview?period=QUARTER')), manager.get(o('/performance/overview?period=QUARTER'))]);
    expect([a.status, m.status]).toEqual([200, 200]);
    const quarter = await withTenant(t.h.db, orgId, (tx) => tx.select().from(performanceScoreSnapshots).where(and(eq(performanceScoreSnapshots.subjectType, 'ORG'), eq(performanceScoreSnapshots.periodType, 'QUARTER'))));
    expect(quarter).toHaveLength(1);
  });
});

describe('scores settle before they are final', () => {
  it('a review written after the month ends still counts until the month settles; then it is final', async () => {
    at('2026-12-02T15:00:00Z');
    await daily();
    const open = await snapshot('MONTH', '2026-11-01');
    expect(open).toMatchObject({ final: false });
    expect(reviewsCounted(open)).toBe(0);

    // A final review about November, added now that November is over (what counts is the period it
    // covers; the request is sent on a clock the test sessions are still valid on).
    const review = { membership_id: workerId, period_start: '2026-11-01', period_end: '2026-11-30', quality_rating: 4, status: 'FINAL' };
    const addReview = async (r: typeof review) => {
      const now = t.clock.now;
      at('2026-11-12T14:00:00Z');
      expect((await admin.post(o('/performance/reviews'), r)).status).toBe(201);
      t.clock.set(now);
    };
    await addReview(review);
    at('2026-12-03T15:00:00Z');
    await daily();
    const counted = await snapshot('MONTH', '2026-11-01');
    expect(counted).toMatchObject({ id: open!.id, final: false });
    expect(reviewsCounted(counted)).toBe(1);

    // 14 days after November 30: final, and nothing written later changes it.
    at('2026-12-15T15:00:00Z');
    await daily();
    const settled = await snapshot('MONTH', '2026-11-01');
    expect(settled).toMatchObject({ id: open!.id, final: true });
    await addReview({ ...review, quality_rating: 1 });
    at('2026-12-16T15:00:00Z');
    await daily();
    const later = await snapshot('MONTH', '2026-11-01');
    expect(later!.calculatedAt.toISOString()).toBe(settled!.calculatedAt.toISOString());
    expect(reviewsCounted(later)).toBe(1);
    at('2026-11-12T14:00:00Z');
  });

  it('the daily job keeps every unsettled week current, not only the previous one', async () => {
    at('2026-12-15T15:00:00Z');
    await daily();
    // Week of Nov 30 – Dec 6 is two weeks back on Tuesday, Dec 15, and has not settled.
    const twoBack = await snapshot('WEEK', '2026-11-30');
    expect(twoBack).toMatchObject({ final: false });
    expect(twoBack!.calculatedAt.toISOString()).toBe('2026-12-15T15:00:00.000Z');
    // Week of Nov 23 – 29 settled on Dec 14.
    expect(await snapshot('WEEK', '2026-11-23')).toMatchObject({ final: true });
    at('2026-11-12T14:00:00Z');
  });
});

describe('the dashboard', () => {
  it('time-off rows name the member, so the widget can show their picture', async () => {
    const policy = (await admin.post(o('/time-off/policies'), { name: 'Leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: true })).body.id as string;
    const req = await worker.post(o('/time-off/requests'), { policy_id: policy, start_date: '2026-11-19', end_date: '2026-11-19' });
    expect(req.status).toBe(201);
    const r = await admin.get(o('/dashboard/widgets?keys=time_off_requests'));
    expect(r.status).toBe(200);
    expect(r.body.time_off_requests).toEqual(expect.arrayContaining([expect.objectContaining({ membership_id: workerId, worker_name: 'Zara' })]));
  });
});
