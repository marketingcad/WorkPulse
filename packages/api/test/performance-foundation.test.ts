import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, outboxEvents, performanceGoals, performanceReviews, performanceRules, performanceScoreSnapshots, withSystem, withTenant } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, signup, type Harness } from './harness';
import { loadOrg } from '../src/middleware/tenant';
import { snapshotMemberScore } from '../src/services/performance';

/**
 * Performance Center, phase 1: scoring rules and visibility, project milestones, the task.completed
 * event, member scores from real data, and score snapshots that stay reproducible. Covers admin,
 * team manager and worker scope, and tenant isolation.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let managerId: string;
let worker: Client;
let workerId: string;
let outsider: Client;
let outsiderId: string;
let other: Client;
let otherOrg: string;
let project: string;
let team: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const at = (iso: string) => t.clock.set(new Date(iso));
const events = (type: string) => withSystem(t.h.db, (tx) => tx.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId, orgId), eq(outboxEvents.eventType, type))));

beforeAll(async () => {
  t = await createHarness();
  // Monday 2 November 2026, 9:00 in New York (the organization's time zone).
  at('2026-11-02T14:00:00Z');
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@perf.test'));
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Maya', 'maya@perf.test', 'TEAM_MANAGER'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Zara', 'zara@perf.test'));
  ({ client: outsider, membershipId: outsiderId } = await addMember(t, admin, orgId, 'Omar', 'omar@perf.test'));
  team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  expect((await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' })).status).toBe(200);
  expect((await admin.put(o(`/teams/${team}/members/${workerId}`), { role: 'MEMBER' })).status).toBe(200);
  project = (await admin.post(o('/projects'), { name: 'Wonka SEO', member_ids: [managerId, workerId] })).body.id;
  ({ client: other, orgId: otherOrg } = await signup(t, 'Bea', 'bea@perf-other.test', 'Other Org'));
}, 90_000);
afterAll(() => t.close());

describe('scoring rules and visibility settings', () => {
  it('start with the default weights, and rankings hidden from workers', async () => {
    const r = await admin.get(o('/performance/settings'));
    expect(r.status).toBe(200);
    expect(r.body.rules).toMatchObject({ version: 1, weights: { goals: 30, delivery: 25, consistency: 20, quality: 15, attendance: 10 }, min_eligible_days: 10 });
    expect(r.body).toMatchObject({ leaderboard_workers: false, leaderboard_managers: true, workers_see_own_score: false });
  });

  it('managers and workers can read how scores are made, but only an admin can change it', async () => {
    expect((await manager.get(o('/performance/settings'))).status).toBe(200);
    expect((await worker.get(o('/performance/settings'))).status).toBe(200);
    expect((await manager.put(o('/performance/settings'), { leaderboard_workers: true })).status).toBe(403);
    expect((await worker.put(o('/performance/settings'), { weights: { goals: 100, delivery: 0, consistency: 0, quality: 0, attendance: 0 } })).status).toBe(403);
    expect((await admin.get(o('/performance/settings'))).body.leaderboard_workers).toBe(false);
  });

  it('rejects weights that do not add up to 100%, unknown metrics and fractions', async () => {
    const bad = [
      { goals: 30, delivery: 25, consistency: 20, quality: 15, attendance: 5 },
      { goals: 30, delivery: 25, consistency: 20, quality: 15, attendance: 10, activity: 0 },
      { goals: 30.5, delivery: 24.5, consistency: 20, quality: 15, attendance: 10 },
    ];
    for (const weights of bad) {
      const r = await admin.put(o('/performance/settings'), { weights });
      expect(r.status, JSON.stringify(weights)).toBe(400);
    }
    expect((await admin.get(o('/performance/settings'))).body.rules.version).toBe(1);
  });

  it('new weights become a new rules version, kept beside the old one, and are audited', async () => {
    const r = await admin.put(o('/performance/settings'), { weights: { goals: 40, delivery: 20, consistency: 20, quality: 10, attendance: 10 }, leaderboard_workers: true });
    expect(r.status).toBe(200);
    expect(r.body.rules).toMatchObject({ version: 2, weights: { goals: 40 } });
    expect(r.body.leaderboard_workers).toBe(true);
    // Only visibility: no new version.
    const v = await admin.put(o('/performance/settings'), { leaderboard_workers: false });
    expect(v.body.rules.version).toBe(2);
    const versions = await withTenant(t.h.db, orgId, (tx) => tx.select().from(performanceRules).orderBy(performanceRules.version));
    expect(versions.map((x) => [x.version, x.weights.goals])).toEqual([[1, 30], [2, 40]]);
    const logged = await withTenant(t.h.db, orgId, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, 'performance.settings_updated')));
    expect(logged).toHaveLength(2);
    expect((await events('performance.rules.changed')).length).toBe(1);
  });

  it('each organization has its own rules', async () => {
    const r = await other.get(`/orgs/${otherOrg}/performance/settings`);
    expect(r.body.rules).toMatchObject({ version: 1, weights: { goals: 30 } });
    expect((await other.get(o('/performance/settings'))).status).toBe(404);
  });
});

describe('project milestones', () => {
  let milestone: string;

  it('a project manager creates them; people assigned to the project can read them', async () => {
    const r = await admin.post(o(`/projects/${project}/milestones`), { title: 'Audit report', due_date: '2026-11-14' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: 'Audit report', due_date: '2026-11-14', completed_at: null, on_time: null, client_visible: true });
    milestone = r.body.id;
    const list = await worker.get(o(`/projects/${project}/milestones`));
    expect(list.status).toBe(200);
    expect(list.body.map((m: { id: string }) => m.id)).toEqual([milestone]);
  });

  it('validates the input', async () => {
    expect((await admin.post(o(`/projects/${project}/milestones`), { title: '', due_date: '2026-11-14' })).status).toBe(400);
    expect((await admin.post(o(`/projects/${project}/milestones`), { title: 'No date' })).status).toBe(400);
    expect((await admin.post(o(`/projects/${project}/milestones`), { title: 'Bad date', due_date: '14/11/2026' })).status).toBe(400);
  });

  it('a worker cannot create or change them; someone not on the project cannot see them', async () => {
    expect((await worker.post(o(`/projects/${project}/milestones`), { title: 'Mine', due_date: '2026-11-20' })).status).toBe(403);
    expect((await worker.patch(o(`/milestones/${milestone}`), { completed: true })).status).toBe(403);
    expect((await outsider.get(o(`/projects/${project}/milestones`))).status).toBe(404);
    expect((await outsider.patch(o(`/milestones/${milestone}`), { title: 'x' })).status).toBe(404);
  });

  it('completing one records when and by whom, says whether it was on time, and emits milestone.completed once', async () => {
    at('2026-11-13T15:00:00Z');
    const r = await admin.patch(o(`/milestones/${milestone}`), { completed: true });
    expect(r.status).toBe(200);
    expect(r.body.on_time).toBe(true);
    expect(r.body.completed_at).toBe('2026-11-13T15:00:00.000Z');
    expect((await admin.patch(o(`/milestones/${milestone}`), { completed: true })).body.completed_at).toBe('2026-11-13T15:00:00.000Z');
    const evts = await events('milestone.completed');
    expect(evts).toHaveLength(1);
    expect(evts[0]!.envelope).toMatchObject({ payload: { milestone_id: milestone, project_id: project, on_time: true } });
    // A delivered milestone keeps its due date (on time or late is part of its record).
    expect((await admin.patch(o(`/milestones/${milestone}`), { due_date: '2026-11-20' })).status).toBe(422);
    at('2026-11-02T14:00:00Z');
  });

  it('a late milestone is not on time', async () => {
    const late = (await admin.post(o(`/projects/${project}/milestones`), { title: 'Beta', due_date: '2026-11-02' })).body.id;
    at('2026-11-04T15:00:00Z');
    expect((await admin.patch(o(`/milestones/${late}`), { completed: true })).body.on_time).toBe(false);
    expect((await admin.del(o(`/milestones/${late}`))).status).toBe(204);
    expect((await admin.get(o(`/projects/${project}/milestones`))).body.map((m: { title: string }) => m.title)).toEqual(['Audit report']);
    at('2026-11-02T14:00:00Z');
  });

  it('another organization cannot read or change them', async () => {
    expect((await other.get(`/orgs/${otherOrg}/projects/${project}/milestones`)).status).toBe(404);
    expect((await other.patch(`/orgs/${otherOrg}/milestones/${milestone}`, { title: 'hijack' })).status).toBe(404);
    expect((await other.get(o(`/projects/${project}/milestones`))).status).toBe(404);
  });
});

describe('task.completed', () => {
  it('is emitted once when a task moves to done, with its assignees and due date', async () => {
    const task = (await admin.post(o(`/projects/${project}/tasks`), { title: 'Keyword list', due_date: '2026-11-03', assignee_ids: [workerId] })).body.id;
    const before = (await events('task.completed')).length;
    expect((await worker.patch(o(`/tasks/${task}`), { project_id: project, status: 'DONE' })).status).toBe(200);
    expect((await worker.patch(o(`/tasks/${task}`), { project_id: project, status: 'DONE' })).status).toBe(200);
    const evts = await events('task.completed');
    expect(evts.length).toBe(before + 1);
    expect(evts.at(-1)!.envelope).toMatchObject({ payload: { task_id: task, project_id: project, assignee_ids: [workerId], due_date: '2026-11-03' } });
    // Reopened and done again: a new completion.
    await worker.patch(o(`/tasks/${task}`), { project_id: project, status: 'IN_PROGRESS' });
    await worker.patch(o(`/tasks/${task}`), { project_id: project, status: 'DONE' });
    expect((await events('task.completed')).length).toBe(before + 2);
  });
});

describe('member scores', () => {
  beforeAll(async () => {
    // Tasks: one done on time, one done late, one not due yet (it must not count against anyone).
    const mk = async (title: string, due: string) => (await admin.post(o(`/projects/${project}/tasks`), { title, due_date: due, assignee_ids: [workerId] })).body.id as string;
    const onTime = await mk('On time', '2026-11-09');
    const late = await mk('Late', '2026-11-11');
    await mk('Later', '2026-11-30');
    at('2026-11-09T15:00:00Z');
    await worker.patch(o(`/tasks/${onTime}`), { project_id: project, status: 'DONE' });
    at('2026-11-12T15:00:00Z');
    await worker.patch(o(`/tasks/${late}`), { project_id: project, status: 'DONE' });
    await withTenant(t.h.db, orgId, async (tx) => {
      const g = { organizationId: orgId, subjectType: 'MEMBER' as const, membershipId: workerId, metric: 'TASKS_COMPLETED' as const, targetValue: 5, startDate: '2026-11-01' };
      await tx.insert(performanceGoals).values([
        { ...g, id: newId(), title: 'Reached', endDate: '2026-11-10', currentValue: 5, status: 'COMPLETED' },
        // still running: not counted yet
        { ...g, id: newId(), title: 'Running', endDate: '2026-11-25', currentValue: 1 },
      ]);
      const r = { organizationId: orgId, membershipId: workerId, reviewerMembershipId: managerId, periodStart: '2026-10-01', periodEnd: '2026-11-30' };
      await tx.insert(performanceReviews).values([
        { ...r, id: newId(), qualityRating: 5, status: 'FINAL' },
        // a draft does not count
        { ...r, id: newId(), qualityRating: 1, status: 'DRAFT' },
      ]);
    });
  });

  it('come from goals, delivery and reviews; unmeasured attendance and consistency stay null and are re-weighted', async () => {
    const r = await admin.get(o(`/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`));
    expect(r.status).toBe(200);
    expect(r.body.inputs).toEqual({
      goals: { completed: 1, due: 1 },
      delivery: { on_time: 2, due: 3 },
      consistency: { approved_days: 0, scheduled_days: 0 },
      quality: { reviews: 1, average_rating: 5 },
      attendance: { on_time: 0, scheduled: 0 },
    });
    expect(r.body.parts.attendance).toEqual({ value: null, weight: 10, effective_weight: 0 });
    expect(r.body.parts.consistency.value).toBeNull();
    expect(r.body.parts.delivery.value).toBe(66.7);
    // Rules v2: goals 40, delivery 20, quality 10 measured (coverage 70).
    expect(r.body).toMatchObject({ rule_version: 2, coverage: 70 });
    expect(r.body.score).toBe(Math.round(((100 * 40 + 66.7 * 20 + 100 * 10) / 70) * 10) / 10);
    // Fewer than 10 approved days: not ranked.
    expect(r.body).toMatchObject({ approved_days: 0, eligible: false });
  });

  it('are made of the five outcome metrics only: no activity, screenshots or money', async () => {
    const r = await admin.get(o(`/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`));
    expect(Object.keys(r.body.parts).sort()).toEqual(['attendance', 'consistency', 'delivery', 'goals', 'quality']);
    expect(JSON.stringify(r.body)).not.toMatch(/activity|screenshot|keystroke|rate|pay|amount/i);
  });

  it('a manager sees members of the teams they manage, and no one else', async () => {
    expect((await manager.get(o(`/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(200);
    expect((await manager.get(o(`/performance/members/${outsiderId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(404);
  });

  it('a worker sees only their own, and only when the organization shares scores with workers', async () => {
    expect((await worker.get(o(`/performance/members/${outsiderId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(404);
    expect((await outsider.get(o(`/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(404);
    // Not shared by default (workers_see_own_score is off).
    expect((await outsider.get(o(`/performance/members/${outsiderId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(403);
    expect((await admin.put(o('/performance/settings'), { workers_see_own_score: true })).status).toBe(200);
    expect((await outsider.get(o(`/performance/members/${outsiderId}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(200);
    expect((await admin.put(o('/performance/settings'), { workers_see_own_score: false })).status).toBe(200);
  });

  it('another organization cannot read them, and an unknown member is not found', async () => {
    expect((await other.get(`/orgs/${otherOrg}/performance/members/${workerId}/score?from=2026-11-01&to=2026-11-30`)).status).toBe(404);
    expect((await admin.get(o(`/performance/members/${newId()}/score?from=2026-11-01&to=2026-11-30`))).status).toBe(404);
  });

  it('rejects an invalid range', async () => {
    expect((await admin.get(o(`/performance/members/${workerId}/score?from=2026-11-30&to=2026-11-01`))).status).toBe(400);
    expect((await admin.get(o(`/performance/members/${workerId}/score?from=2025-01-01&to=2026-11-30`))).status).toBe(400);
    expect((await admin.get(o(`/performance/members/${workerId}/score`))).status).toBe(400);
  });
});

describe('score snapshots', () => {
  const snap = (now: string) =>
    withTenant(t.h.db, orgId, async (tx) => snapshotMemberScore(tx, await loadOrg(tx, orgId), new Date(now), { membershipId: workerId, periodType: 'MONTH', periodStart: '2026-11-01', periodEnd: '2026-11-30', rankGroup: 'product designer' }));

  it('a running period is recalculated; once it has settled it is final and never changes, even with new rules', async () => {
    const running = await snap('2026-11-12T15:00:00Z');
    expect(running).toMatchObject({ final: false, ruleVersion: 2, eligible: false, rankGroup: 'product designer' });
    const history = await manager.get(o(`/performance/members/${workerId}/history?period=MONTH`));
    expect(history.status).toBe(200);
    expect(history.body).toEqual([expect.objectContaining({ period_start: '2026-11-01', score: running.score, final: false, rule_version: 2 })]);

    // December 1 in New York: November is over. The still-open "Later" task and the "Running" goal now
    // count, but the month stays open for late approvals and reviews (SCORE_SETTLE_DAYS).
    const ended = await snap('2026-12-01T15:00:00Z');
    expect(ended).toMatchObject({ id: running.id, final: false });
    expect(ended.metrics).toMatchObject({ inputs: { delivery: { on_time: 2, due: 4 }, goals: { completed: 1, due: 2 } } });

    // December 15: 14 days after November 30, the month is final.
    const closed = await snap('2026-12-15T15:00:00Z');
    expect(closed.final).toBe(true);
    expect(closed.id).toBe(running.id);
    expect(closed.metrics).toMatchObject({ inputs: { delivery: { on_time: 2, due: 4 }, goals: { completed: 1, due: 2 } } });

    // New rules after the period closed: November keeps the score it was given, and its rule version.
    await withTenant(t.h.db, orgId, (tx) => tx.insert(performanceRules).values({ id: newId(), organizationId: orgId, version: 3, weights: { goals: 10, delivery: 10, consistency: 10, quality: 60, attendance: 10 }, minEligibleDays: 1 }));
    const again = await snap('2026-12-16T15:00:00Z');
    expect(again).toMatchObject({ id: closed.id, score: closed.score, ruleVersion: 2, final: true });
    expect(again.calculatedAt.toISOString()).toBe(closed.calculatedAt.toISOString());
    const rows = await withTenant(t.h.db, orgId, (tx) => tx.select().from(performanceScoreSnapshots));
    expect(rows).toHaveLength(1);
  });

  it('history follows the same visibility rules', async () => {
    expect((await outsider.get(o(`/performance/members/${workerId}/history`))).status).toBe(404);
    expect((await other.get(`/orgs/${otherOrg}/performance/members/${workerId}/history`)).status).toBe(404);
  });
});
