import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  activityWindows,
  billingEntries,
  billingRates,
  breakTypes,
  budgets,
  clientContacts,
  clientPortalAccess,
  clientPortalSettings,
  clients,
  eodReports,
  expenses,
  invoices,
  manualTimeRequests,
  memberships,
  payments,
  presence,
  projectBreaks,
  projectDocuments,
  projectMembers,
  projectTeams,
  projects,
  rollupAppDay,
  rollupWorkerDay,
  taskAssignees,
  tasks,
  teamMembers,
  teams,
  timeEntries,
  timesheetEntries,
  trackingSessions,
  users,
} from '@tallywork/db';
import { can, conflict, forbidden, localDate, newId, notFound, businessRule, validation } from '@tallywork/domain';
import type { ClientDto, OffsetPage, ProjectBreakDto, ProjectDto, TaskDto, TeamDto, clientInput, projectInput, taskInput, teamInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { applyScopedRates, currentScopedRates, rateChanges } from './finance';
import { canOnClient, canOnProject, membershipFilter, projectFilter } from './scope';
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

/**
 * Audit 28 Oct 2026 (A2b): a narrower teams:manage grant than org changes only the teams the actor
 * manages. Creating a team is organization-wide.
 */
function assertCanManageTeam(x: Ctx, teamId: string | null) {
  const scope = x.actor.grants['teams:manage'];
  if (!scope) throw forbidden();
  if (scope === 'org') return;
  if (!teamId) throw forbidden('Your role can’t create teams');
  if (!x.actor.managedTeamIds.includes(teamId)) throw forbidden('You can only change teams you manage');
}

export async function upsertTeam(x: Ctx, teamId: string | null, input: z.infer<typeof teamInput>) {
  assertCanManageTeam(x, teamId);
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
  assertCanManageTeam(x, teamId);
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
  // SEC-7: a team-scope grant can't pull anyone into its team (and so under its reach); it adds only
  // people it already manages through another team. Removing and changing roles stay open.
  if (scope !== 'org' && role !== null && !x.actor.managedMembershipIds.has(membershipId)) {
    const [already] = await x.tx.select({ id: teamMembers.membershipId }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.membershipId, membershipId)));
    if (!already) throw forbidden('You can only add people you already manage; ask an admin to add someone new');
  }
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

/**
 * After a client's currency changes, or a project moves to a client with another currency, no rate in
 * use for them may stay in the old currency: time priced at it could never be invoiced (invoices are in
 * the client's currency). Checked after the request's own rate changes, so changing both together works.
 */
async function assertRatesInCurrency(x: Ctx, currency: string, projectIds: string[], clientId: string | null, what: string): Promise<void> {
  const today = localDate(x.deps.now(), x.org.timezone);
  const ids = projectIds.length ? projectIds : ['00000000-0000-7000-8000-000000000000'];
  const [other] = await x.tx
    .select({ currency: billingRates.currency })
    .from(billingRates)
    .where(
      and(
        ne(billingRates.currency, currency),
        lte(billingRates.effectiveFrom, today),
        or(isNull(billingRates.effectiveTo), gt(billingRates.effectiveTo, today)),
        or(
          clientId ? and(eq(billingRates.scope, 'CLIENT'), eq(billingRates.scopeId, clientId)) : undefined,
          and(eq(billingRates.scope, 'PROJECT'), inArray(billingRates.scopeId, ids)),
          and(eq(billingRates.scope, 'PROJECT_WORKER'), inArray(sql`split_part(${billingRates.scopeId}, ':', 1)`, ids)),
        ),
      ),
    )
    .limit(1);
  if (other) throw businessRule('rates_in_other_currency', `Rates for ${what} are in ${other.currency}. Change them to ${currency} or end them in Rates first, so the time can still be invoiced.`);
}

/** Every id must be an active member of this organization (not removed or suspended): a clear 400, not a database error. */
async function assertActiveMembers(x: Ctx, ids: string[], field: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await x.tx.select({ id: memberships.id }).from(memberships).where(and(inArray(memberships.id, unique), eq(memberships.status, 'ACTIVE')));
  if (found.length !== unique.length) throw validation('Only active members can be added', { errors: [{ field, message: 'Choose people who are active members' }] });
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
  // Count only the projects this person may see (the same rule as the Projects list), so the number
  // matches what "View projects" shows and does not reveal projects they are not on.
  const projectScope = x.actor.grants['projects:read'];
  const assigned = [...x.actor.assignedProjectIds];
  const countable =
    projectScope === 'org' ? sql`` : projectScope && assigned.length ? sql` and p.id in (${sql.join(assigned.map((id) => sql`${id}::uuid`), sql`, `)})` : sql` and false`;
  const rows = await x.tx
    // The outer column is written out: inside the subquery an interpolated ${clients.id} renders as a bare "id", which binds to p.id.
    .select({ c: clients, projectCount: sql<number>`(select count(*)::int from ${projects} p where p.client_id = "clients"."id" and p.archived_at is null${countable})` })
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

/**
 * Create a client, or update one. An update changes only the fields it is given (PATCH): a field left
 * out keeps its value, and `null` clears it.
 */
export async function upsertClient(x: Ctx, clientId: string | null, input: Partial<z.infer<typeof clientInput>>) {
  if (!x.actor.grants['clients:manage']) throw forbidden();
  // A narrower scope than org manages only the clients of the actor's projects.
  if (clientId && !(await canOnClient(x, 'clients:manage', clientId))) throw notFound('client');
  const changes = rateChanges(input);
  if (changes.length && !x.actor.grants['rates:manage']) throw forbidden();
  const fields = {
    email: input.email,
    phone: input.phone,
    address: input.address,
    currency: input.currency,
    notes: input.notes,
    contactName: input.contact_name,
    documentLanguage: input.document_language,
    color: input.color,
    logo: input.logo,
  };
  // Only what was sent (undefined = not sent); `?? null` turns an explicit empty value into a cleared field.
  const values: Partial<typeof clients.$inferInsert> = Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v ?? null]),
  );
  if (input.name !== undefined) values.name = input.name;
  if (input.name !== undefined) {
    // One active client per name (ignoring case and spaces): two "Acme" make invoices and reports ambiguous.
    const [same] = await x.tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(sql`lower(trim(${clients.name})) = lower(trim(${input.name}))`, isNull(clients.archivedAt), clientId ? ne(clients.id, clientId) : undefined))
      .limit(1);
    if (same) throw conflict('duplicate_name', 'A client with this name already exists', { errors: [{ field: 'name', message: 'Use another name, or archive the other client' }] });
  }
  let id = clientId;
  if (id) {
    const r = await x.tx.update(clients).set({ ...values, updatedAt: new Date() }).where(eq(clients.id, id)).returning({ id: clients.id });
    if (!r.length) throw notFound('client');
  } else {
    if (!input.name) throw validation('A client needs a name', { errors: [{ field: 'name', message: 'Required' }] });
    id = newId();
    await x.tx.insert(clients).values({ id, organizationId: x.org.id, name: input.name, ...values });
  }
  const { logo, ...audited } = values;
  await audit(x, { action: clientId ? 'client.updated' : 'client.created', targetType: 'client', targetId: id, after: { ...audited, ...(logo !== undefined ? { logo: logo ? '(image)' : null } : {}) } });

  // Rates are in the client's currency, as saved (a partial update may not send the currency).
  const [saved] = await x.tx.select({ currency: clients.currency }).from(clients).where(eq(clients.id, id));
  await applyScopedRates(x, 'CLIENT', id, changes, saved?.currency ?? x.org.currency);
  if (clientId && input.currency !== undefined) {
    const own = (await x.tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, id))).map((r) => r.id);
    await assertRatesInCurrency(x, saved?.currency ?? x.org.currency, own, id, 'the client and its projects');
  }
  return (await listClients(x, { includeArchived: true })).find((c) => c.id === id)!;
}

export async function setClientArchived(x: Ctx, clientId: string, archived: boolean) {
  if (!(await canOnClient(x, 'clients:manage', clientId))) throw x.actor.grants['clients:manage'] ? notFound('client') : forbidden();
  const [c] = await x.tx.select({ archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('client');
  if (!!c.archivedAt === archived) return; // already so
  // A client's projects go with it, stamped with the same moment, so restoring the client brings back
  // exactly those (a project archived on its own before stays archived). Archived projects take no new
  // time, so tracking for the client stops.
  const at = x.deps.now();
  await x.tx.update(clients).set({ archivedAt: archived ? at : null, updatedAt: at }).where(eq(clients.id, clientId));
  const moved = archived
    ? await x.tx.update(projects).set({ archivedAt: at, updatedAt: at }).where(and(eq(projects.clientId, clientId), isNull(projects.archivedAt))).returning({ id: projects.id })
    : await x.tx.update(projects).set({ archivedAt: null, updatedAt: at }).where(and(eq(projects.clientId, clientId), eq(projects.archivedAt, c.archivedAt!))).returning({ id: projects.id });
  await audit(x, { action: archived ? 'client.archived' : 'client.restored', targetType: 'client', targetId: clientId, metadata: { projects: moved.map((m) => m.id) } });
}

/**
 * Permanently deletes a client that was never used: no invoices, payments or expenses, no time tracked
 * on its projects and no project documents. Its unused projects (with their tasks, members and breaks),
 * its rates, budgets, contacts and portal access go with it. A client with history is refused, so past
 * invoices, pay and reports never change: archive it instead.
 */
export async function deleteClient(x: Ctx, clientId: string) {
  if (!(await canOnClient(x, 'clients:manage', clientId))) throw x.actor.grants['clients:manage'] ? notFound('client') : forbidden();
  const [c] = await x.tx.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('client');
  const projectIds = (await x.tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))).map((p) => p.id);
  const onProjects = (col: Parameters<typeof inArray>[0]) => (projectIds.length ? inArray(col, projectIds) : sql`false`);
  const found = async (q: Promise<unknown[]>) => (await q).length > 0;

  const used: string[] = [];
  if (await found(x.tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, clientId)).limit(1))) used.push('invoices');
  if (await found(x.tx.select({ id: payments.id }).from(payments).where(eq(payments.clientId, clientId)).limit(1))) used.push('payments');
  if (await found(x.tx.select({ id: expenses.id }).from(expenses).where(or(eq(expenses.clientId, clientId), onProjects(expenses.projectId))).limit(1))) used.push('expenses');
  const tracked = [
    x.tx.select({ id: timeEntries.id }).from(timeEntries).where(onProjects(timeEntries.projectId)).limit(1),
    x.tx.select({ id: trackingSessions.id }).from(trackingSessions).where(onProjects(trackingSessions.projectId)).limit(1),
    x.tx.select({ id: manualTimeRequests.id }).from(manualTimeRequests).where(onProjects(manualTimeRequests.projectId)).limit(1),
    x.tx.select({ id: timesheetEntries.id }).from(timesheetEntries).where(onProjects(timesheetEntries.projectId)).limit(1),
    x.tx.select({ id: billingEntries.id }).from(billingEntries).where(or(eq(billingEntries.clientId, clientId), onProjects(billingEntries.projectId))).limit(1),
    x.tx.select({ id: eodReports.id }).from(eodReports).where(onProjects(eodReports.projectId)).limit(1),
    x.tx.select({ p: activityWindows.projectId }).from(activityWindows).where(onProjects(activityWindows.projectId)).limit(1),
    x.tx.select({ p: rollupWorkerDay.projectId }).from(rollupWorkerDay).where(onProjects(rollupWorkerDay.projectId)).limit(1),
    x.tx.select({ p: rollupAppDay.projectId }).from(rollupAppDay).where(onProjects(rollupAppDay.projectId)).limit(1),
    x.tx.select({ p: presence.projectId }).from(presence).where(onProjects(presence.projectId)).limit(1),
  ];
  for (const q of tracked) if (await found(q)) {
    used.push('tracked time');
    break;
  }
  if (await found(x.tx.select({ id: projectDocuments.id }).from(projectDocuments).where(onProjects(projectDocuments.projectId)).limit(1))) used.push('project documents');
  if (used.length) {
    const list = used.length > 1 ? `${used.slice(0, -1).join(', ')} and ${used.at(-1)}` : used[0];
    throw businessRule('client_in_use', `${c.name} has ${list}, so it can't be deleted. Archive it instead: it disappears from lists and its history stays.`, { in_use: used });
  }

  if (projectIds.length) {
    const taskIds = (await x.tx.select({ id: tasks.id }).from(tasks).where(inArray(tasks.projectId, projectIds))).map((t) => t.id);
    if (taskIds.length) await x.tx.delete(taskAssignees).where(inArray(taskAssignees.taskId, taskIds));
    await x.tx.delete(tasks).where(inArray(tasks.projectId, projectIds));
    await x.tx.delete(projectMembers).where(inArray(projectMembers.projectId, projectIds));
    await x.tx.delete(projectTeams).where(inArray(projectTeams.projectId, projectIds));
    await x.tx.delete(projectBreaks).where(inArray(projectBreaks.projectId, projectIds));
    await x.tx.delete(budgets).where(and(eq(budgets.subjectType, 'PROJECT'), inArray(budgets.subjectId, projectIds)));
    // A project rate's scope id is the project; a project-and-worker rate's is "project:membership".
    await x.tx.delete(billingRates).where(or(and(eq(billingRates.scope, 'PROJECT'), inArray(billingRates.scopeId, projectIds)), and(eq(billingRates.scope, 'PROJECT_WORKER'), inArray(sql`split_part(${billingRates.scopeId}, ':', 1)`, projectIds))));
  }
  await x.tx.delete(budgets).where(and(eq(budgets.subjectType, 'CLIENT'), eq(budgets.subjectId, clientId)));
  await x.tx.delete(billingRates).where(and(eq(billingRates.scope, 'CLIENT'), eq(billingRates.scopeId, clientId)));
  await x.tx.delete(clientPortalAccess).where(eq(clientPortalAccess.clientId, clientId));
  await x.tx.delete(clientPortalSettings).where(eq(clientPortalSettings.clientId, clientId));
  await x.tx.delete(clientContacts).where(eq(clientContacts.clientId, clientId));
  await x.tx.delete(projects).where(eq(projects.clientId, clientId));
  await x.tx.delete(clients).where(eq(clients.id, clientId));
  await audit(x, { action: 'client.deleted', targetType: 'client', targetId: clientId, before: { name: c.name }, metadata: { projects: projectIds } });
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
  // A narrower scope than org manages only the projects the actor is assigned to.
  if (projectId && !canOnProject(x.actor, 'projects:manage', projectId)) throw notFound('project');
  const changes = rateChanges(input);
  if (changes.length && !x.actor.grants['rates:manage']) throw forbidden();
  if (input.client_id) {
    const [c] = await x.tx.select({ id: clients.id, archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, input.client_id));
    if (!c) throw notFound('client');
    // An archived client takes no projects (keeping the one a project already has is fine).
    const [current] = projectId ? await x.tx.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, projectId)) : [];
    if (c.archivedAt && current?.clientId !== c.id) throw validation('This client is archived', { errors: [{ field: 'client_id', message: 'Restore the client, or choose one that is in use' }] });
    // Without org scope, only a client the actor can already see: attaching a project to another
    // client would otherwise open that client (and, with clients:manage, its settings) to them.
    if (x.actor.grants['projects:manage'] !== 'org' && !(await canOnClient(x, 'clients:read', input.client_id))) throw notFound('client');
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
  if (input.name !== undefined || input.client_id !== undefined) {
    // One active project per name and client (ignoring case and spaces).
    const [before] = projectId ? await x.tx.select({ name: projects.name, clientId: projects.clientId }).from(projects).where(eq(projects.id, projectId)) : [];
    const name = input.name ?? before?.name ?? '';
    const client = input.client_id !== undefined ? input.client_id : (before?.clientId ?? null);
    const [same] = await x.tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          sql`lower(trim(${projects.name})) = lower(trim(${name}))`,
          client ? eq(projects.clientId, client) : isNull(projects.clientId),
          isNull(projects.archivedAt),
          projectId ? ne(projects.id, projectId) : undefined,
        ),
      )
      .limit(1);
    if (same) throw conflict('duplicate_name', client ? 'This client already has a project with this name' : 'A project with this name already exists', { errors: [{ field: 'name', message: 'Use another name, or archive the other project' }] });
  }
  let id = projectId;
  if (id) {
    // Moving to another client: that client sees the project's work from now on, not what was done for the previous one.
    if (input.client_id !== undefined) {
      const [cur] = await x.tx.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, id));
      if (cur && cur.clientId !== input.client_id) values.clientSince = x.deps.now();
    }
    const r = await x.tx.update(projects).set({ ...values, updatedAt: new Date() }).where(eq(projects.id, id)).returning({ id: projects.id });
    if (!r.length) throw notFound('project');
  } else {
    id = newId();
    await x.tx.insert(projects).values({ id, organizationId: x.org.id, name: input.name, ...values });
  }
  if (input.member_ids) {
    // People being added must be active. Someone already linked who is no longer active (removed before
    // removal also cleared project links) is dropped, as removing them does today, rather than making
    // the whole save fail: the access editor sends every linked id, including ones it cannot show.
    const linked = new Set((await x.tx.select({ m: projectMembers.membershipId }).from(projectMembers).where(eq(projectMembers.projectId, id))).map((r) => r.m));
    const wanted = [...new Set(input.member_ids)];
    const active = new Set(wanted.length ? (await x.tx.select({ id: memberships.id }).from(memberships).where(and(inArray(memberships.id, wanted), eq(memberships.status, 'ACTIVE')))).map((r) => r.id) : []);
    await assertActiveMembers(x, wanted.filter((m) => !linked.has(m)), 'member_ids');
    const keep = wanted.filter((m) => active.has(m));
    await x.tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    if (keep.length) await x.tx.insert(projectMembers).values(keep.map((m) => ({ organizationId: x.org.id, projectId: id!, membershipId: m })));
  }
  if (input.team_ids) {
    const found = input.team_ids.length ? await x.tx.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, input.team_ids), isNull(teams.archivedAt))) : [];
    if (found.length !== new Set(input.team_ids).size) throw validation('Unknown or archived team', { errors: [{ field: 'team_ids', message: 'Choose teams that are in use' }] });
    await x.tx.delete(projectTeams).where(eq(projectTeams.projectId, id));
    if (input.team_ids.length) await x.tx.insert(projectTeams).values(input.team_ids.map((t) => ({ organizationId: x.org.id, projectId: id!, teamId: t })));
  }
  if (input.breaks) await setProjectBreaks(x, id, input.breaks);
  // Rates are in the client's currency when it has one, like the invoices for this project.
  const [row] = await x.tx.select({ cur: clients.currency }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, id));
  if (changes.length) await applyScopedRates(x, 'PROJECT', id, changes, row?.cur ?? x.org.currency);
  if (projectId && input.client_id !== undefined) await assertRatesInCurrency(x, row?.cur ?? x.org.currency, [id], null, 'this project');
  if (!projectId) await emitFrom(x, 'project.created', { project_id: id, name: input.name });
  else await emitFrom(x, 'project.updated', { project_id: id });
  await audit(x, { action: projectId ? 'project.updated' : 'project.created', targetType: 'project', targetId: id, after: input });
  // Freshly assigned projects must be visible to the editor too.
  x.actor.assignedProjectIds.add(id);
  return getProject(x, id);
}

export async function setProjectArchived(x: Ctx, projectId: string, archived: boolean) {
  if (!canOnProject(x.actor, 'projects:manage', projectId)) throw x.actor.grants['projects:manage'] ? notFound('project') : forbidden();
  if (!archived) {
    // An archived client's projects stay archived with it: restore the client (which brings them back).
    const [row] = await x.tx.select({ clientArchivedAt: clients.archivedAt }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, projectId));
    if (row?.clientArchivedAt) throw businessRule('client_archived', 'This project’s client is archived. Restore the client to bring its projects back.');
  }
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
type TaskQuery = {
  projectId?: string;
  status?: string;
  assigneeId?: string;
  /** also archived tasks, and tasks of archived projects */
  includeArchived?: boolean;
  /** only archived tasks (the "Archived" view, to restore them) */
  archivedOnly?: boolean;
  /** only tasks of active projects in use: what can still be tracked (the desktop app) */
  trackableOnly?: boolean;
  mine?: boolean;
  search?: string;
};

/** Tasks the person may see that match the filters; `search` covers the title, description and project. */
function taskWhere(x: Ctx, opts: TaskQuery, withStatus = true) {
  const term = opts.search ? likePattern(opts.search) : null;
  return and(
    eq(tasks.organizationId, x.org.id),
    opts.archivedOnly ? isNotNull(tasks.archivedAt) : opts.includeArchived ? undefined : isNull(tasks.archivedAt),
    // An archived project's tasks leave the lists with it (they come back when it is restored).
    opts.includeArchived || opts.archivedOnly ? undefined : isNull(projects.archivedAt),
    opts.trackableOnly ? eq(projects.status, 'ACTIVE') : undefined,
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
    archived_at: iso(t.archivedAt),
    created_at: t.createdAt.toISOString(),
  }));
}

export async function upsertTask(x: Ctx, projectId: string, taskId: string | null, input: Partial<z.infer<typeof taskInput>> & { title?: string }) {
  const [p] = await x.tx.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound('project');
  if (p.archivedAt) throw businessRule('project_archived', 'This project is archived. Restore it to change its tasks.');
  const canManage = can(x.actor, 'tasks:manage', { projectId });
  const canCreate = canManage || can(x.actor, 'tasks:create', { projectId });
  let id = taskId;
  if (id) {
    const [existing] = await x.tx.select().from(tasks).where(eq(tasks.id, id));
    if (!existing || existing.projectId !== projectId) throw notFound('task');
    if (existing.archivedAt) throw businessRule('task_archived', 'This task is archived. Restore it to change it.');
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
      patch.completedAt = input.status === 'DONE' ? (existing.completedAt ?? x.deps.now()) : null;
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
      // Created as done: it was completed now (like moving it to done later).
      completedAt: input.status === 'DONE' ? x.deps.now() : null,
      priority: input.priority ?? 'MEDIUM',
      dueDate: input.due_date ?? null,
      estimateSeconds: input.estimate_seconds ?? null,
    });
  }
  if (input.assignee_ids) {
    if (!canManage && !canCreate) throw forbidden();
    await assertActiveMembers(x, input.assignee_ids, 'assignee_ids');
    await x.tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
    if (input.assignee_ids.length) await x.tx.insert(taskAssignees).values(input.assignee_ids.map((m) => ({ organizationId: x.org.id, taskId: id!, membershipId: m })));
  }
  await audit(x, { action: taskId ? 'task.updated' : 'task.created', targetType: 'task', targetId: id, after: input });
  const [dto] = (await listTasks(x, { projectId, includeArchived: true })).filter((t) => t.id === id);
  if (!dto) throw notFound('task');
  return dto;
}

/** Bring an archived task back (its project must be in use). */
export async function restoreTask(x: Ctx, taskId: string) {
  const [t] = await x.tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t || !can(x.actor, 'tasks:read', { projectId: t.projectId })) throw notFound('task');
  if (!can(x.actor, 'tasks:manage', { projectId: t.projectId })) throw forbidden();
  const [p] = await x.tx.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, t.projectId));
  if (p?.archivedAt) throw businessRule('project_archived', 'This task’s project is archived. Restore the project first.');
  await x.tx.update(tasks).set({ archivedAt: null, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  await audit(x, { action: 'task.restored', targetType: 'task', targetId: taskId });
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

