import { Hono } from 'hono';
import { z } from 'zod';
import {
  dateRangeQuery,
  decisionInput,
  idleResolveInput,
  isoDate,
  manualTimeInput,
  sessionNoteInput,
  startTrackingInput,
  switchTaskInput,
  timeEntryDeleteInput,
  timeEntrySplitInput,
  timeEntryUpdateInput,
} from '@tallywork/contracts';
import { localDate } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body, idList, query } from '../lib/http';
import { requirePermission } from '../middleware/tenant';
import { ctx } from '../services/ctx';
import { activityDay, deleteScreenshot, getScreenshot, listIdleEvents, listScreenshots, rawSpans, resolveIdleByUser, usage } from '../services/activity';
import { currentTracking, forceStop, getSession, listSessions, liveWorkers, setSessionNote, webPause, webResume, webStart, webStop, webSwitch } from '../services/timer';
import {
  approvalQueue,
  bulkApprove,
  decideManualTime,
  decideTimesheet,
  deleteTimeEntry,
  entryRevisions,
  getTimesheet,
  listManualTime,
  listTimeEntries,
  requestManualTime,
  splitTimeEntry,
  submitTimesheet,
  timesheetHistory,
  updateTimeEntry,
} from '../services/timesheets';

const rangeWithMembers = dateRangeQuery.and(z.object({ membership_ids: idList, project_id: z.uuid().optional() }));

export const timeRoutes = new Hono<AppEnv>()
  // Timer (web / API)
  .get('/tracking/current', async (c) => c.json(await currentTracking(ctx(c))))
  .post('/tracking/start', requirePermission('tracking:track'), async (c) => {
    const i = await body(c, startTrackingInput);
    const source = c.var.principal?.type === 'api_key' ? 'API' : i.source;
    return c.json(await webStart(ctx(c), { projectId: i.project_id, taskId: i.task_id ?? null, note: i.note ?? null, source }));
  })
  .post('/tracking/stop', async (c) => c.json(await webStop(ctx(c))))
  .post('/tracking/pause', async (c) => c.json(await webPause(ctx(c))))
  .post('/tracking/resume', async (c) => c.json(await webResume(ctx(c))))
  .post('/tracking/switch', requirePermission('tracking:track'), async (c) => {
    const i = await body(c, switchTaskInput);
    return c.json(await webSwitch(ctx(c), { projectId: i.project_id, taskId: i.task_id ?? null }));
  })
  .post('/tracking/note', async (c) => c.json(await setSessionNote(ctx(c), (await body(c, sessionNoteInput)).note)))
  .get('/tracking/live', requirePermission('tracking:read'), async (c) => c.json(await liveWorkers(ctx(c))))
  .get('/sessions', requirePermission('tracking:read'), async (c) => {
    const q = query(c, rangeWithMembers);
    return c.json(await listSessions(ctx(c), { from: q.from, to: q.to, membershipIds: q.membership_ids }));
  })
  .get('/sessions/:id', async (c) => c.json(await getSession(ctx(c), c.req.param('id'))))
  .post('/sessions/:id/force-stop', async (c) => c.json(await forceStop(ctx(c), c.req.param('id'))))

  // Time entries
  .get('/time-entries', requirePermission('time:read'), async (c) => {
    const q = query(c, rangeWithMembers);
    return c.json(await listTimeEntries(ctx(c), { from: q.from, to: q.to, membershipIds: q.membership_ids, projectId: q.project_id }));
  })
  .patch('/time-entries/:id', async (c) => c.json(await updateTimeEntry(ctx(c), c.req.param('id'), await body(c, timeEntryUpdateInput))))
  .post('/time-entries/:id/split', async (c) => {
    const i = await body(c, timeEntrySplitInput);
    return c.json(await splitTimeEntry(ctx(c), c.req.param('id'), new Date(i.at), i.reason ?? null));
  })
  .delete('/time-entries/:id', async (c) => {
    let reason: string | null = null;
    if (c.req.header('content-type')?.includes('json')) reason = (await body(c, timeEntryDeleteInput)).reason ?? null;
    await deleteTimeEntry(ctx(c), c.req.param('id'), reason ?? c.req.query('reason') ?? null);
    return c.body(null, 204);
  })
  .get('/time-entries/:id/revisions', async (c) => c.json(await entryRevisions(ctx(c), c.req.param('id'))))

  // Manual time
  .get('/manual-time', async (c) => {
    const q = query(c, z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), membership_ids: idList }));
    return c.json(await listManualTime(ctx(c), { status: q.status, membershipIds: q.membership_ids }));
  })
  .post('/manual-time', async (c) => c.json(await requestManualTime(ctx(c), await body(c, manualTimeInput)), 201))
  .post('/manual-time/:id/:action{approve|reject}', async (c) => {
    const i = await body(c, decisionInput);
    await decideManualTime(ctx(c), c.req.param('id'), c.req.param('action') === 'approve', i.comment ?? null);
    return c.body(null, 204);
  })

  // Timesheets
  .get('/timesheets', async (c) => {
    const x = ctx(c);
    const q = query(c, z.object({ membership_id: z.uuid().optional(), date: isoDate.optional() }));
    return c.json(await getTimesheet(x, q.membership_id ?? x.actor.membershipId, q.date ?? localDate(x.deps.now(), x.org.timezone)));
  })
  .post('/timesheets/submit', async (c) => {
    const x = ctx(c);
    const i = await body(c, z.object({ membership_id: z.uuid().optional(), date: isoDate, version: z.number().int().optional() }));
    return c.json(await submitTimesheet(x, i.membership_id ?? x.actor.membershipId, i.date, i.version));
  })
  .get('/timesheets/approvals', async (c) => c.json(await approvalQueue(ctx(c), query(c, z.object({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).optional() })))))
  .post('/timesheets/bulk-approve', async (c) => c.json(await bulkApprove(ctx(c), (await body(c, z.object({ ids: z.array(z.uuid()).min(1).max(200) }))).ids)))
  .post('/timesheets/:id/:action{approve|reject|request-changes|reopen}', async (c) => {
    const i = await body(c, decisionInput);
    const action = ({ approve: 'APPROVE', reject: 'REJECT', 'request-changes': 'REQUEST_CHANGES', reopen: 'REOPEN' } as const)[c.req.param('action') as 'approve'];
    return c.json(await decideTimesheet(ctx(c), c.req.param('id'), action, i.comment ?? null));
  })
  .get('/timesheets/:id/history', async (c) => c.json(await timesheetHistory(ctx(c), c.req.param('id'))))

  // Activity
  .get('/activity/day', requirePermission('activity:read'), async (c) => {
    const x = ctx(c);
    const q = query(c, z.object({ membership_id: z.uuid().optional(), date: isoDate }));
    return c.json(await activityDay(x, q.membership_id ?? x.actor.membershipId, q.date));
  })
  .get('/screenshots', requirePermission('screenshots:read'), async (c) => {
    const q = query(c, rangeWithMembers.and(z.object({ limit: z.coerce.number().int().min(1).max(200).optional() })));
    return c.json(await listScreenshots(ctx(c), { from: q.from, to: q.to, membershipIds: q.membership_ids, limit: q.limit }));
  })
  .get('/screenshots/:id', async (c) => c.json(await getScreenshot(ctx(c), c.req.param('id'))))
  .delete('/screenshots/:id', async (c) => {
    await deleteScreenshot(ctx(c), c.req.param('id'), c.req.query('remove_time') === 'true');
    return c.body(null, 204);
  })
  .get('/:kind{apps|urls}', requirePermission('apps:read'), async (c) => {
    const q = query(c, rangeWithMembers.and(z.object({ group_by: z.enum(['name', 'worker', 'project']).default('name') })));
    return c.json(await usage(ctx(c), c.req.param('kind') === 'apps' ? 'APP' : 'URL', { from: q.from, to: q.to, membershipIds: q.membership_ids, projectId: q.project_id, groupBy: q.group_by }));
  })
  .get('/:kind{apps|urls}/spans', requirePermission('apps:read'), async (c) => {
    const q = query(c, z.object({ membership_id: z.uuid(), date: isoDate }));
    return c.json(await rawSpans(ctx(c), c.req.param('kind') === 'apps' ? 'APP' : 'URL', q.membership_id, q.date));
  })
  .get('/idle-events', requirePermission('activity:read'), async (c) => {
    const q = query(c, rangeWithMembers.and(z.object({ status: z.enum(['PENDING', 'KEPT', 'DISCARDED', 'REASSIGNED']).optional() })));
    return c.json(await listIdleEvents(ctx(c), { from: q.from, to: q.to, membershipIds: q.membership_ids, status: q.status }));
  })
  .post('/idle-events/:id/resolve', async (c) => {
    const i = await body(c, idleResolveInput);
    await resolveIdleByUser(ctx(c), c.req.param('id'), { resolution: i.resolution, projectId: i.project_id, taskId: i.task_id });
    return c.body(null, 204);
  });
