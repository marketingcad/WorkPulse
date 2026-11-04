import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { achievementAwards, auditLogs, notifications, outboxEvents, withSystem, withTenant } from '@tallywork/db';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';
import { handlePerformanceEvent, performanceDaily } from '../src/services/performance-jobs';
import { sharedReviewsFor } from '../src/services/reviews';

/**
 * Performance Center, phases 2–6: achievements (catalog, manager awards, automatic unlocks, duplicate
 * prevention), goals measured from real work, confidential reviews, leaderboards and their visibility,
 * team performance, the overview, client insights and appreciation, and the desktop's own data.
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
let team: string;
let project: string;
let clientId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const at = (iso: string) => t.clock.set(new Date(iso));
const PASSWORD = 'correct-horse-battery';

async function device(member: Client, name: string): Promise<Client> {
  const { verifier, challenge } = pkce();
  const code = await member.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const c = new Client(t);
  c.bearer = (await c.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name, platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
  return c;
}
const done = async (task: string) => {
  expect((await worker.patch(o(`/tasks/${task}`), { project_id: project, status: 'DONE' })).status).toBe(200);
  await t.flush();
};
const newTask = async (title: string, due = '2026-11-20') => (await admin.post(o(`/projects/${project}/tasks`), { title, due_date: due, assignee_ids: [workerId] })).body.id as string;
const awardsOf = (m: string) => withTenant(t.h.db, orgId, (tx) => tx.select().from(achievementAwards).where(eq(achievementAwards.membershipId, m)));

beforeAll(async () => {
  t = await createHarness();
  at('2026-11-02T14:00:00Z');
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@pc.test'));
  ({ client: manager, membershipId: managerId } = await addMember(t, admin, orgId, 'Maya', 'maya@pc.test', 'TEAM_MANAGER'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Zara', 'zara@pc.test'));
  ({ client: outsider, membershipId: outsiderId } = await addMember(t, admin, orgId, 'Omar', 'omar@pc.test'));
  team = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  await admin.put(o(`/teams/${team}/members/${managerId}`), { role: 'MANAGER' });
  await admin.put(o(`/teams/${team}/members/${workerId}`), { role: 'MEMBER' });
  clientId = (await admin.post(o('/clients'), { name: 'Wonka' })).body.id;
  project = (await admin.post(o('/projects'), { name: 'Wonka SEO', client_id: clientId, member_ids: [managerId, workerId], team_ids: [team] })).body.id;
  ({ client: other, orgId: otherOrg } = await signup(t, 'Bea', 'bea@pc-other.test', 'Other'));
}, 90_000);
afterAll(() => t.close());

describe('achievement catalog', () => {
  it('every organization starts with the built-in achievements', async () => {
    const r = await admin.get(o('/performance/achievements'));
    expect(r.status).toBe(200);
    const keys = r.body.map((d: { key: string }) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['productivity_champion', 'perfect_attendance', 'project_finisher', 'consistency_star', 'team_player', 'first_100_hours', 'monthly_top_performer', 'outstanding_contributor', 'quality_craft', 'client_hero']));
    const tp = r.body.find((d: { key: string }) => d.key === 'team_player');
    expect(tp).toMatchObject({ mode: 'MANUAL', awardable: true, custom: false });
    expect(r.body.find((d: { key: string }) => d.key === 'client_hero').awardable).toBe(false);
    expect((await worker.get(o('/performance/achievements'))).status).toBe(200);
  });

  it('only an admin creates custom achievements, and automatic ones need a measure and increasing levels', async () => {
    const def = { name: 'Fast Finisher', description: 'Tasks done this quarter', category: 'PRODUCTIVITY', icon: 'zap', mode: 'AUTOMATIC', metric: 'TASKS_COMPLETED', thresholds: [1, 2], recurrence: 'QUARTER' };
    expect((await manager.post(o('/performance/achievements'), def)).status).toBe(403);
    expect((await admin.post(o('/performance/achievements'), { ...def, thresholds: [2, 2] })).status).toBe(400);
    expect((await admin.post(o('/performance/achievements'), { ...def, metric: undefined })).status).toBe(400);
    expect((await admin.post(o('/performance/achievements'), { ...def, icon: 'not-an-icon' })).status).toBe(400);
    const r = await admin.post(o('/performance/achievements'), def);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ custom: true, mode: 'AUTOMATIC', thresholds: [1, 2] });
    const ms = await admin.post(o('/performance/achievements'), { name: 'On Schedule', description: 'A milestone on time', category: 'PROJECT_COMPLETION', icon: 'flag', mode: 'AUTOMATIC', metric: 'MILESTONES_ON_TIME', thresholds: [1], recurrence: 'ONCE' });
    expect(ms.status).toBe(201);
    // Built-ins cannot be archived; custom ones can.
    const builtin = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'team_player');
    expect((await admin.post(o(`/performance/achievements/${builtin.id}/archive`))).status).toBe(422);
  });
});

describe('recognition by a manager', () => {
  let teamPlayer: string;
  beforeAll(async () => {
    teamPlayer = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'team_player').id;
  });

  it('a manager recognizes someone in their team, with a reason; it is audited and the person is told', async () => {
    const r = await manager.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: workerId, reason: 'Unblocked the beta build' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ source: 'MANAGER', awarded_by: 'Maya', reason: 'Unblocked the beta build', recipient: { type: 'MEMBER', id: workerId }, period_key: '2026-11' });
    const logged = await withTenant(t.h.db, orgId, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, 'achievement.awarded')));
    expect(logged).toHaveLength(1);
    const told = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'recognition.awarded'))));
    expect(told).toHaveLength(1);
  });

  it('is given once per eligibility period (a second time this month is refused)', async () => {
    const r = await admin.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: workerId, reason: 'Again' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('already_awarded');
  });

  it('a manager cannot recognize someone outside their teams, themselves, or with an automatic achievement', async () => {
    expect((await manager.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: outsiderId, reason: 'x' })).status).toBe(404);
    expect((await manager.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: managerId, reason: 'x' })).status).toBe(403);
    const auto = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'first_100_hours').id;
    expect((await admin.post(o('/performance/awards'), { definition_id: auto, membership_id: outsiderId, reason: 'x' })).status).toBe(422);
    expect((await worker.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: outsiderId, reason: 'x' })).status).toBe(403);
    expect((await admin.post(o('/performance/awards'), { definition_id: teamPlayer, reason: 'no one' })).status).toBe(400);
    expect((await admin.post(o('/performance/awards'), { definition_id: teamPlayer, membership_id: outsiderId, reason: '' })).status).toBe(400);
  });

  it('a private award is seen by the person and whoever may award them, not by others', async () => {
    const oc = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'outstanding_contributor').id;
    const r = await admin.post(o('/performance/awards'), { definition_id: oc, membership_id: outsiderId, reason: 'Quietly great', visibility: 'PRIVATE' });
    expect(r.status).toBe(201);
    const ids = (c: Client) => c.get(o('/performance/awards')).then((x) => x.body.map((a: { id: string }) => a.id));
    expect(await ids(outsider)).toContain(r.body.id);
    expect(await ids(admin)).toContain(r.body.id);
    expect(await ids(worker)).not.toContain(r.body.id);
    expect(await ids(manager)).not.toContain(r.body.id);
  });

  it('a team can be recognized by its manager', async () => {
    const oc = (await admin.get(o('/performance/achievements'))).body.find((d: { key: string }) => d.key === 'outstanding_contributor').id;
    const r = await manager.post(o('/performance/awards'), { definition_id: oc, team_id: team, reason: 'Shipped early' });
    expect(r.status).toBe(201);
    expect(r.body.recipient).toMatchObject({ type: 'TEAM', id: team, name: 'Design' });
  });

  it('an award given by mistake is revoked with a reason, kept, and no longer listed', async () => {
    const list = (await admin.get(o(`/performance/awards?membership_id=${workerId}`))).body;
    const id = list.find((a: { source: string }) => a.source === 'MANAGER').id;
    expect((await worker.post(o(`/performance/awards/${id}/revoke`), { reason: 'x' })).status).toBe(403);
    expect((await admin.post(o(`/performance/awards/${id}/revoke`), { reason: 'Wrong person' })).status).toBe(204);
    expect((await admin.get(o(`/performance/awards?membership_id=${workerId}`))).body.map((a: { id: string }) => a.id)).not.toContain(id);
    const [row] = await withTenant(t.h.db, orgId, (tx) => tx.select().from(achievementAwards).where(eq(achievementAwards.id, id)));
    expect(row).toMatchObject({ revokeReason: 'Wrong person' });
  });

  it('another organization cannot award or read them', async () => {
    expect((await other.get(`/orgs/${otherOrg}/performance/awards?membership_id=${workerId}`)).status).toBe(404);
    const theirs = (await other.get(`/orgs/${otherOrg}/performance/achievements`)).body.find((d: { key: string }) => d.key === 'team_player').id;
    expect((await other.post(`/orgs/${otherOrg}/performance/awards`, { definition_id: theirs, membership_id: workerId, reason: 'x' })).status).toBe(404);
    expect((await other.post(`/orgs/${otherOrg}/performance/awards`, { definition_id: teamPlayer, membership_id: workerId, reason: 'x' })).status).toBe(404);
  });
});

describe('automatic achievements', () => {
  it('unlock each level as tasks are completed, once, and tell the person', async () => {
    await done(await newTask('First'));
    let mine = (await awardsOf(workerId)).filter((a) => a.source === 'AUTOMATIC');
    expect(mine.map((a) => a.tier)).toEqual(['BRONZE']);
    await done(await newTask('Second'));
    mine = (await awardsOf(workerId)).filter((a) => a.source === 'AUTOMATIC');
    expect(mine.map((a) => a.tier).sort()).toEqual(['BRONZE', 'SILVER']);
    const told = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'achievement.unlocked'))));
    expect(told.map((n) => n.title).sort()).toEqual(['You earned Fast Finisher · Bronze', 'You earned Fast Finisher · Silver']);
  });

  it('the same event delivered again changes nothing (idempotent)', async () => {
    const [evt] = await withSystem(t.h.db, (tx) => tx.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId, orgId), eq(outboxEvents.eventType, 'task.completed'))));
    const before = (await awardsOf(workerId)).length;
    await withTenant(t.h.db, orgId, (tx) => handlePerformanceEvent(tx, t.deps, evt!.envelope as never));
    await withTenant(t.h.db, orgId, (tx) => handlePerformanceEvent(tx, t.deps, evt!.envelope as never));
    expect((await awardsOf(workerId)).length).toBe(before);
  });

  it('a milestone delivered on time unlocks for the project’s members', async () => {
    const m = (await admin.post(o(`/projects/${project}/milestones`), { title: 'Beta', due_date: '2026-11-14' })).body.id;
    await admin.patch(o(`/milestones/${m}`), { completed: true });
    await t.flush();
    const names = async (id: string) => {
      const list = (await admin.get(o(`/performance/awards?membership_id=${id}`))).body;
      return list.map((a: { name: string }) => a.name);
    };
    expect(await names(workerId)).toContain('On Schedule');
    expect(await names(managerId)).toContain('On Schedule');
    expect(await names(outsiderId)).not.toContain('On Schedule');
  });
});

describe('goals', () => {
  let goal: string;

  it('a manager sets a goal for someone in their team; progress comes from their completed tasks', async () => {
    const r = await manager.post(o('/performance/goals'), { title: 'Ship 4 tasks', subject_type: 'MEMBER', subject_id: workerId, metric: 'TASKS_COMPLETED', target: 4, start_date: '2026-11-01', end_date: '2026-11-30' });
    expect(r.status).toBe(201);
    // the two tasks finished above already count
    expect(r.body).toMatchObject({ subject_name: 'Zara', current: 2, target: 4, status: 'ACTIVE', progress_pct: 50, can_manage: true });
    goal = r.body.id;
    const told = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'goal.created'))));
    expect(told).toHaveLength(1);
  });

  it('validates the goal: a measure that does not fit the subject, dates and targets', async () => {
    const base = { title: 'x', subject_type: 'MEMBER', subject_id: workerId, metric: 'TASKS_COMPLETED', target: 4, start_date: '2026-11-01', end_date: '2026-11-30' };
    expect((await admin.post(o('/performance/goals'), { ...base, metric: 'MILESTONES_COMPLETED' })).status).toBe(400);
    expect((await admin.post(o('/performance/goals'), { ...base, end_date: '2026-10-01' })).status).toBe(400);
    expect((await admin.post(o('/performance/goals'), { ...base, target: 0 })).status).toBe(400);
    expect((await admin.post(o('/performance/goals'), { ...base, metric: 'ON_TIME_PCT', target: 120 })).status).toBe(400);
    expect((await admin.post(o('/performance/goals'), { ...base, subject_type: 'ORG' })).status).toBe(400);
  });

  it('who may set and see goals', async () => {
    const base = { title: 'x', metric: 'TASKS_COMPLETED', target: 4, start_date: '2026-11-01', end_date: '2026-11-30' };
    expect((await worker.post(o('/performance/goals'), { ...base, subject_type: 'MEMBER', subject_id: workerId })).status).toBe(403);
    expect((await manager.post(o('/performance/goals'), { ...base, subject_type: 'MEMBER', subject_id: outsiderId })).status).toBe(404);
    expect((await manager.post(o('/performance/goals'), { ...base, subject_type: 'ORG' })).status).toBe(403);
    expect((await manager.post(o('/performance/goals'), { ...base, subject_type: 'TEAM', subject_id: team })).status).toBe(201);
    expect((await worker.get(o(`/performance/goals/${goal}`))).status).toBe(200);
    expect((await outsider.get(o(`/performance/goals/${goal}`))).status).toBe(404);
    expect((await other.get(`/orgs/${otherOrg}/performance/goals/${goal}`)).status).toBe(404);
    expect((await outsider.get(o('/performance/goals'))).body.map((g: { id: string }) => g.id)).not.toContain(goal);
  });

  it('completes when the work is done, says so once, and keeps its history', async () => {
    await done(await newTask('Third'));
    await done(await newTask('Fourth'));
    const r = await worker.get(o(`/performance/goals/${goal}`));
    expect(r.body).toMatchObject({ status: 'COMPLETED', current: 4, progress_pct: 100 });
    expect(r.body.history.map((h: { value: number }) => h.value)).toEqual([4, 3, 2, 0]);
    const told = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'goal.completed'))));
    // Once for this goal (the Design team's goal, which Zara is part of, completed too).
    expect(told.filter((n) => (n.payload as { goal_id?: string }).goal_id === goal)).toHaveLength(1);
    expect(told).toHaveLength(2);
    // Done is done: more work does not change a completed goal.
    await done(await newTask('Fifth'));
    expect((await worker.get(o(`/performance/goals/${goal}`))).body.current).toBe(4);
  });

  it('a goal that runs out of time is missed, not deleted; it can be archived', async () => {
    const g = (await admin.post(o('/performance/goals'), { title: 'Approved hours', subject_type: 'MEMBER', subject_id: workerId, metric: 'APPROVED_HOURS', target: 10, start_date: '2026-11-01', end_date: '2026-11-03' })).body;
    expect(g.current).toBe(0);
    await withTenant(t.h.db, orgId, async (tx) => {
      at('2026-11-05T15:00:00Z');
      await performanceDaily(tx, t.deps, orgId);
    });
    expect((await admin.get(o(`/performance/goals/${g.id}`))).body.status).toBe('MISSED');
    expect((await admin.patch(o(`/performance/goals/${g.id}`), { archived: true })).body.status).toBe('ARCHIVED');
    expect((await admin.get(o('/performance/goals'))).body.map((x: { id: string }) => x.id)).not.toContain(g.id);
    at('2026-11-12T15:00:00Z');
  });
});

describe('reviews', () => {
  let review: string;
  it('a manager writes a review for someone in their team; reviewers see the private note', async () => {
    const r = await manager.post(o('/performance/reviews'), { membership_id: workerId, period_start: '2026-07-01', period_end: '2026-09-30', quality_rating: 4, strengths: ['Design systems'], improvements: ['Estimating'], private_note: 'Ready for a senior role', shared_with_member: true, status: 'FINAL' });
    expect(r.status).toBe(201);
    review = r.body.id;
    const list = await admin.get(o(`/performance/members/${workerId}/reviews`));
    expect(list.body[0]).toMatchObject({ quality_rating: 4, private_note: 'Ready for a senior role', reviewer: { name: 'Maya' } });
  });

  it('the private note never reaches the member, and the audit log does not keep its text', async () => {
    const mine = await withTenant(t.h.db, orgId, (tx) => sharedReviewsFor(tx, workerId));
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toHaveProperty('private_note');
    expect(JSON.stringify(mine)).not.toContain('senior role');
    const logs = await withTenant(t.h.db, orgId, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.targetId, review)));
    expect(JSON.stringify(logs)).not.toContain('senior role');
    expect(JSON.stringify(logs)).toContain('private_note_changed');
  });

  it('workers, people outside the team and other organizations cannot read or write reviews', async () => {
    expect((await worker.get(o(`/performance/members/${workerId}/reviews`))).status).toBe(403);
    expect((await outsider.get(o(`/performance/members/${workerId}/reviews`))).status).toBe(403);
    expect((await manager.get(o(`/performance/members/${outsiderId}/reviews`))).status).toBe(404);
    // and nobody reviews themselves
    expect((await manager.post(o('/performance/reviews'), { membership_id: managerId, period_start: '2026-07-01', period_end: '2026-09-30' })).status).toBe(403);
    expect((await other.get(`/orgs/${otherOrg}/performance/members/${workerId}/reviews`)).status).toBe(404);
    expect((await admin.post(o('/performance/reviews'), { membership_id: workerId, period_start: '2026-09-30', period_end: '2026-07-01' })).status).toBe(400);
    expect((await admin.post(o('/performance/reviews'), { membership_id: workerId, period_start: '2026-07-01', period_end: '2026-09-30', quality_rating: 6 })).status).toBe(400);
  });

  it('only the reviewer (or an admin) edits it', async () => {
    expect((await manager.patch(o(`/performance/reviews/${review}`), { summary: 'Strong quarter' })).status).toBe(200);
    expect((await admin.patch(o(`/performance/reviews/${review}`), { summary: 'Strong quarter.' })).status).toBe(200);
    expect((await worker.patch(o(`/performance/reviews/${review}`), { summary: 'mine now' })).status).toBe(403);
  });
});

describe('leaderboards and visibility', () => {
  it('admins see everyone ranked, compared within their role; no money, activity or screenshots', async () => {
    const r = await admin.get(o('/performance/leaderboard?type=workers&period=MONTH'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ type: 'workers', start: '2026-11-01', end: '2026-11-30', summary_only: false, compare: 'role' });
    const ids = r.body.rows.map((x: { id: string }) => x.id);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual(expect.arrayContaining([managerId, outsiderId, workerId]));
    expect(JSON.stringify(r.body)).not.toMatch(/screenshot|keystroke|activity_pct|amount|rate_minor|pay/i);
  });

  it('a team manager sees only the people they manage', async () => {
    const r = await manager.get(o('/performance/leaderboard?type=workers'));
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x: { id: string }) => x.id).sort()).toEqual([managerId, workerId].sort());
    const teams = await manager.get(o('/performance/leaderboard?type=teams'));
    expect(teams.body.rows.map((x: { name: string }) => x.name)).toEqual(['Design']);
  });

  it('workers do not see rankings unless the organization turns them on, and then only names and scores', async () => {
    expect((await worker.get(o('/performance/leaderboard'))).status).toBe(403);
    await admin.put(o('/performance/settings'), { leaderboard_workers: true });
    const r = await worker.get(o('/performance/leaderboard'));
    expect(r.status).toBe(200);
    expect(r.body.summary_only).toBe(true);
    for (const row of r.body.rows) expect(row).toMatchObject({ goals: null, delivery: null, trend: [] });
    await admin.put(o('/performance/settings'), { leaderboard_workers: false });
  });

  it('an admin can hide rankings from managers', async () => {
    await admin.put(o('/performance/settings'), { leaderboard_managers: false });
    expect((await manager.get(o('/performance/leaderboard'))).status).toBe(403);
    await admin.put(o('/performance/settings'), { leaderboard_managers: true });
  });

  it('another organization sees none of it', async () => {
    const r = await other.get(`/orgs/${otherOrg}/performance/leaderboard`);
    expect(r.body.rows.map((x: { id: string }) => x.id)).not.toContain(workerId);
  });
});

describe('team performance, overview and profiles', () => {
  it('team performance: a manager sees their teams; a worker cannot open it', async () => {
    const r = await manager.get(o('/performance/teams?period=MONTH'));
    expect(r.status).toBe(200);
    expect(r.body.teams.map((x: { name: string }) => x.name)).toEqual(['Design']);
    expect(r.body.teams[0].people.map((p: { id: string }) => p.id).sort()).toEqual([managerId, workerId].sort());
    expect(r.body.teams[0].history).toHaveLength(6);
    expect((await worker.get(o('/performance/teams'))).status).toBe(403);
  });

  it('the overview counts only what the actor may see', async () => {
    const r = await admin.get(o('/performance/overview?period=MONTH'));
    expect(r.status).toBe(200);
    // Zara's goal and the Design team's goal
    expect(r.body.kpis).toMatchObject({ active_teams: 1, goals_completed: 2 });
    expect(r.body.kpis.active_workers).toBeGreaterThanOrEqual(4);
    expect(r.body.kpis.achievements).toBeGreaterThan(0);
    const m = await manager.get(o('/performance/overview?period=MONTH'));
    expect(m.body.kpis.active_workers).toBe(2);
    expect((await worker.get(o('/performance/overview'))).status).toBe(403);
    expect((await manager.get(o(`/performance/overview?team_id=${team}`))).status).toBe(200);
  });

  it('a profile is for managers of the person and admins', async () => {
    const r = await manager.get(o(`/performance/members/${workerId}/profile?period=MONTH`));
    expect(r.status).toBe(200);
    expect(r.body.member).toMatchObject({ name: 'Zara', teams: [{ id: team, name: 'Design' }] });
    expect(r.body.kpis.tasks_done).toBeGreaterThanOrEqual(5);
    expect(r.body.achievements.length).toBeGreaterThan(0);
    expect((await manager.get(o(`/performance/members/${outsiderId}/profile`))).status).toBe(404);
    expect((await other.get(`/orgs/${otherOrg}/performance/members/${workerId}/profile`)).status).toBe(404);
    const list = await manager.get(o('/performance/members?period=MONTH'));
    expect(list.body.rows.map((x: { id: string }) => x.id).sort()).toEqual([managerId, workerId].sort());
  });

  it('a closed month names the top performer of each role, once', async () => {
    at('2026-12-02T15:00:00Z');
    await withTenant(t.h.db, orgId, (tx) => performanceDaily(tx, t.deps, orgId));
    await withTenant(t.h.db, orgId, (tx) => performanceDaily(tx, t.deps, orgId));
    const tops = await withTenant(t.h.db, orgId, (tx) => tx.select().from(achievementAwards).where(eq(achievementAwards.periodKey, '2026-11')));
    const top = tops.filter((a) => a.source === 'AUTOMATIC');
    // No one may be top twice for the same month.
    expect(new Set(top.map((a) => `${a.definitionId}:${a.recipientKey}`)).size).toBe(top.length);
    at('2026-11-12T15:00:00Z');
  });
});

describe('client insights and appreciation', () => {
  let viewer: Client;
  let accessId: string;
  beforeAll(async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true });
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'carla@wonka.test', name: 'Carla' });
    viewer = new Client(t);
    accessId = (await viewer.post('/portal/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token'), name: 'Carla', password: PASSWORD })).body.access_id;
  });

  it('shows the client’s project delivery: milestones, tasks and weekly progress, never money or people’s performance', async () => {
    const r = await viewer.get(`/portal/${accessId}/insights`);
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Wonka SEO']);
    expect(r.body.milestones.map((m: { title: string }) => m.title)).toContain('Beta');
    expect(r.body.totals.tasks_done).toBeGreaterThanOrEqual(5);
    expect(r.body.weeks).toHaveLength(8);
    expect(JSON.stringify(r.body)).not.toMatch(/amount|rate|pay|bill|currency|score|rank|review|screenshot|activity|private/i);
  });

  it('a hidden milestone stays hidden', async () => {
    const m = (await admin.post(o(`/projects/${project}/milestones`), { title: 'Internal QA', due_date: '2026-11-20', client_visible: false })).body.id;
    expect((await viewer.get(`/portal/${accessId}/insights`)).body.milestones.map((x: { title: string }) => x.title)).not.toContain('Internal QA');
    await admin.del(o(`/milestones/${m}`));
  });

  it('a client sends appreciation; nobody sees it until it is approved, then the person earns Client Hero', async () => {
    const r = await viewer.post(`/portal/${accessId}/appreciations`, { project_id: project, membership_id: workerId, message: 'The pages shipped early. Thank you!' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    expect((await admin.get(o(`/performance/awards?membership_id=${workerId}`))).body.map((a: { name: string }) => a.name)).not.toContain('Client Hero');
    const pending = await admin.get(o('/performance/appreciations?status=PENDING'));
    expect(pending.body[0]).toMatchObject({ client: { name: 'Wonka' }, member: { name: 'Zara' }, message: 'The pages shipped early. Thank you!' });
    expect((await worker.get(o('/performance/appreciations'))).status).toBe(403);
    expect((await admin.post(o(`/performance/appreciations/${r.body.id}/approve`))).status).toBe(204);
    expect((await admin.post(o(`/performance/appreciations/${r.body.id}/approve`))).status).toBe(422);
    const awards = (await admin.get(o(`/performance/awards?membership_id=${workerId}`))).body;
    expect(awards.find((a: { name: string }) => a.name === 'Client Hero')).toMatchObject({ source: 'CLIENT', reason: 'The pages shipped early. Thank you!' });
  });

  it('a client can only thank people on their own projects', async () => {
    expect((await viewer.post(`/portal/${accessId}/appreciations`, { project_id: project, membership_id: outsiderId, message: 'x' })).status).toBe(404);
    const otherProject = (await admin.post(o('/projects'), { name: 'Not Wonka' })).body.id;
    expect((await viewer.post(`/portal/${accessId}/appreciations`, { project_id: otherProject, message: 'x' })).status).toBe(404);
    expect((await viewer.post(`/portal/${accessId}/appreciations`, { project_id: project, message: '' })).status).toBe(400);
    // a member of the organization is not a portal viewer
    expect((await admin.get(`/portal/${accessId}/insights`)).status).toBe(404);
  });
});

describe('desktop: my performance', () => {
  it('the worker’s device returns only their own goals, badges and recognition, and no score unless shared', async () => {
    const agent = await device(worker, 'Zara-PC');
    const r = await agent.get('/agent/me/performance');
    expect(r.status).toBe(200);
    expect(r.body.badges.every((b: { recipient: { id: string } }) => b.recipient.id === workerId)).toBe(true);
    expect(r.body.badges.map((b: { name: string }) => b.name)).toEqual(expect.arrayContaining(['Fast Finisher', 'Client Hero']));
    expect(r.body.recognition.every((b: { source: string }) => b.source !== 'AUTOMATIC')).toBe(true);
    expect(r.body.goals.some((g: { title: string }) => g.title === 'Ship 4 tasks')).toBe(true);
    expect(r.body.score).toBeNull();
    expect(r.body.reviews).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toContain('senior role');
    expect(JSON.stringify(r.body)).not.toContain('Omar');
    await admin.put(o('/performance/settings'), { workers_see_own_score: true });
    const withScore = await agent.get('/agent/me/performance');
    expect(withScore.body.score).toMatchObject({ membership_id: workerId });
  });
});
