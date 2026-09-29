import { and, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  auditLogs,
  clientPortalAccess,
  clientPortalSettings,
  clients,
  DEFAULT_PORTAL_SECTIONS,
  memberships,
  organizations,
  projects,
  rollupWorkerDay,
  screenshots,
  taskAssignees,
  tasks,
  timeEntries,
  users,
  withSystem,
  withTenant,
  workerProfiles,
  type ClientPortalSections,
  type Tx,
} from '@tallywork/db';
import { businessRule, forbidden, newId, notFound } from '@tallywork/domain';
import type { clientPortalAcceptInput, ClientVisibilityDto, PortalListItemDto, PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import type { z } from 'zod';
import type { Deps } from '../context';
import { sha256 } from '../lib/crypto';
import { mediaUrl } from './activity';
import { createUser, findUserByEmail } from './identity';
import { budgetStatuses } from './finance';
import { loadOrg } from '../middleware/tenant';

/** Accept a client portal invitation: links (or creates) the viewer's account. Never a membership. */
export async function acceptPortalInvitation(deps: Deps, input: z.infer<typeof clientPortalAcceptInput>, currentUserId: string | null) {
  const invalid = businessRule('invalid_invitation', 'This invitation is invalid or has expired');
  const inv = await withSystem(deps.db, async (tx) => {
    const [a] = await tx
      .select()
      .from(clientPortalAccess)
      .where(and(eq(clientPortalAccess.inviteTokenHash, sha256(input.token)), eq(clientPortalAccess.status, 'INVITED'), gt(clientPortalAccess.inviteExpiresAt, deps.now())))
      .limit(1);
    return a ?? null;
  });
  if (!inv) throw invalid;

  let newAccount: { name: string; email: string; password: string } | null = null;
  if (currentUserId) {
    const [me] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, currentUserId)).limit(1);
    if (!me || me.email.toLowerCase() !== inv.email) throw businessRule('invitation_email_mismatch', `This invitation was sent to ${inv.email}`);
  } else if (await findUserByEmail(deps.db, inv.email)) {
    throw businessRule('login_required', 'Sign in with your existing account to open this dashboard');
  } else {
    if (!input.password) throw businessRule('password_required', 'Choose a password to create your account');
    newAccount = { name: input.name ?? inv.name ?? inv.email.split('@')[0]!, email: inv.email, password: input.password };
  }
  // One transaction: create the account (if any) and claim the invitation only while it is still the same
  // pending, unexpired invite. A concurrent accept, a revoke or a re-issue in between makes the conditional
  // UPDATE match nothing, which throws and rolls the new account back, so no orphan user is left behind.
  const userId = await withSystem(deps.db, async (tx) => {
    // The emailed link proves the address, so the account starts verified.
    const uid = newAccount ? await createUser(tx, { ...newAccount, verified: true }) : currentUserId!;
    const claimed = await tx
      .update(clientPortalAccess)
      .set({ status: 'ACTIVE', userId: uid, acceptedAt: deps.now(), inviteTokenHash: null, inviteExpiresAt: null })
      .where(
        and(
          eq(clientPortalAccess.id, inv.id),
          eq(clientPortalAccess.status, 'INVITED'),
          eq(clientPortalAccess.inviteTokenHash, sha256(input.token)),
          gt(clientPortalAccess.inviteExpiresAt, deps.now()),
        ),
      )
      .returning({ id: clientPortalAccess.id });
    if (!claimed.length) throw invalid;
    return uid;
  });
  return { accessId: inv.id, userId, created: newAccount !== null };
}

export interface PortalAccess {
  accessId: string | null;
  organizationId: string;
  clientId: string;
  sections: ClientPortalSections;
  projectIds: string[];
  /** This request's context for the client audit row (set by the viewer routes; absent for previews). */
  request?: PortalRequestMeta;
}

export interface PortalRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** The included projects: the selection, limited to projects the client still owns. */
export async function includedProjects(tx: Tx, clientId: string, selected: string[] | null): Promise<string[]> {
  const own = (await tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))).map((p) => p.id);
  return selected ? own.filter((id) => selected.includes(id)) : own;
}

/** Clients whose enabled portal shares activity or screenshots from projects this worker has time on. */
export async function clientVisibilityFor(tx: Tx, membershipId: string): Promise<ClientVisibilityDto> {
  const rows = await tx
    .selectDistinct({ clientId: clients.id, clientName: clients.name, sections: clientPortalSettings.sections, projectIds: clientPortalSettings.projectIds, projectId: rollupWorkerDay.projectId })
    .from(rollupWorkerDay)
    .innerJoin(projects, eq(projects.id, rollupWorkerDay.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(clientPortalSettings, eq(clientPortalSettings.clientId, clients.id))
    .where(and(eq(rollupWorkerDay.membershipId, membershipId), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt)));
  const out = new Map<string, { client_name: string; activity: boolean; screenshots: boolean }>();
  for (const r of rows) {
    if (r.projectIds && !r.projectIds.includes(r.projectId)) continue;
    const s = { ...DEFAULT_PORTAL_SECTIONS, ...r.sections };
    if (!s.activity && !s.screenshots) continue;
    out.set(r.clientId, { client_name: r.clientName, activity: s.activity, screenshots: s.screenshots });
  }
  return { clients: [...out.values()].sort((a, b) => a.client_name.localeCompare(b.client_name)) };
}

export async function listMyPortals(deps: Deps, userId: string): Promise<PortalListItemDto[]> {
  const rows = await withSystem(deps.db, (tx) =>
    tx
      .select({ accessId: clientPortalAccess.id, organizationName: organizations.name, clientName: clients.name })
      .from(clientPortalAccess)
      .innerJoin(organizations, eq(organizations.id, clientPortalAccess.organizationId))
      .innerJoin(clients, eq(clients.id, clientPortalAccess.clientId))
      .innerJoin(clientPortalSettings, and(eq(clientPortalSettings.organizationId, clientPortalAccess.organizationId), eq(clientPortalSettings.clientId, clientPortalAccess.clientId)))
      .where(and(eq(clientPortalAccess.userId, userId), eq(clientPortalAccess.status, 'ACTIVE'), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt))),
  );
  return rows.map((r) => ({ access_id: r.accessId, organization_name: r.organizationName, client_name: r.clientName }));
}

/** Only the viewer's own ACTIVE access to an enabled portal of a non-archived client; anything else is 404. */
export async function loadPortalAccess(deps: Deps, userId: string, accessId: string): Promise<PortalAccess> {
  const [a] = await withSystem(deps.db, (tx) =>
    tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.id, accessId), eq(clientPortalAccess.userId, userId), eq(clientPortalAccess.status, 'ACTIVE'))).limit(1),
  );
  if (!a) throw notFound('dashboard');
  return withTenant(deps.db, a.organizationId, async (tx) => {
    const [s] = await tx.select().from(clientPortalSettings).where(eq(clientPortalSettings.clientId, a.clientId));
    const [c] = await tx.select({ archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, a.clientId));
    if (!s?.enabled || !c || c.archivedAt) throw notFound('dashboard');
    return { accessId: a.id, organizationId: a.organizationId, clientId: a.clientId, sections: { ...DEFAULT_PORTAL_SECTIONS, ...s.sections }, projectIds: await includedProjects(tx, a.clientId, s.projectIds) };
  });
}

export async function logPortalView(tx: Tx, access: PortalAccess, action: string, metadata: Record<string, unknown> = {}) {
  if (!access.accessId) return; // admin preview: no client viewed it, so there is nothing to write a client audit row for
  const r = access.request;
  await tx.insert(auditLogs).values({
    id: newId(),
    organizationId: access.organizationId,
    actorType: 'client',
    actorId: access.accessId,
    action,
    targetType: 'client',
    targetId: access.clientId,
    metadata,
    // Same request context the `audit()` helper records (services/events.ts).
    ipAddress: r?.ip ?? null,
    userAgent: r?.userAgent?.slice(0, 300) ?? null,
    requestId: r?.requestId ?? null,
  });
  // `new Date()` here (not `deps.now()`): this is reached via `portalSummaryTx(tx, ...)`, which only has `tx`,
  // not `deps` — the admin-preview caller (routes/org.ts) reuses its open tx and never threads deps through.
  // Matches the existing `audit()` helper (services/events.ts), which also stamps with `new Date()`.
  await tx.update(clientPortalAccess).set({ lastViewedAt: new Date() }).where(eq(clientPortalAccess.id, access.accessId));
}

/**
 * `portalSummary` is called both from the viewer route (no transaction open yet) and from the
 * admin preview route (already inside the org route's tenant transaction, via `ctx(c).tx`).
 * Opening a second `withTenant` transaction from inside the first deadlocks on the single-connection
 * PGlite test driver, so the summary logic runs against a supplied `tx` and `portalSummary` only
 * wraps one for callers that do not already have one.
 */
export async function portalSummary(deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalSummaryDto> {
  return withTenant(deps.db, access.organizationId, (tx) => portalSummaryTx(tx, access, range));
}

export async function portalSummaryTx(tx: Tx, access: PortalAccess, range: { from: string; to: string }): Promise<PortalSummaryDto> {
    const [org] = await tx.select({ id: organizations.id, name: organizations.name, currency: organizations.currency }).from(organizations).where(eq(organizations.id, access.organizationId));
    const [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, access.clientId));
    const ids = access.projectIds;
    const none = ids.length === 0;
    const projectRows = none ? [] : await tx.select({ id: projects.id, name: projects.name, color: projects.color, status: projects.status }).from(projects).where(inArray(projects.id, ids)).orderBy(projects.name);
    const rollups = none
      ? []
      : await tx
          .select()
          .from(rollupWorkerDay)
          .where(and(inArray(rollupWorkerDay.projectId, ids), gte(rollupWorkerDay.localDate, range.from), lte(rollupWorkerDay.localDate, range.to)));

    const byProject = new Map<string, number>();
    const byDay = new Map<string, number>();
    const byWorker = new Map<string, { tracked: number; manual: number; active: number; activityTracked: number; tasks: Map<string, number> }>();
    const totals = { tracked_seconds: 0, manual_seconds: 0, billable_seconds: 0 };
    for (const r of rollups) {
      const secs = r.trackedSeconds + r.manualSeconds;
      totals.tracked_seconds += r.trackedSeconds;
      totals.manual_seconds += r.manualSeconds;
      if (r.billable) totals.billable_seconds += secs;
      byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + secs);
      byDay.set(r.localDate, (byDay.get(r.localDate) ?? 0) + secs);
      const w = byWorker.get(r.membershipId) ?? { tracked: 0, manual: 0, active: 0, activityTracked: 0, tasks: new Map() };
      w.tracked += r.trackedSeconds;
      w.manual += r.manualSeconds;
      w.active += r.activeSeconds;
      w.activityTracked += r.activityTrackedSeconds;
      w.tasks.set(r.taskKey, (w.tasks.get(r.taskKey) ?? 0) + secs);
      byWorker.set(r.membershipId, w);
    }

    const taskRows = none
      ? []
      : await tx
          .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, estimateSeconds: tasks.estimateSeconds })
          .from(tasks)
          .where(and(inArray(tasks.projectId, ids), isNull(tasks.archivedAt)))
          .orderBy(tasks.status, tasks.dueDate);
    const taskTitle = new Map(taskRows.map((t) => [t.id, t.title]));

    const assigneeRows = taskRows.length
      ? await tx.select({ taskId: taskAssignees.taskId, membershipId: taskAssignees.membershipId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskRows.map((t) => t.id)))
      : [];
    const people = [...new Set([...byWorker.keys(), ...assigneeRows.map((a) => a.membershipId)])];
    const names = people.length
      ? await tx
          .select({ id: memberships.id, name: users.name, title: workerProfiles.title })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
          .where(inArray(memberships.id, people))
      : [];
    const person = new Map(names.map((n) => [n.id, n]));

    // Time per task over the whole project history (progress vs estimate), not only the range.
    const taskTime = taskRows.length
      ? await tx
          .select({ taskId: timeEntries.taskId, secs: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
          .from(timeEntries)
          .where(and(inArray(timeEntries.taskId, taskRows.map((t) => t.id)), isNull(timeEntries.deletedAt)))
          .groupBy(timeEntries.taskId)
      : [];
    const trackedByTask = new Map(taskTime.map((t) => [t.taskId, t.secs]));

    const budgets = (await budgetStatuses(tx, org!.currency, range.to, { subjectIds: ids })).filter((b) => b.kind === 'HOURS' && b.subject_type === 'PROJECT');
    const budgetOf = new Map(budgets.map((b) => [b.subject_id, { amount_seconds: b.amount, used_seconds: b.spent, pct_used: b.pct_used }]));

    const s = access.sections;
    await logPortalView(tx, access, 'client_portal.viewed', { from: range.from, to: range.to });
    return {
      access_id: access.accessId,
      organization: { id: org!.id, name: org!.name },
      client: { id: client!.id, name: client!.name },
      sections: s,
      range,
      totals,
      projects: projectRows.map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status, tracked_seconds: byProject.get(p.id) ?? 0, budget: s.tasks ? (budgetOf.get(p.id) ?? null) : null })),
      workers: s.hours
        ? [...byWorker.entries()]
            .map(([id, w]) => ({
              membership_id: id,
              name: person.get(id)?.name ?? 'Former member',
              title: person.get(id)?.title ?? null,
              tracked_seconds: w.tracked,
              manual_seconds: w.manual,
              activity_pct: s.activity && w.activityTracked > 0 ? Math.round((w.active / w.activityTracked) * 100) : null,
              tasks: [...w.tasks.entries()].map(([key, seconds]) => ({ task_id: key || null, title: key ? (taskTitle.get(key) ?? 'Archived task') : 'No task', seconds })).sort((a, b) => b.seconds - a.seconds),
            }))
            .sort((a, b) => b.tracked_seconds + b.manual_seconds - (a.tracked_seconds + a.manual_seconds))
        : null,
      days: s.hours ? [...byDay.entries()].map(([date, seconds]) => ({ date, seconds })).sort((a, b) => a.date.localeCompare(b.date)) : null,
      tasks: s.tasks
        ? taskRows.map((t) => ({
            id: t.id,
            project_id: t.projectId,
            title: t.title,
            status: t.status,
            priority: t.priority,
            due_date: t.dueDate,
            estimate_seconds: t.estimateSeconds,
            tracked_seconds: trackedByTask.get(t.id) ?? 0,
            assignees: assigneeRows.filter((a) => a.taskId === t.id).map((a) => person.get(a.membershipId)?.name ?? 'Former member'),
          }))
        : null,
    };
}

/**
 * Screenshots captured while the worker tracked time on one of the client's included projects
 * (Controller Ruling 6): joined to `time_entries` by `session_id`, with capture time inside the
 * entry's [started_at, ended_at] window, so only desktop-tracked entries (which carry a session id)
 * can ever surface a screenshot — manual time never does.
 *
 * Same split as `portalSummary`/`portalSummaryTx` above: the viewer route has no transaction open
 * yet, while the admin preview route reuses the org route's already-open tenant transaction.
 */
export async function portalScreenshots(deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalScreenshotDto[]> {
  return withTenant(deps.db, access.organizationId, (tx) => portalScreenshotsTx(tx, deps, access, range));
}

export async function portalScreenshotsTx(tx: Tx, deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalScreenshotDto[]> {
  if (!access.sections.screenshots) throw forbidden('Screenshots are not shared on this dashboard');
  if (!access.projectIds.length) return [];
  const org = await loadOrg(tx, access.organizationId);
  const rows = await tx
    .select({ id: screenshots.id, capturedAt: screenshots.capturedAt, storageKey: screenshots.storageKey, blurred: screenshots.blurred, projectId: timeEntries.projectId, worker: users.name })
    .from(screenshots)
    .innerJoin(
      timeEntries,
      and(
        eq(timeEntries.sessionId, screenshots.sessionId),
        isNull(timeEntries.deletedAt),
        lte(timeEntries.startedAt, screenshots.capturedAt),
        // Exclusive end: a screenshot captured exactly where two adjacent entries of the same
        // session meet belongs to the entry that starts there, not the one that just ended —
        // closing both ends would double-count it.
        gt(timeEntries.endedAt, screenshots.capturedAt),
        inArray(timeEntries.projectId, access.projectIds),
      ),
    )
    .innerJoin(memberships, eq(memberships.id, screenshots.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(isNull(screenshots.deletedAt), gte(timeEntries.localDate, range.from), lte(timeEntries.localDate, range.to)))
    .orderBy(desc(screenshots.capturedAt))
    .limit(200);
  const media = { deps, org };
  await logPortalView(tx, access, 'client_portal.screenshots_viewed', { count: rows.length, from: range.from, to: range.to });
  return rows.map((s) => ({ id: s.id, captured_at: s.capturedAt.toISOString(), worker_name: s.worker, project_id: s.projectId, blurred: s.blurred, thumb_url: mediaUrl(media, s.storageKey, 'thumb'), full_url: mediaUrl(media, s.storageKey) }));
}
