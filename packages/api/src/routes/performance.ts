import { Hono } from 'hono';
import { z } from 'zod';
import { achievementDefinitionInput, awardInput, goalInput, goalPatchInput, milestoneInput, milestonePatchInput, performanceSettingsInput, reviewInput, scoreQuery } from '@tallywork/contracts';
import { GOAL_SUBJECTS, PERFORMANCE_PERIODS } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { requirePermission } from '../middleware/tenant';
import { ctx } from '../services/ctx';
import { archiveMilestone, createMilestone, getPerformanceSettings, listMemberSnapshots, listMilestones, memberScore, updateMilestone, updatePerformanceSettings } from '../services/performance';
import { awardAchievement, createAchievementDefinition, listAchievementDefinitions, listAwards, revokeAward, setAchievementArchived } from '../services/achievements';
import { createGoal, getGoal, listGoals, updateGoal } from '../services/goals';
import { leaderboard, memberPerformanceList, memberProfile, performanceOverview, recalculatePerformance, teamPerformance } from '../services/leaderboards';
import { archiveReview, createReview, listReviews, updateReview } from '../services/reviews';
import { decideAppreciation, listAppreciations } from '../services/portal-insights';

const isoDate = z.iso.date();
const bool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();
const periodQuery = z.object({ period: z.enum(PERFORMANCE_PERIODS).default('MONTH'), date: isoDate.optional() });

/**
 * Performance Center (organization routes). Every service checks the actor's scope on the subject
 * itself; the route guards are only the coarse first gate. Not reachable with API keys (no scope maps
 * to these paths), and no rate-limit middleware here: these run inside the tenant transaction.
 */
export const performanceRoutes = new Hono<AppEnv>()
  // Settings and scores
  .get('/performance/settings', requirePermission('performance:read'), async (c) => c.json(await getPerformanceSettings(ctx(c))))
  .put('/performance/settings', requirePermission('performance:manage'), async (c) => c.json(await updatePerformanceSettings(ctx(c), await body(c, performanceSettingsInput))))
  .post('/performance/recalculate', requirePermission('performance:manage'), async (c) => {
    const b = await body(c, z.object({ period: z.enum(PERFORMANCE_PERIODS).default('MONTH'), date: isoDate.optional() }));
    return c.json(await recalculatePerformance(ctx(c), b.period, b.date));
  })
  .get('/performance/overview', requirePermission('performance:read'), async (c) => {
    const q = query(c, periodQuery.extend({ team_id: z.uuid().optional(), project_id: z.uuid().optional() }));
    return c.json(await performanceOverview(ctx(c), { period: q.period, date: q.date, teamId: q.team_id, projectId: q.project_id }));
  })
  .get('/performance/leaderboard', requirePermission('performance:read'), async (c) => {
    const q = query(c, periodQuery.extend({ type: z.enum(['workers', 'teams', 'projects']).default('workers'), compare: z.enum(['role', 'everyone']).default('role') }));
    return c.json(await leaderboard(ctx(c), q));
  })
  .get('/performance/teams', requirePermission('performance:read'), async (c) => {
    const q = query(c, periodQuery.extend({ team_ids: z.string().max(2000).optional() }));
    return c.json(await teamPerformance(ctx(c), { period: q.period, date: q.date, teamIds: q.team_ids?.split(',').filter(Boolean) }));
  })
  .get('/performance/members', requirePermission('performance:read'), async (c) => c.json(await memberPerformanceList(ctx(c), query(c, periodQuery))))
  .get('/performance/members/:id/score', requirePermission('performance:read'), async (c) => {
    const q = query(c, scoreQuery);
    return c.json(await memberScore(ctx(c), c.req.param('id'), q.from, q.to));
  })
  .get('/performance/members/:id/profile', requirePermission('performance:read'), async (c) => c.json(await memberProfile(ctx(c), c.req.param('id'), query(c, periodQuery))))
  .get('/performance/members/:id/history', requirePermission('performance:read'), async (c) => {
    const q = query(c, z.object({ period: z.enum(PERFORMANCE_PERIODS).default('MONTH') }));
    return c.json(await listMemberSnapshots(ctx(c), c.req.param('id'), q.period));
  })

  // Achievements and recognition
  .get('/performance/achievements', requirePermission('achievements:read'), async (c) => c.json(await listAchievementDefinitions(ctx(c), { includeArchived: query(c, z.object({ archived: bool })).archived })))
  .post('/performance/achievements', requirePermission('achievements:manage'), async (c) => c.json(await createAchievementDefinition(ctx(c), await body(c, achievementDefinitionInput)), 201))
  .post('/performance/achievements/:id/:action{archive|restore}', requirePermission('achievements:manage'), async (c) => {
    await setAchievementArchived(ctx(c), c.req.param('id'), c.req.param('action') === 'archive');
    return c.body(null, 204);
  })
  .get('/performance/awards', requirePermission('achievements:read'), async (c) => {
    const q = query(c, z.object({ membership_id: z.uuid().optional(), team_id: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
    return c.json(await listAwards(ctx(c), { membershipId: q.membership_id, teamId: q.team_id, from: q.from, to: q.to, limit: q.limit }));
  })
  .post('/performance/awards', requirePermission('achievements:award'), async (c) => c.json(await awardAchievement(ctx(c), await body(c, awardInput)), 201))
  .post('/performance/awards/:id/revoke', requirePermission('achievements:award'), async (c) => {
    const b = await body(c, z.object({ reason: z.string().trim().min(1).max(500) }));
    await revokeAward(ctx(c), c.req.param('id'), b.reason);
    return c.body(null, 204);
  })
  .get('/performance/appreciations', requirePermission('achievements:award'), async (c) => c.json(await listAppreciations(ctx(c), query(c, z.object({ status: z.enum(['PENDING', 'APPROVED', 'DECLINED']).optional() })).status)))
  .post('/performance/appreciations/:id/:action{approve|decline}', requirePermission('achievements:award'), async (c) => {
    await decideAppreciation(ctx(c), c.req.param('id'), c.req.param('action') === 'approve');
    return c.body(null, 204);
  })

  // Goals
  .get('/performance/goals', requirePermission('goals:read'), async (c) => {
    const q = query(c, z.object({ status: z.enum(['ACTIVE', 'COMPLETED', 'MISSED', 'ARCHIVED']).optional(), subject_type: z.enum(GOAL_SUBJECTS).optional(), membership_id: z.uuid().optional(), team_id: z.uuid().optional(), project_id: z.uuid().optional() }));
    return c.json(await listGoals(ctx(c), { status: q.status, subjectType: q.subject_type, membershipId: q.membership_id, teamId: q.team_id, projectId: q.project_id }));
  })
  .post('/performance/goals', requirePermission('goals:manage'), async (c) => c.json(await createGoal(ctx(c), await body(c, goalInput)), 201))
  .get('/performance/goals/:id', requirePermission('goals:read'), async (c) => c.json(await getGoal(ctx(c), c.req.param('id'))))
  .patch('/performance/goals/:id', requirePermission('goals:manage'), async (c) => c.json(await updateGoal(ctx(c), c.req.param('id'), await body(c, goalPatchInput))))

  // Reviews (confidential)
  .get('/performance/members/:id/reviews', requirePermission('reviews:read'), async (c) => c.json(await listReviews(ctx(c), c.req.param('id'))))
  .post('/performance/reviews', requirePermission('reviews:manage'), async (c) => c.json(await createReview(ctx(c), await body(c, reviewInput)), 201))
  .patch('/performance/reviews/:id', requirePermission('reviews:manage'), async (c) => {
    const patch = await body(
      c,
      z.object({
        period_start: isoDate.optional(),
        period_end: isoDate.optional(),
        quality_rating: z.number().int().min(1).max(5).nullable().optional(),
        summary: z.string().trim().max(4000).nullable().optional(),
        strengths: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
        improvements: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
        recommendations: z.string().trim().max(4000).nullable().optional(),
        private_note: z.string().trim().max(4000).nullable().optional(),
        shared_with_member: z.boolean().optional(),
        status: z.enum(['DRAFT', 'FINAL']).optional(),
      }).strict(),
    );
    return c.json(await updateReview(ctx(c), c.req.param('id'), patch));
  })
  .delete('/performance/reviews/:id', requirePermission('reviews:manage'), async (c) => {
    await archiveReview(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })

  // Project milestones (project permissions: anyone who can read the project sees them).
  .get('/projects/:id/milestones', async (c) => c.json(await listMilestones(ctx(c), c.req.param('id'))))
  .post('/projects/:id/milestones', async (c) => c.json(await createMilestone(ctx(c), c.req.param('id'), await body(c, milestoneInput)), 201))
  .patch('/milestones/:id', async (c) => c.json(await updateMilestone(ctx(c), c.req.param('id'), await body(c, milestonePatchInput))))
  .delete('/milestones/:id', async (c) => {
    await archiveMilestone(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  });


