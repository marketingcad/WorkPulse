/**
 * Client folders: an optional way to organize projects by client (settings.clientFolders, off by
 * default). A folder belongs to one client and holds no projects of its own: its projects are the
 * client's (projects.client_id), so nothing is copied and a project never leaves its client.
 *
 * Folders are managed by people who manage clients across the whole organization (System Admins by
 * default). Everyone else sees a folder only when they can see its client, and inside it only the
 * projects they can see (the same rules as the Clients and Projects lists).
 *
 * Project revision history is read from the audit log (target_type 'project'), not a store of its own.
 */
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { auditLogs, clientFolders, clients, projectMembers, projectMilestones, projectTeams, projects, tasks, teams } from '@tallywork/db';
import { PROJECT_REVISION_ACTIONS, businessRule, conflict, forbidden, newId, notFound, projectProgressPct, projectRevisionChanges, validation } from '@tallywork/domain';
import type {
  ClientFolderDetailDto,
  ClientFolderDto,
  ClientFoldersDto,
  FolderProjectDto,
  ProjectRevisionDto,
  ProjectRevisionsDto,
  clientFolderInput,
  clientFolderPatchInput,
  folderProjectsInput,
  projectInput,
} from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { canOnProject, clientFilter, projectFilter } from './scope';
import { memberNames } from './timer';
import { upsertProject } from './work';
import { iso } from '../lib/http';

export const foldersEnabled = (x: Pick<Ctx, 'org'>) => x.org.settings.clientFolders === true;

/** Managing folders is organization-wide client management (System Admins by default). */
export const canManageFolders = (x: Pick<Ctx, 'actor'>) => x.actor.grants['clients:manage'] === 'org';

function assertEnabled(x: Ctx) {
  if (!foldersEnabled(x)) throw businessRule('client_folders_disabled', 'Client folders are turned off for this organization. Turn them on in Projects first.');
}

function assertManager(x: Ctx) {
  if (!canManageFolders(x)) throw forbidden();
}

/** Projects of these clients the actor may see, counted per client. */
async function projectCounts(x: Ctx, clientIds: string[]) {
  const out = new Map<string, { all: number; active: number }>();
  if (!clientIds.length || !x.actor.grants['projects:read']) return out;
  const rows = await x.tx
    .select({ clientId: projects.clientId, all: count(), active: sql<number>`count(*) filter (where ${projects.status} = 'ACTIVE')::int` })
    .from(projects)
    .where(and(inArray(projects.clientId, clientIds), isNull(projects.archivedAt), projectFilter(x.actor, 'projects:read', projects.id)))
    .groupBy(projects.clientId);
  for (const r of rows) out.set(r.clientId!, { all: Number(r.all), active: Number(r.active) });
  return out;
}

async function folderRows(x: Ctx, where: ReturnType<typeof and>) {
  return x.tx
    .select({ f: clientFolders, clientName: clients.name, clientColor: clients.color, clientLogo: clients.logo, clientArchivedAt: clients.archivedAt })
    .from(clientFolders)
    .innerJoin(clients, eq(clients.id, clientFolders.clientId))
    .where(and(where, clientFilter(x, 'clients:read', clientFolders.clientId)))
    .orderBy(asc(sql`lower(${clientFolders.name})`));
}

async function toDtos(x: Ctx, rows: Awaited<ReturnType<typeof folderRows>>): Promise<ClientFolderDto[]> {
  const counts = await projectCounts(x, rows.map((r) => r.f.clientId));
  return rows.map(({ f, clientName, clientColor, clientLogo, clientArchivedAt }) => ({
    id: f.id,
    client_id: f.clientId,
    client_name: clientName,
    client_color: clientColor,
    client_logo: clientLogo,
    client_archived: !!clientArchivedAt,
    name: f.name,
    description: f.description,
    project_count: counts.get(f.clientId)?.all ?? 0,
    active_project_count: counts.get(f.clientId)?.active ?? 0,
    archived_at: iso(f.archivedAt),
    updated_at: f.updatedAt.toISOString(),
    created_at: f.createdAt.toISOString(),
  }));
}

export async function listClientFolders(x: Ctx, opts: { includeArchived?: boolean } = {}): Promise<ClientFoldersDto> {
  if (!x.actor.grants['clients:read']) throw forbidden();
  // Turned off: no folders anywhere (they are kept, and come back when folders are turned on again).
  if (!foldersEnabled(x)) return { enabled: false, folders: [] };
  const rows = await folderRows(x, and(eq(clientFolders.organizationId, x.org.id), opts.includeArchived ? undefined : isNull(clientFolders.archivedAt)));
  return { enabled: true, folders: await toDtos(x, rows) };
}

/** A folder the actor may see, or 404 (also when folders are off, so a stale link explains nothing). */
async function folderFor(x: Ctx, folderId: string) {
  if (!x.actor.grants['clients:read'] || !foldersEnabled(x)) throw notFound('folder');
  const [row] = await folderRows(x, eq(clientFolders.id, folderId));
  if (!row) throw notFound('folder');
  return row;
}

export async function createClientFolder(x: Ctx, input: z.infer<typeof clientFolderInput>): Promise<ClientFolderDto> {
  assertManager(x);
  assertEnabled(x);
  const [c] = await x.tx.select({ id: clients.id, name: clients.name, archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, input.client_id));
  if (!c) throw notFound('client');
  if (c.archivedAt) throw validation('This client is archived', { errors: [{ field: 'client_id', message: 'Restore the client first, or choose one that is in use' }] });
  const [existing] = await x.tx.select({ id: clientFolders.id }).from(clientFolders).where(eq(clientFolders.clientId, c.id));
  if (existing) throw conflict('folder_exists', `${c.name} already has a folder`, { folder_id: existing.id, errors: [{ field: 'client_id', message: 'This client already has a folder' }] });
  const id = newId();
  const name = input.name?.trim() || c.name;
  await x.tx.insert(clientFolders).values({ id, organizationId: x.org.id, clientId: c.id, name, description: input.description ?? null, createdBy: x.actor.membershipId });
  await audit(x, { action: 'client_folder.created', targetType: 'client_folder', targetId: id, after: { client_id: c.id, name, description: input.description ?? null } });
  return (await getClientFolder(x, id)).folder;
}

export async function updateClientFolder(x: Ctx, folderId: string, input: z.infer<typeof clientFolderPatchInput>): Promise<ClientFolderDto> {
  assertManager(x);
  assertEnabled(x);
  const { f } = await folderFor(x, folderId);
  const values: Partial<typeof clientFolders.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description ?? null;
  if (Object.keys(values).length) {
    await x.tx.update(clientFolders).set({ ...values, updatedAt: x.deps.now() }).where(eq(clientFolders.id, folderId));
    await audit(x, { action: 'client_folder.updated', targetType: 'client_folder', targetId: folderId, before: { name: f.name, description: f.description }, after: input });
  }
  return (await getClientFolder(x, folderId)).folder;
}

/** Archiving a folder only hides it: the client, its projects and their time are untouched. */
export async function setClientFolderArchived(x: Ctx, folderId: string, archived: boolean): Promise<void> {
  assertManager(x);
  assertEnabled(x);
  const { f } = await folderFor(x, folderId);
  if (!!f.archivedAt === archived) return;
  await x.tx.update(clientFolders).set({ archivedAt: archived ? x.deps.now() : null, updatedAt: x.deps.now() }).where(eq(clientFolders.id, folderId));
  await audit(x, { action: archived ? 'client_folder.archived' : 'client_folder.restored', targetType: 'client_folder', targetId: folderId });
}

export async function getClientFolder(x: Ctx, folderId: string, opts: { includeArchived?: boolean } = {}): Promise<ClientFolderDetailDto> {
  const row = await folderFor(x, folderId);
  const [folder] = await toDtos(x, [row]);
  const manage = canManageFolders(x);
  return { folder: folder!, projects: await folderProjects(x, row.f.clientId, { includeArchived: !!opts.includeArchived, withRevisions: manage }), can_manage: manage };
}

async function folderProjects(x: Ctx, clientId: string, opts: { includeArchived: boolean; withRevisions: boolean }): Promise<FolderProjectDto[]> {
  if (!x.actor.grants['projects:read']) return [];
  const rows = await x.tx
    .select()
    .from(projects)
    .where(and(eq(projects.clientId, clientId), opts.includeArchived ? undefined : isNull(projects.archivedAt), projectFilter(x.actor, 'projects:read', projects.id)))
    .orderBy(asc(projects.name));
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);

  // Task counts follow the task rules: someone who cannot read tasks sees none.
  const taskRows = x.actor.grants['tasks:read']
    ? await x.tx
        .select({ projectId: tasks.projectId, all: count(), done: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')::int` })
        .from(tasks)
        .where(and(inArray(tasks.projectId, ids), isNull(tasks.archivedAt), projectFilter(x.actor, 'tasks:read', tasks.projectId)))
        .groupBy(tasks.projectId)
    : [];
  const taskMap = new Map(taskRows.map((t) => [t.projectId, { all: Number(t.all), done: Number(t.done) }]));

  const milestones = await x.tx
    .select({ id: projectMilestones.id, projectId: projectMilestones.projectId, title: projectMilestones.title, dueDate: projectMilestones.dueDate, completedAt: projectMilestones.completedAt })
    .from(projectMilestones)
    .where(and(inArray(projectMilestones.projectId, ids), isNull(projectMilestones.archivedAt)))
    .orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.position));

  const members = await x.tx.select({ projectId: projectMembers.projectId, membershipId: projectMembers.membershipId }).from(projectMembers).where(inArray(projectMembers.projectId, ids));
  const names = await memberNames(x, [...new Set(members.map((m) => m.membershipId))]);
  const teamRows = await x.tx.select({ projectId: projectTeams.projectId, n: count() }).from(projectTeams).where(inArray(projectTeams.projectId, ids)).groupBy(projectTeams.projectId);
  const teamMap = new Map(teamRows.map((t) => [t.projectId, Number(t.n)]));

  const revisions = opts.withRevisions ? await revisionCounts(x, ids) : null;

  return rows.map((p) => {
    const t = taskMap.get(p.id) ?? { all: 0, done: 0 };
    const ms = milestones.filter((m) => m.projectId === p.id);
    const next = ms.find((m) => !m.completedAt);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      short_name: p.shortName,
      status: p.status,
      archived_at: iso(p.archivedAt),
      start_date: p.startDate,
      end_date: p.endDate,
      task_count: t.all,
      tasks_done: t.done,
      tasks_pending: t.all - t.done,
      progress_pct: projectProgressPct(t.done, t.all),
      milestone_count: ms.length,
      milestones_done: ms.filter((m) => m.completedAt).length,
      next_milestone: next ? { id: next.id, title: next.title, due_date: next.dueDate } : null,
      members: members
        .filter((m) => m.projectId === p.id)
        .map((m) => ({ id: m.membershipId, name: names.get(m.membershipId) ?? 'Former member' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      team_count: teamMap.get(p.id) ?? 0,
      updated_at: p.updatedAt.toISOString(),
      revision_count: revisions ? (revisions.get(p.id) ?? 0) : null,
    };
  });
}

/**
 * Put existing projects in a folder. A project with no client gets the folder's client (through the
 * usual project update, so its rules, rates check and revision history apply). A project of another
 * client is refused: moving work between clients changes who is invoiced, so it is done on purpose in
 * the project's settings, never as a side effect of organizing.
 */
export async function addProjectsToFolder(x: Ctx, folderId: string, input: z.infer<typeof folderProjectsInput>): Promise<ClientFolderDetailDto> {
  assertManager(x);
  assertEnabled(x);
  if (x.actor.grants['projects:manage'] !== 'org') throw forbidden();
  const { f } = await folderFor(x, folderId);
  if (f.archivedAt) throw businessRule('folder_archived', 'This folder is archived. Restore it to add projects.');
  const ids = [...new Set(input.project_ids)];
  const rows = await x.tx.select({ id: projects.id, name: projects.name, clientId: projects.clientId, archivedAt: projects.archivedAt }).from(projects).where(inArray(projects.id, ids));
  const found = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw notFound('project');
  const foreign = rows.filter((r) => r.clientId && r.clientId !== f.clientId);
  if (foreign.length)
    throw conflict('project_has_other_client', `${foreign.map((r) => r.name).join(', ')} ${foreign.length === 1 ? 'belongs' : 'belong'} to another client. Change the client in the project’s settings if the work really moved.`, {
      project_ids: foreign.map((r) => r.id),
    });
  const archived = rows.filter((r) => r.archivedAt && !r.clientId);
  if (archived.length) throw businessRule('project_archived', `${archived.map((r) => r.name).join(', ')} ${archived.length === 1 ? 'is' : 'are'} archived. Restore ${archived.length === 1 ? 'it' : 'them'} first.`);
  for (const r of rows) {
    if (r.clientId === f.clientId) continue; // already in this folder
    await upsertProject(x, r.id, { client_id: f.clientId, change_reason: `Added to the folder ${f.name}` } as z.infer<typeof projectInput>);
  }
  return getClientFolder(x, folderId);
}

// ─── Project revision history ────────────────────────────────────────────────
const revisionWhere = (projectIds: string[]) =>
  and(eq(auditLogs.targetType, 'project'), inArray(auditLogs.targetId, projectIds), inArray(auditLogs.action, [...PROJECT_REVISION_ACTIONS]));

async function revisionCounts(x: Ctx, projectIds: string[]): Promise<Map<string, number>> {
  if (!projectIds.length) return new Map();
  const rows = await x.tx.select({ id: auditLogs.targetId, n: count() }).from(auditLogs).where(revisionWhere(projectIds)).groupBy(auditLogs.targetId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

/**
 * A project's revisions: who changed what, when, from which value to which, and why. For people who
 * manage the project (its history shows member lists and, with rates:read, rates).
 */
export async function listProjectRevisions(x: Ctx, projectId: string, q: { page: number; pageSize: number; order: 'asc' | 'desc' }): Promise<ProjectRevisionsDto> {
  if (!canOnProject(x.actor, 'projects:read', projectId)) throw notFound('project');
  const [p] = await x.tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound('project');
  if (!canOnProject(x.actor, 'projects:manage', projectId)) throw forbidden();

  const where = revisionWhere([projectId]);
  const [total] = await x.tx.select({ n: count() }).from(auditLogs).where(where);
  const n = Number(total?.n ?? 0);
  const offset = (q.page - 1) * q.pageSize;
  const rows = await x.tx
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(...(q.order === 'asc' ? [asc(auditLogs.createdAt), asc(auditLogs.id)] : [desc(auditLogs.createdAt), desc(auditLogs.id)]))
    .limit(q.pageSize)
    .offset(offset);

  const includeRates = !!x.actor.grants['rates:read'];
  const actors = await memberNames(x, [...new Set(rows.filter((r) => r.actorType === 'user' && r.actorId).map((r) => r.actorId!))]);
  const data: ProjectRevisionDto[] = rows.map((r, i) => ({
    id: r.id,
    number: q.order === 'asc' ? offset + i + 1 : n - offset - i,
    action: r.action as ProjectRevisionDto['action'],
    actor_type: r.actorType,
    actor_name: r.actorType === 'user' && r.actorId ? (actors.get(r.actorId) ?? 'Former member') : null,
    changes: projectRevisionChanges(r.before as Record<string, unknown> | null, r.after as Record<string, unknown> | null, { includeRates }),
    reason: typeof r.metadata?.reason === 'string' ? r.metadata.reason : null,
    created_at: r.createdAt.toISOString(),
  }));
  return { total: n, data, names: await namesIn(x, data) };
}

/** Display names for the member, team and client ids that appear in the changes. */
async function namesIn(x: Ctx, data: ProjectRevisionDto[]): Promise<Record<string, string>> {
  const memberIds = new Set<string>();
  const teamIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const r of data)
    for (const c of r.changes) {
      const vals = [c.before, c.after].flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === 'string');
      const into = c.field === 'member_ids' ? memberIds : c.field === 'team_ids' ? teamIds : c.field === 'client_id' ? clientIds : null;
      vals.forEach((v) => into?.add(v));
    }
  const out: Record<string, string> = {};
  for (const [id, name] of await memberNames(x, [...memberIds])) out[id] = name;
  if (teamIds.size) for (const t of await x.tx.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, [...teamIds]))) out[t.id] = t.name;
  // Only clients the viewer can see are named; others stay as "another client".
  if (clientIds.size && x.actor.grants['clients:read'])
    for (const c of await x.tx.select({ id: clients.id, name: clients.name }).from(clients).where(and(inArray(clients.id, [...clientIds]), clientFilter(x, 'clients:read', clients.id)))) out[c.id] = c.name;
  return out;
}


