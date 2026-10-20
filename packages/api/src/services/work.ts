import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  breakTypes,
  clients,
  memberships,
  projectBreaks,
  projectMembers,
  projectTeams,
  projects,
  rollupWorkerDay,
  taskAssignees,
  tasks,
  teamMembers,
  teams,
  timeEntries,
  users,
} from '@tallywork/db';
import { can, forbidden, newId, notFound, businessRule, validation } from '@tallywork/domain';
import type { ClientDto, OffsetPage, ProjectBreakDto, ProjectDto, TaskDto, TeamDto, clientInput, projectInput, taskInput, teamInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { applyScopedRates, currentScopedRates, rateChanges } from './finance';
import { membershipFilter, projectFilter } from './scope';
import { iso } from '../lib/http';
import { likePattern } from '../lib/search';

// ─── Teams ───────────────────────────────────────────────────────────────────
export async function listTeams(x: Ctx): Promise<TeamDto[]> {
  const scope = x.actor.grants['teams:read'];
  if (!scope) throw forbidden();
  const myTeamIds = (await x.tx.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.membershipId, x.actor.membershipId))).map((r) => r.id);
  const visible = scope === 'org' ? undefined : myTeamIds.length ? inArray(teams.id, myTeamIds) : sql`false`;
  const ts = await x.tx.select().from(teams).where(and(eq(teams.organizationId, x.org.id), isNull(teams.archivedAt), visible)).orderBy(asc(teams.name));
  if (!ts.length) return [];
  const ids = ts.map((t) => t.id);
  const members = await x.tx
    .select({ teamId: teamMembers.teamId, membershipId: teamMembers.membershipId, role: teamMembers.role, name: users.name })
    .from(teamMembers)
    .innerJoin(memberships, eq(memberships.id, teamMembers.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(teamMembers.teamId, ids))
    .orderBy(asc(users.name));
  const pts = await x.tx.select().from(projectTeams).where(inArray(projectTeams.teamId, ids));
  return ts.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    archived_at: iso(t.archivedAt),
    members: members.filter((m) => m.teamId === t.id).map((m) => ({ membership_id: m.membershipId, name: m.name, role: m.role })),
    project_ids: pts.filter((p) => p.teamId === t.id).map((p) => p.projectId),
  }));
}

export async function upsertTeam(x: Ctx, teamId: string | null, input: z.infer<typeof teamInput>) {
  if (!x.actor.grants['teams:manage']) throw forbidden();
  let id = teamId;
  if (id) {
    const r = await x.tx.update(teams).set({ name: input.name, description: input.description ?? null, updatedAt: new Date() }).where(eq(teams.id, id)).returning({ id: teams.id });
    if (!r.length) throw notFound('team');
  } else {
    id = newId();
    await x.tx.insert(teams).values({ id, organizationId: x.org.id, name: input.name, description: input.description ?? null });
  }
  await audit(x, { action: teamId ? 'team.updated' : 'team.created', targetType: 'team', targetId: id, after: input });
  return (await listTeams(x)).find((t) => t.id === id)!;
}

export async function archiveTeam(x: Ctx, teamId: string) {
  if (!x.actor.grants['teams:manage']) throw forbidden();
  await x.tx.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, teamId));
  await x.tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  await audit(x, { action: 'team.archived', targetType: 'team', targetId: teamId });
}

export async function setTeamMember(x: Ctx, teamId: string, membershipId: string, role: 'MANAGER' | 'MEMBER' | null) {
  const scope = x.actor.grants['teams:manage'];
  if (!scope) throw forbidden();
  const [t] = await x.tx.select().from(teams).where(eq(teams.id, teamId));
  if (!t) throw notFound('team');
  // Team-scoped managers may only change teams they manage; nobody edits their own role.
  if (scope !== 'org' && !x.actor.managedTeamIds.includes(teamId)) throw forbidden('You can only change teams you manage');
  if (scope !== 'org' && membershipId === x.actor.membershipId) throw forbidden('You cannot change your own team role');
  const [m] = await x.tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, x.org.id)));
  if (!m) throw notFound('worker');
  if (role === null) {
    await x.tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.membershipId, membershipId)));
  } else {
    await x.tx
      .insert(teamMembers)
      .values({ organizationId: x.org.id, teamId, membershipId, role })
      .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.membershipId], set: { role } });
  }
  await audit(x, { action: role ? 'team.member_set' : 'team.member_removed', targetType: 'team', targetId: teamId, after: { membershipId, role } });
}

// ─── Clients ─────────────────────────────────────────────────────────────────
export async function listClients(x: Ctx, opts: { includeArchived?: boolean } = {}): Promise<ClientDto[]> {
  const scope = x.actor.grants['clients:read'];
  if (!scope) throw forbidden();
  let visible = undefined;
  if (scope !== 'org') {
    const ids = [...x.actor.assignedProjectIds];
    visible = ids.length ? inArray(clients.id, x.tx.select({ id: projects.clientId }).from(projects).where(inArray(projects.id, ids)) as never) : sql`false`;
  }
  const rows = await x.tx
    // The outer column is written out: inside the subquery an interpolated ${clients.id} renders as a bare "id", which binds to p.id.
    .select({ c: clients, projectCount: sql<number>`(select count(*)::int from ${projects} p where p.client_id = "clients"."id" and p.archived_at is null)` })
    .from(clients)
    .where(and(eq(clients.organizationId, x.org.id), opts.includeArchived ? undefined : isNull(clients.archivedAt), visible))
    .orderBy(asc(clients.name));
  const rates = x.actor.grants['rates:read'] ? await currentScopedRates(x, 'CLIENT') : null;
  return rows.map(({ c, projectCount }) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    currency: c.currency,
    notes: c.notes,
    contact_name: c.contactName,
    document_language: c.documentLanguage,
    color: c.color,
    logo: c.logo,
    ...(rates && { bill_rate_minor: rates.get(`BILL:${c.id}`)?.amountMinor ?? null, pay_rate_minor: rates.get(`PAY:${c.id}`)?.amountMinor ?? null }),
    project_count: projectCount,
    archived_at: iso(c.archivedAt),
    created_at: c.createdAt.toISOString(),
  }));
}

export async function upsertClient(x: Ctx, clientId: string | null, input: z.infer<typeof clientInput>) {
  if (!x.actor.grants['clients:manage']) throw forbidden();
  const changes = rateChanges(input);
  if (changes.length && !x.actor.grants['rates:manage']) throw forbidden();
  const values = {
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    currency: input.currency ?? null,
    notes: input.notes ?? null,
    contactName: input.contact_name ?? null,
    documentLanguage: input.document_language ?? null,
    color: input.color ?? null,
    logo: input.logo ?? null,
  };
  let id = clientId;
  if (id) {
    const r = await x.tx.update(clients).set({ ...values, updatedAt: new Date() }).where(eq(clients.id, id)).returning({ id: clients.id });
    if (!r.length) throw notFound('client');
  } else {
    id = newId();
    await x.tx.insert(clients).values({ id, organizationId: x.org.id, ...values });
  }
  const { logo, ...audited } = values;
  await audit(x, { action: clientId ? 'client.updated' : 'client.created', targetType: 'client', targetId: id, after: { ...audited, logo: logo ? '(image)' : null } });

  await applyScopedRates(x, 'CLIENT', id, changes, values.currency ?? x.org.currency);
  return (await listClients(x, { includeArchived: true })).find((c) => c.id === id)!;
}

export async function setClientArchived(x: Ctx, clientId: string, archived: boolean) {
  if (!x.actor.grants['clients:manage']) throw forbidden();
  const r = await x.tx.update(clients).set({ archivedAt: archived ? new Date() : null }).where(eq(clients.id, clientId)).returning({ id: clients.id });
  if (!r.length) throw notFound('client');
  await audit(x, { action: archived ? 'client.archived' : 'client.restored', targetType: 'client', targetId: clientId });
}

// ─── Projects ────────────────────────────────────────────────────────────────
/** Each project's planned breaks, in order. Breaks of an archived break type are left out. */
export async function projectBreaksFor(x: Pick<Ctx, 'tx'>, projectIds: string[]): Promise<Map<string, ProjectBreakDto[]>> {
  const out = new Map<string, ProjectBreakDto[]>();
  if (!projectIds.length) return out;
  const rows = await x.tx
    .select({ b: projectBreaks, name: breakTypes.name, paid: breakTypes.paid, maxMinutes: breakTypes.maxMinutes })
    .from(projectBreaks)
    .innerJoin(breakTypes, eq(breakTypes.id, projectBreaks.breakTypeId))
    .where(and(inArray(projectBreaks.projectId, projectIds), isNull(breakTypes.archivedAt)))
    .orderBy(asc(projectBreaks.position));
  for (const { b, name, paid, maxMinutes } of rows) {
    const list = out.get(b.projectId) ?? [];
    list.push({ break_type_id: b.breakTypeId, name, paid, start_time: b.startTime, duration_minutes: b.durationMinutes ?? maxMinutes });
    out.set(b.projectId, list);
  }
  return out;
}

/** Replace a project's planned breaks; every break type must be one of this organization's, not archived. */
async function setProjectBreaks(x: Ctx, projectId: string, breaks: NonNullable<z.infer<typeof projectInput>['breaks']>) {
  const typeIds = [...new Set(breaks.map((b) => b.break_type_id))];
  if (typeIds.length) {
    const found = await x.tx.select({ id: breakTypes.id }).from(breakTypes).where(and(inArray(breakTypes.id, typeIds), isNull(breakTypes.archivedAt)));
    const known = new Set(found.map((r) => r.id));
    const bad = breaks.findIndex((b) => !known.has(b.break_type_id));
    if (bad >= 0) throw validation('Unknown break type', { errors: [{ field: `breaks.${bad}.break_type_id`, message: 'Pick a break type from Settings' }] });
  }
  await x.tx.delete(projectBreaks).where(eq(projectBreaks.projectId, projectId));
  if (breaks.length)
    await x.tx.insert(projectBreaks).values(
      breaks.map((b, i) => ({ id: newId(), organizationId: x.org.id, projectId, breakTypeId: b.break_type_id, startTime: b.start_time ?? null, durationMinutes: b.duration_minutes ?? null, position: i })),
    );
}

export async function listProjects(x: Ctx, opts: { includeArchived?: boolean; clientId?: string; ids?: string[] } = {}): Promise<ProjectDto[]> {
  const rows = await x.tx
    .select({ p: projects, clientName: clients.name, clientCurrency: clients.currency })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        eq(projects.organizationId, x.org.id),
        opts.includeArchived ? undefined : isNull(projects.archivedAt),
        opts.clientId ? eq(projects.clientId, opts.clientId) : undefined,
        opts.ids ? inArray(projects.id, opts.ids.length ? opts.ids : ['00000000-0000-7000-8000-000000000000']) : undefined,
        projectFilter(x.actor, 'projects:read', projects.id),
      ),
    )
    .orderBy(asc(projects.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const pm = await x.tx.select().from(projectMembers).where(inArray(projectMembers.projectId, ids));
  const pt = await x.tx.select().from(projectTeams).where(inArray(projectTeams.projectId, ids));
  const tracked = await x.tx
    .select({
      projectId: rollupWorkerDay.projectId,
      s: sql<number>`coalesce(sum(${rollupWorkerDay.trackedSeconds} + ${rollupWorkerDay.manualSeconds}),0)::int`,
      b: sql<number>`coalesce(sum(${rollupWorkerDay.trackedSeconds} + ${rollupWorkerDay.manualSeconds}) filter (where ${rollupWorkerDay.billable}),0)::int`,
    })
    .from(rollupWorkerDay)
    .where(inArray(rollupWorkerDay.projectId, ids))
    .groupBy(rollupWorkerDay.projectId);
  const trackedMap = new Map(tracked.map((t) => [t.projectId, t]));
  const rates = x.actor.grants['rates:read'] ? await currentScopedRates(x, 'PROJECT') : null;
  const breaks = await projectBreaksFor(x, ids);
  return rows.map(({ p, clientName, clientCurrency }) => ({
    id: p.id,
    name: p.name,
    client_id: p.clientId,
    client_name: clientName,
    description: p.description,
    color: p.color,
    status: p.status,
    billable_default: p.billableDefault,
    member_ids: pm.filter((m) => m.projectId === p.id).map((m) => m.membershipId),
    team_ids: pt.filter((t) => t.projectId === p.id).map((t) => t.teamId),
    archived_at: iso(p.archivedAt),
    tracked_seconds: trackedMap.get(p.id)?.s ?? 0,
    billable_seconds: trackedMap.get(p.id)?.b ?? 0,
    short_name: p.shortName,
    start_date: p.startDate,
    end_date: p.endDate,
    estimate_seconds: p.estimateSeconds,
    estimate_unit: p.estimateUnit,
    currency: clientCurrency ?? x.org.currency,
    ...(rates && { pay_rate_minor: rates.get(`PAY:${p.id}`)?.amountMinor ?? null, bill_rate_minor: rates.get(`BILL:${p.id}`)?.amountMinor ?? null }),
    breaks: breaks.get(p.id) ?? [],
    created_at: p.createdAt.toISOString(),
  }));
}

export async function getProject(x: Ctx, projectId: string): Promise<ProjectDto> {
  const [p] = await listProjects(x, { includeArchived: true, ids: [projectId] });
  if (!p) throw notFound('project');
  return p;
}

export async function upsertProject(x: Ctx, projectId: string | null, input: z.infer<typeof projectInput>) {
  if (!x.actor.grants['projects:manage']) throw forbidden();
  const changes = rateChanges(input);
  if (changes.length && !x.actor.grants['rates:manage']) throw forbidden();
  if (input.client_id) {
    const [c] = await x.tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.client_id));
    if (!c) throw notFound('client');
  }
  if (input.start_date && input.end_date && input.end_date < input.start_date) throw validation('The end date is before the start date', { errors: [{ field: 'end_date', message: 'Must be on or after the start date' }] });
  const values: Partial<typeof projects.$inferInsert> = {};
  if (input.short_name !== undefined) values.shortName = input.short_name || null;
  if (input.start_date !== undefined) values.startDate = input.start_date;
  if (input.end_date !== undefined) values.endDate = input.end_date;
  if (input.estimate_seconds !== undefined) values.estimateSeconds = input.estimate_seconds;
  if (input.estimate_unit !== undefined) values.estimateUnit = input.estimate_unit;
  if (input.name !== undefined) values.name = input.name;
  if (input.client_id !== undefined) values.clientId = input.client_id;
  if (input.description !== undefined) values.description = input.description;
  if (input.color !== undefined) values.color = input.color;
  if (input.status !== undefined) values.status = input.status;
  if (input.billable_default !== undefined) values.billableDefault = input.billable_default;
  let id = projectId;
  if (id) {
    const r = await x.tx.update(projects).set({ ...values, updatedAt: new Date() }).where(eq(projects.id, id)).returning({ id: projects.id });
    if (!r.length) throw notFound('project');
  } else {
    id = newId();
    await x.tx.insert(projects).values({ id, organizationId: x.org.id, name: input.name, ...values });
  }
  if (input.member_ids) {
    await x.tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    if (input.member_ids.length) await x.tx.insert(projectMembers).values(input.member_ids.map((m) => ({ organizationId: x.org.id, projectId: id!, membershipId: m })));
  }
  if (input.team_ids) {
    await x.tx.delete(projectTeams).where(eq(projectTeams.projectId, id));
    if (input.team_ids.length) await x.tx.insert(projectTeams).values(input.team_ids.map((t) => ({ organizationId: x.org.id, projectId: id!, teamId: t })));
  }
  if (input.breaks) await setProjectBreaks(x, id, input.breaks);
  if (changes.length) {
    // Rates are in the client's currency when it has one, like the invoices for this project.
    const [row] = await x.tx.select({ cur: clients.currency }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, id));
    await applyScopedRates(x, 'PROJECT', id, changes, row?.cur ?? x.org.currency);
  }
  if (!projectId) await emitFrom(x, 'project.created', { project_id: id, name: input.name });
  else await emitFrom(x, 'project.updated', { project_id: id });
  await audit(x, { action: projectId ? 'project.updated' : 'project.created', targetType: 'project', targetId: id, after: input });
  // Freshly assigned projects must be visible to the editor too.
  x.actor.assignedProjectIds.add(id);
  return getProject(x, id);
}

export async function setProjectArchived(x: Ctx, projectId: string, archived: boolean) {
  if (!x.actor.grants['projects:manage']) throw forbidden();
  const r = await x.tx.update(projects).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(projects.id, projectId)).returning({ id: projects.id });
  if (!r.length) throw notFound('project');
  await audit(x, { action: archived ? 'project.archived' : 'project.restored', targetType: 'project', targetId: projectId });
}

/** Can this worker track time to this project? (direct member or via a team) */
export async function workerCanTrackProject(x: Pick<Ctx, 'tx'>, membershipId: string, projectId: string): Promise<boolean> {
  const direct = await x.tx.select({ id: projectMembers.projectId }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.membershipId, membershipId))).limit(1);
  if (direct.length) return true;
  const viaTeam = await x.tx
    .select({ id: projectTeams.projectId })
    .from(projectTeams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projectTeams.teamId))
    .where(and(eq(projectTeams.projectId, projectId), eq(teamMembers.membershipId, membershipId)))
    .limit(1);
  return viaTeam.length > 0;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
type TaskQuery = { projectId?: string; status?: string; assigneeId?: string; includeArchived?: boolean; mine?: boolean; search?: string };

/** Tasks the person may see that match the filters; `search` covers the title, description and project. */
function taskWhere(x: Ctx, opts: TaskQuery, withStatus = true) {
  const term = opts.search ? likePattern(opts.search) : null;
  return and(
    eq(tasks.organizationId, x.org.id),
    opts.includeArchived ? undefined : isNull(tasks.archivedAt),
    opts.projectId ? eq(tasks.projectId, opts.projectId) : undefined,
    withStatus && opts.status ? eq(tasks.status, opts.status as 'TODO') : undefined,
    opts.assigneeId || opts.mine
      ? inArray(tasks.id, x.tx.select({ id: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.membershipId, opts.assigneeId ?? x.actor.membershipId)) as never)
      : undefined,
    term ? or(ilike(tasks.title, term), ilike(tasks.description, term), ilike(projects.name, term)) : undefined,
    projectFilter(x.actor, 'tasks:read', tasks.projectId),
  );
}

const taskOrder = [asc(tasks.status), desc(tasks.priority), asc(tasks.createdAt), asc(tasks.id)];

/** Tasks as a plain array, capped at 2000; use `pageTasks` to reach every task. */
export async function listTasks(x: Ctx, opts: TaskQuery = {}): Promise<TaskDto[]> {
  const rows = await x.tx.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(taskWhere(x, opts)).orderBy(...taskOrder).limit(2000);
  return toTaskDtos(x, rows);
}

/** One numbered page of tasks (`page` is 1-based), the total, and how many there are per status. */
export async function pageTasks(x: Ctx, q: TaskQuery & { page: number; pageSize: number }): Promise<OffsetPage<TaskDto> & { summary: { counts: Record<string, number> } }> {
  const byStatus = await x.tx
    .select({ status: tasks.status, n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(taskWhere(x, q, false))
    .groupBy(tasks.status);
  const rows = await x.tx
    .select({ t: tasks, projectName: projects.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(taskWhere(x, q))
    .orderBy(...taskOrder)
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const counts: Record<string, number> = { ALL: 0 };
  for (const r of byStatus) {
    counts[r.status] = r.n;
    counts.ALL! += r.n;
  }
  return { data: await toTaskDtos(x, rows), total: q.status ? (counts[q.status] ?? 0) : counts.ALL!, page: q.page, page_size: q.pageSize, summary: { counts } };
}

async function toTaskDtos(x: Ctx, rows: Array<{ t: typeof tasks.$inferSelect; projectName: string }>): Promise<TaskDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.t.id);
  const as = await x.tx.select().from(taskAssignees).where(inArray(taskAssignees.taskId, ids));
  const tracked = await x.tx
    .select({ taskId: timeEntries.taskId, s: sql<number>`coalesce(sum(${timeEntries.durationSeconds}),0)::int` })
    .from(timeEntries)
    .where(and(inArray(timeEntries.taskId, ids), isNull(timeEntries.deletedAt)))
    .groupBy(timeEntries.taskId);
  const tmap = new Map(tracked.map((t) => [t.taskId, t.s]));
  return rows.map(({ t, projectName }) => ({
    id: t.id,
    project_id: t.projectId,
    project_name: projectName,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    due_date: t.dueDate,
    estimate_seconds: t.estimateSeconds,
    tracked_seconds: tmap.get(t.id) ?? 0,
    assignee_ids: as.filter((a) => a.taskId === t.id).map((a) => a.membershipId),
    completed_at: iso(t.completedAt),
    created_at: t.createdAt.toISOString(),
  }));
}

export async function upsertTask(x: Ctx, projectId: string, taskId: string | null, input: Partial<z.infer<typeof taskInput>> & { title?: string }) {
  const [p] = await x.tx.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound('project');
  const canManage = can(x.actor, 'tasks:manage', { projectId });
  const canCreate = canManage || can(x.actor, 'tasks:create', { projectId });
  let id = taskId;
  if (id) {
    const [existing] = await x.tx.select().from(tasks).where(eq(tasks.id, id));
    if (!existing || existing.projectId !== projectId) throw notFound('task');
    const assignees = await x.tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, id));
    const isAssignee = assignees.some((a) => a.membershipId === x.actor.membershipId);
    // Assignees without manage rights may only move status.
    const onlyStatus = Object.keys(input).every((k) => k === 'status');
    if (!canManage && !(isAssignee && onlyStatus)) throw forbidden();
    const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.completedAt = input.status === 'DONE' ? existing.completedAt ?? new Date() : null;
    }
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.due_date !== undefined) patch.dueDate = input.due_date;
    if (input.estimate_seconds !== undefined) patch.estimateSeconds = input.estimate_seconds;
    await x.tx.update(tasks).set(patch).where(eq(tasks.id, id));
  } else {
    if (!canCreate) throw forbidden();
    if (!input.title) throw businessRule('title_required', 'A task needs a title');
    id = newId();
    await x.tx.insert(tasks).values({
      id,
      organizationId: x.org.id,
      projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'TODO',
      priority: input.priority ?? 'MEDIUM',
      dueDate: input.due_date ?? null,
      estimateSeconds: input.estimate_seconds ?? null,
    });
  }
  if (input.assignee_ids) {
    if (!canManage && !canCreate) throw forbidden();
    await x.tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
    if (input.assignee_ids.length) await x.tx.insert(taskAssignees).values(input.assignee_ids.map((m) => ({ organizationId: x.org.id, taskId: id!, membershipId: m })));
  }
  await audit(x, { action: taskId ? 'task.updated' : 'task.created', targetType: 'task', targetId: id, after: input });
  const [dto] = (await listTasks(x, { projectId, includeArchived: true })).filter((t) => t.id === id);
  if (!dto) throw notFound('task');
  return dto;
}

export async function archiveTask(x: Ctx, taskId: string) {
  const [t] = await x.tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t) throw notFound('task');
  if (!can(x.actor, 'tasks:manage', { projectId: t.projectId })) throw forbidden();
  await x.tx.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, taskId));
  await audit(x, { action: 'task.archived', targetType: 'task', targetId: taskId });
}

/** Projects + tasks a worker can track to (used by timer UIs and the agent). */
export async function assignmentsFor(x: Pick<Ctx, 'tx'>, organizationId: string, membershipId: string) {
  const direct = x.tx.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.membershipId, membershipId));
  const viaTeam = x.tx
    .select({ id: projectTeams.projectId })
    .from(projectTeams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projectTeams.teamId))
    .where(eq(teamMembers.membershipId, membershipId));
  const ids = [...new Set([...(await direct), ...(await viaTeam)].map((r) => r.id))];
  if (!ids.length) return [];
  const ps = await x.tx
    .select({ p: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, ids), isNull(projects.archivedAt), eq(projects.status, 'ACTIVE')))
    .orderBy(asc(projects.name));
  const ts = ps.length
    ? await x.tx
        .select()
        .from(tasks)
        .where(and(inArray(tasks.projectId, ps.map((p) => p.p.id)), isNull(tasks.archivedAt), sql`${tasks.status} <> 'DONE'`))
        .orderBy(asc(tasks.title))
    : [];
  const breaks = await projectBreaksFor(x, ps.map((p) => p.p.id));
  return ps.map(({ p, clientName }) => ({
    project_id: p.id,
    project_name: p.name,
    color: p.color,
    client_name: clientName,
    billable_default: p.billableDefault,
    tasks: ts.filter((t) => t.projectId === p.id).map((t) => ({ id: t.id, title: t.title, status: t.status })),
    breaks: breaks.get(p.id) ?? [],
  }));
}

