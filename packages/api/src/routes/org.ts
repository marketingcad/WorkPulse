import { Hono } from 'hono';
import { z } from 'zod';
import {
  clientInput,
  pageQuery,
  clientPortalInviteInput,
  clientPortalSettingsInput,
  inviteInput,
  memberDetailsInput,
  policyDocInput,
  portalRangeInput,
  projectInput,
  roleInput,
  taskInput,
  teamInput,
  teamMemberInput,
  timeTypeInput,
  updateOrgInput,
  updateWorkerInput,
} from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { requirePermission } from '../middleware/tenant';
import { ctx } from '../services/ctx';
import {
  deleteRole,
  getMemberDetails,
  getWorker,
  inviteWorker,
  listInvitations,
  listRoles,
  listWorkers,
  listMemberOptions,
  pageWorkers,
  orgContext,
  removeWorker,
  revokeInvitation,
  updateMemberDetails,
  updateOrg,
  updateWorker,
  upsertRole,
} from '../services/org';
import {
  archiveTask,
  archiveTeam,
  getProject,
  listClients,
  listProjects,
  listTasks,
  pageTasks,
  listTeams,
  setClientArchived,
  setProjectArchived,
  setTeamMember,
  upsertClient,
  upsertProject,
  upsertTask,
  upsertTeam,
  assignmentsFor,
} from '../services/work';
import { getEffectivePolicy, getPolicyLayer, listDevices,
  pageDevices, putPolicyLayer, setDeviceStatus } from '../services/platform';
import { myAssignments } from '../services/timer';
import { getPortalSettings, invitePortalViewer, previewAccess, previewScreenshots, revokePortalViewer, updatePortalSettings } from '../services/portal-admin';
import { clientVisibilityFor, portalSummaryTx } from '../services/portal';
import { archiveTimeType, listTimeTypes, upsertTimeType } from '../services/time-types';
import { INLINE_TYPES, deleteProjectDocument, listProjectDocuments, projectDocumentForDownload, uploadProjectDocument } from '../services/project-documents';
import { notFound, validation } from '@tallywork/domain';

const bool = z.enum(['true', 'false']).optional().transform((v) => v === 'true');
const scopeType = z.enum(['ORG', 'TEAM', 'WORKER']);

export const orgRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await orgContext(ctx(c))))
  .patch('/', async (c) => c.json(await updateOrg(ctx(c), await body(c, updateOrgInput))))

  // Roles
  .get('/roles', requirePermission('members:read', 'roles:manage'), async (c) => c.json(await listRoles(ctx(c))))
  .post('/roles', async (c) => c.json(await upsertRole(ctx(c), null, await body(c, roleInput)), 201))
  .put('/roles/:id', async (c) => c.json(await upsertRole(ctx(c), c.req.param('id'), await body(c, roleInput))))
  .delete('/roles/:id', async (c) => {
    await deleteRole(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })

  // Workers & invitations
  // Sending `page` returns { data, total, page, page_size }; without it, every member as before.
  .get('/workers', requirePermission('members:read'), async (c) => {
    const q = query(c, pageQuery.extend({ include_removed: bool, view: z.enum(['current', 'former']).optional(), status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED']).optional(), role_id: z.uuid().optional() }));
    const filters = { includeRemoved: q.include_removed, view: q.view, status: q.status, roleId: q.role_id, search: q.q };
    return c.json(q.page ? await pageWorkers(ctx(c), { ...filters, page: q.page, pageSize: q.page_size }) : await listWorkers(ctx(c), filters));
  })
  // Light member list for pickers and name lookups (registered before /workers/:id so "options" is not an id).
  .get('/workers/options', requirePermission('members:read'), async (c) => {
    const q = query(c, z.object({ include_removed: bool }));
    return c.json(await listMemberOptions(ctx(c), { includeRemoved: q.include_removed }));
  })
  .get('/workers/:id', requirePermission('members:read'), async (c) => c.json(await getWorker(ctx(c), c.req.param('id'))))
  .patch('/workers/:id', async (c) => c.json(await updateWorker(ctx(c), c.req.param('id'), await body(c, updateWorkerInput))))
  .get('/time-types', async (c) => c.json(await listTimeTypes(ctx(c), { includeArchived: query(c, z.object({ include_archived: bool })).include_archived })))
  .post('/time-types', async (c) => c.json(await upsertTimeType(ctx(c), null, await body(c, timeTypeInput)), 201))
  .patch('/time-types/:id', async (c) => c.json(await upsertTimeType(ctx(c), c.req.param('id'), await body(c, timeTypeInput))))
  .delete('/time-types/:id', async (c) => {
    await archiveTimeType(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/workers/:id/details', async (c) => c.json(await getMemberDetails(ctx(c), c.req.param('id'))))
  .patch('/workers/:id/details', async (c) => c.json(await updateMemberDetails(ctx(c), c.req.param('id'), await body(c, memberDetailsInput))))
  .delete('/workers/:id', async (c) => {
    await removeWorker(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/workers/:id/assignments', requirePermission('members:read'), async (c) => {
    const x = ctx(c);
    await getWorker(x, c.req.param('id'));
    return c.json(await assignmentsFor(x, x.org.id, c.req.param('id')));
  })
  .get('/workers/:id/effective-policy', async (c) => c.json(await getEffectivePolicy(ctx(c), c.req.param('id'))))
  .get('/invitations', async (c) => c.json(await listInvitations(ctx(c))))
  .post('/invitations', async (c) => c.json(await inviteWorker(ctx(c), await body(c, inviteInput)), 201))
  .delete('/invitations/:id', async (c) => {
    await revokeInvitation(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })

  // Teams
  .get('/teams', async (c) => c.json(await listTeams(ctx(c))))
  .post('/teams', async (c) => c.json(await upsertTeam(ctx(c), null, await body(c, teamInput)), 201))
  .patch('/teams/:id', async (c) => c.json(await upsertTeam(ctx(c), c.req.param('id'), await body(c, teamInput))))
  .delete('/teams/:id', async (c) => {
    await archiveTeam(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .put('/teams/:id/members/:membershipId', async (c) => {
    const input = await body(c, teamMemberInput);
    await setTeamMember(ctx(c), c.req.param('id'), c.req.param('membershipId'), input.role);
    return c.json((await listTeams(ctx(c))).find((t) => t.id === c.req.param('id')) ?? null);
  })
  .delete('/teams/:id/members/:membershipId', async (c) => {
    await setTeamMember(ctx(c), c.req.param('id'), c.req.param('membershipId'), null);
    return c.body(null, 204);
  })

  // Clients
  .get('/clients', async (c) => c.json(await listClients(ctx(c), { includeArchived: query(c, z.object({ include_archived: bool })).include_archived })))
  .post('/clients', async (c) => c.json(await upsertClient(ctx(c), null, await body(c, clientInput)), 201))
  .patch('/clients/:id', async (c) => c.json(await upsertClient(ctx(c), c.req.param('id'), await body(c, clientInput))))
  .post('/clients/:id/archive', async (c) => {
    await setClientArchived(ctx(c), c.req.param('id'), true);
    return c.body(null, 204);
  })
  .post('/clients/:id/restore', async (c) => {
    await setClientArchived(ctx(c), c.req.param('id'), false);
    return c.body(null, 204);
  })

  // Client portal (admins): settings, viewers, invitations
  .get('/clients/:id/portal', requirePermission('clients:manage'), async (c) => c.json(await getPortalSettings(ctx(c), c.req.param('id'))))
  .put('/clients/:id/portal', requirePermission('clients:manage'), async (c) => c.json(await updatePortalSettings(ctx(c), c.req.param('id'), await body(c, clientPortalSettingsInput))))
  .post('/clients/:id/portal/invitations', requirePermission('clients:manage'), async (c) => c.json(await invitePortalViewer(ctx(c), c.req.param('id'), await body(c, clientPortalInviteInput)), 201))
  .delete('/clients/:id/portal/access/:accessId', requirePermission('clients:manage'), async (c) => {
    await revokePortalViewer(ctx(c), c.req.param('id'), c.req.param('accessId'));
    return c.body(null, 204);
  })
  .get('/clients/:id/portal/preview', requirePermission('clients:manage'), async (c) => {
    const x = ctx(c);
    // Reuses this request's already-open tenant transaction (portalSummary would open a second one).
    return c.json(await portalSummaryTx(x.tx, await previewAccess(x, c.req.param('id')), query(c, portalRangeInput)));
  })
  .get('/clients/:id/portal/preview/screenshots', requirePermission('clients:manage'), async (c) => c.json(await previewScreenshots(ctx(c), c.req.param('id'), query(c, portalRangeInput))))

  // Projects & tasks
  .get('/projects', async (c) => {
    const q = query(c, z.object({ include_archived: bool, client_id: z.uuid().optional() }));
    return c.json(await listProjects(ctx(c), { includeArchived: q.include_archived, clientId: q.client_id }));
  })
  .post('/projects', async (c) => c.json(await upsertProject(ctx(c), null, await body(c, projectInput)), 201))
  .get('/projects/:id', async (c) => c.json(await getProject(ctx(c), c.req.param('id'))))
  .patch('/projects/:id', async (c) => c.json(await upsertProject(ctx(c), c.req.param('id'), await body(c, projectInput.partial()) as z.infer<typeof projectInput>)))
  .post('/projects/:id/archive', async (c) => {
    await setProjectArchived(ctx(c), c.req.param('id'), true);
    return c.body(null, 204);
  })
  .post('/projects/:id/restore', async (c) => {
    await setProjectArchived(ctx(c), c.req.param('id'), false);
    return c.body(null, 204);
  })
  .get('/projects/:id/documents', async (c) => c.json(await listProjectDocuments(ctx(c), c.req.param('id'))))
  .post('/projects/:id/documents', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw validation('Attach a file', { errors: [{ field: 'file', message: 'Choose a file' }] });
    return c.json(await uploadProjectDocument(ctx(c), c.req.param('id'), file), 201);
  })
  .get('/projects/:id/documents/:docId', async (c) => {
    const x = ctx(c);
    const doc = await projectDocumentForDownload(x, c.req.param('id'), c.req.param('docId'));
    const obj = await x.deps.storage.get(doc.storageKey);
    if (!obj) throw notFound('document');
    const disposition = INLINE_TYPES.has(doc.contentType) && c.req.query('download') !== '1' ? 'inline' : 'attachment';
    const ascii = doc.name.replace(/[^\x20-\x7e]/g, '_');
    return new Response(obj.body, {
      headers: {
        'Content-Type': doc.contentType,
        'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  })
  .delete('/projects/:id/documents/:docId', async (c) => {
    await deleteProjectDocument(ctx(c), c.req.param('id'), c.req.param('docId'));
    return c.body(null, 204);
  })
  .get('/projects/:id/tasks', async (c) => c.json(await listTasks(ctx(c), { projectId: c.req.param('id') })))
  .post('/projects/:id/tasks', async (c) => c.json(await upsertTask(ctx(c), c.req.param('id'), null, await body(c, taskInput)), 201))
  .get('/tasks', async (c) => {
    // Sending `page` returns { data, total, page, page_size, summary }; without it, the same array as before.
    const q = query(c, pageQuery.extend({ project_id: z.uuid().optional(), status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(), assignee_id: z.uuid().optional(), mine: bool }));
    const filters = { projectId: q.project_id, status: q.status, assigneeId: q.assignee_id, mine: q.mine, search: q.q };
    return c.json(q.page ? await pageTasks(ctx(c), { ...filters, page: q.page, pageSize: q.page_size }) : await listTasks(ctx(c), filters));
  })
  .patch('/tasks/:id', async (c) => {
    const input = await body(c, taskInput.partial().extend({ project_id: z.uuid() }));
    const { project_id, ...rest } = input;
    return c.json(await upsertTask(ctx(c), project_id, c.req.param('id'), rest));
  })
  .delete('/tasks/:id', async (c) => {
    await archiveTask(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/me/assignments', async (c) => c.json(await myAssignments(ctx(c))))
  .get('/me/client-visibility', async (c) => c.json(await clientVisibilityFor(c.var.tx, c.var.actor.membershipId)))

  // Policies & devices
  .get('/policies/:scopeType/:scopeId', async (c) => c.json(await getPolicyLayer(ctx(c), scopeType.parse(c.req.param('scopeType')), c.req.param('scopeId'))))
  .put('/policies/:scopeType/:scopeId', async (c) => c.json(await putPolicyLayer(ctx(c), scopeType.parse(c.req.param('scopeType')), c.req.param('scopeId'), await body(c, policyDocInput))))
  // Sending `page` returns { data, total, page, page_size, summary }; without it, every device as before.
  .get('/devices', async (c) => {
    const q = query(c, pageQuery.extend({ membership_id: z.uuid().optional(), status: z.enum(['PENDING', 'ACTIVE', 'OFFLINE', 'REVOKED']).optional() }));
    const filters = { membershipId: q.membership_id, status: q.status, search: q.q };
    return c.json(q.page ? await pageDevices(ctx(c), { ...filters, page: q.page, pageSize: q.page_size }) : await listDevices(ctx(c), filters));
  })
  .post('/devices/:id/:action{revoke|approve|reauth}', async (c) => c.json(await setDeviceStatus(ctx(c), c.req.param('id'), c.req.param('action') as 'revoke')));
