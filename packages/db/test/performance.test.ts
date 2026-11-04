import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import {
  achievementAwards,
  achievementDefinitions,
  memberships,
  organizations,
  performanceGoalProgress,
  performanceGoals,
  performanceRules,
  performanceReviews,
  performanceScoreSnapshots,
  projectMilestones,
  projects,
  roles,
  users,
  withSystem,
  withTenant,
} from '../src/index';

/** Performance Center tables: tenant isolation, same-tenant references and the integrity rules. */
let h: DbHandle;
const settings = { lateGraceMinutes: 5, durationFormat: 'hm' as const, budgetWarnPct: 80, requireDeviceApproval: false, enforceMfa: 'none' as const, sessionTtlHours: 336 };
const A = { org: newId(), role: newId(), user: newId(), member: newId(), project: newId(), rule: newId(), def: newId() };
const B = { org: newId(), role: newId(), user: newId(), member: newId(), project: newId() };

beforeAll(async () => {
  h = createDb('pglite://memory');
  await h.migrate();
  await withSystem(h.db, async (tx) => {
    await tx.insert(organizations).values([
      { id: A.org, slug: 'perf-a', name: 'A', settings },
      { id: B.org, slug: 'perf-b', name: 'B', settings },
    ]);
    await tx.insert(users).values([
      { id: A.user, email: 'a@perf.test', name: 'A', passwordHash: 'x' },
      { id: B.user, email: 'b@perf.test', name: 'B', passwordHash: 'x' },
    ]);
    for (const o of [A, B]) {
      await tx.insert(roles).values({ id: o.role, organizationId: o.org, key: 'WORKER', name: 'Worker' });
      await tx.insert(memberships).values({ id: o.member, organizationId: o.org, userId: o.user, roleId: o.role, status: 'ACTIVE' });
      await tx.insert(projects).values({ id: o.project, organizationId: o.org, name: 'P' });
    }
  });
  await withTenant(h.db, A.org, async (tx) => {
    await tx.insert(performanceRules).values({ id: A.rule, organizationId: A.org, version: 1, weights: { goals: 30, delivery: 25, consistency: 20, quality: 15, attendance: 10 }, minEligibleDays: 10 });
    await tx.insert(achievementDefinitions).values({ id: A.def, organizationId: A.org, key: 'team_player', name: 'Team Player', description: 'd', category: 'TEAMWORK', icon: 'heart', mode: 'MANUAL', recurrence: 'MONTH' });
    await tx.insert(projectMilestones).values({ id: newId(), organizationId: A.org, projectId: A.project, title: 'Beta', dueDate: '2026-11-14' });
  });
}, 60_000);
afterAll(() => h.close());

describe('performance tables', () => {
  it('only show the current tenant rows', async () => {
    expect(await withTenant(h.db, B.org, (tx) => tx.select().from(projectMilestones))).toEqual([]);
    expect(await withTenant(h.db, B.org, (tx) => tx.select().from(performanceRules))).toEqual([]);
    expect(await withTenant(h.db, A.org, (tx) => tx.select().from(projectMilestones))).toHaveLength(1);
  });

  it('cannot reference another tenant’s project, member or rule (composite foreign keys)', async () => {
    // Inside B's tenant, pointing at A's project: the (organization_id, project_id) pair does not exist.
    await expect(withTenant(h.db, B.org, (tx) => tx.insert(projectMilestones).values({ id: newId(), organizationId: B.org, projectId: A.project, title: 'x', dueDate: '2026-11-01' }))).rejects.toThrow();
    // Even bypassing RLS, the pair must match.
    await expect(withSystem(h.db, (tx) => tx.insert(performanceGoals).values({ id: newId(), organizationId: B.org, title: 'g', subjectType: 'MEMBER', membershipId: A.member, metric: 'TASKS_COMPLETED', targetValue: 5, startDate: '2026-11-01', endDate: '2026-11-30' }))).rejects.toThrow();
    await expect(withSystem(h.db, (tx) => tx.insert(performanceScoreSnapshots).values({ id: newId(), organizationId: B.org, subjectType: 'MEMBER', subjectId: B.member, periodType: 'MONTH', periodStart: '2026-11-01', periodEnd: '2026-11-30', ruleId: A.rule, ruleVersion: 1, score: 80, coverage: 100, metrics: {}, eligible: true }))).rejects.toThrow();
  });

  it('a goal names exactly the subject its type says', async () => {
    const base = { organizationId: A.org, title: 'g', metric: 'TASKS_COMPLETED' as const, targetValue: 5, startDate: '2026-11-01', endDate: '2026-11-30' };
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceGoals).values({ ...base, id: newId(), subjectType: 'MEMBER' }))).rejects.toThrow();
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceGoals).values({ ...base, id: newId(), subjectType: 'ORG', membershipId: A.member }))).rejects.toThrow();
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceGoals).values({ ...base, id: newId(), subjectType: 'MEMBER', membershipId: A.member, targetValue: 0 }))).rejects.toThrow();
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceGoals).values({ ...base, id: newId(), subjectType: 'MEMBER', membershipId: A.member, endDate: '2026-10-01' }))).rejects.toThrow();
    const ok = newId();
    await withTenant(h.db, A.org, (tx) => tx.insert(performanceGoals).values({ ...base, id: ok, subjectType: 'MEMBER', membershipId: A.member }));
    // Progress is recorded once per source event.
    const p = { organizationId: A.org, goalId: ok, value: 1, source: 'task', sourceKey: 'evt-1' };
    await withTenant(h.db, A.org, (tx) => tx.insert(performanceGoalProgress).values({ ...p, id: newId() }));
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceGoalProgress).values({ ...p, id: newId(), value: 2 }))).rejects.toThrow();
  });

  it('an achievement is awarded once per recipient, level and period', async () => {
    const award = { organizationId: A.org, definitionId: A.def, membershipId: A.member, recipientKey: `m:${A.member}`, periodKey: '2026-11', source: 'MANAGER' as const };
    await withTenant(h.db, A.org, (tx) => tx.insert(achievementAwards).values({ ...award, id: newId() }));
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(achievementAwards).values({ ...award, id: newId() }))).rejects.toThrow();
    // another period is a new award
    await withTenant(h.db, A.org, (tx) => tx.insert(achievementAwards).values({ ...award, id: newId(), periodKey: '2026-12' }));
    // a recipient is a member or a team, not both and not neither
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(achievementAwards).values({ ...award, id: newId(), membershipId: null, periodKey: '2027-01' }))).rejects.toThrow();
  });

  it('an automatic achievement needs a measure and levels; a manual one has no measure', async () => {
    const d = { organizationId: A.org, name: 'x', description: 'x', category: 'PRODUCTIVITY' as const, icon: 'award', recurrence: 'ONCE' as const };
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(achievementDefinitions).values({ ...d, id: newId(), mode: 'AUTOMATIC' }))).rejects.toThrow();
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(achievementDefinitions).values({ ...d, id: newId(), mode: 'MANUAL', metric: 'TASKS_COMPLETED' }))).rejects.toThrow();
  });

  it('reviews keep ratings 1–5', async () => {
    const r = { organizationId: A.org, membershipId: A.member, reviewerMembershipId: A.member, periodStart: '2026-07-01', periodEnd: '2026-09-30' };
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceReviews).values({ ...r, id: newId(), qualityRating: 6 }))).rejects.toThrow();
    await withTenant(h.db, A.org, (tx) => tx.insert(performanceReviews).values({ ...r, id: newId(), qualityRating: 4 }));
  });

  it('one snapshot per subject and period', async () => {
    const s = { organizationId: A.org, subjectType: 'MEMBER' as const, subjectId: A.member, periodType: 'MONTH' as const, periodStart: '2026-10-01', periodEnd: '2026-10-31', ruleId: A.rule, ruleVersion: 1, score: 81.5, coverage: 100, metrics: {}, eligible: true, final: true };
    await withTenant(h.db, A.org, (tx) => tx.insert(performanceScoreSnapshots).values({ ...s, id: newId() }));
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(performanceScoreSnapshots).values({ ...s, id: newId() }))).rejects.toThrow();
    const [row] = await withTenant(h.db, A.org, (tx) => tx.select().from(performanceScoreSnapshots));
    expect(row!.score).toBe(81.5);
  });
});
