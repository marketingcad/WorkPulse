import { and, desc, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  achievementDefinitions,
  clientAppreciations,
  clients,
  memberships,
  organizations,
  projectMembers,
  projectMilestones,
  projects,
  tasks,
  users,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, businessRule, can, forbidden, localDate, newId, notFound, periodBounds, ratioScore } from '@tallywork/domain';
import { finishForecast } from '@tallywork/domain/insights';
import type { appreciationInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { ensureBuiltinAchievements, grantAutomatic, projectMemberIds } from './achievements';
import { audit, emitFrom } from './events';
import { membersWith, notify } from './notify';
import { logPortalView, type PortalAccess } from './portal';
import { memberNames } from './timer';
import { iso } from '../lib/http';

/**
 * Client Insights (client portal). Only the client's own included projects, and only delivery facts:
 * completion, tasks, milestones a manager marked client-visible, and weekly progress. Never money,
 * rates, rankings, reviews, screenshots or anyone's activity. Work done before a project moved to this
 * client stays out (projects.client_since).
 */
export async function portalInsights(deps: Deps, access: PortalAccess) {
  return withTenant(deps.db, access.organizationId, (tx) => portalInsightsTx(tx, deps, access));
}

export async function portalInsightsTx(tx: Tx, deps: Deps, access: PortalAccess) {
  const { insights } = await portalInsightsFacts(tx, deps, access);
  await logPortalView(tx, access, 'portal.insights_viewed');
  return insights;
}

/** The portal's delivery facts, without recording a view (the caller does). */
export async function portalInsightsFacts(tx: Tx, deps: Deps, access: PortalAccess) {
  const [org] = await tx.select({ timezone: organizations.timezone, weekStart: organizations.weekStart }).from(organizations).where(eq(organizations.id, access.organizationId));
  const tz = org!.timezone;
  const today = localDate(deps.now(), tz);
  const ids = access.projectIds;
  const projectRows = ids.length ? await tx.select({ id: projects.id, name: projects.name, status: projects.status, color: projects.color }).from(projects).where(inArray(projects.id, ids)).orderBy(projects.name) : [];
  const since = (pid: string) => access.since.get(pid) ?? null;
  const taskRows = ids.length && access.sections.tasks ? await tx.select({ projectId: tasks.projectId, status: tasks.status, completedAt: tasks.completedAt, dueDate: tasks.dueDate, createdAt: tasks.createdAt }).from(tasks).where(and(inArray(tasks.projectId, ids), isNull(tasks.archivedAt))) : [];
  // Before the project was this client's: not theirs to see.
  const ownTasks = taskRows.filter((t) => { const s = since(t.projectId); return !s || (t.completedAt ? t.completedAt >= s : true); });
  const msRows = ids.length ? await tx.select().from(projectMilestones).where(and(inArray(projectMilestones.projectId, ids), isNull(projectMilestones.archivedAt), eq(projectMilestones.clientVisible, true))).orderBy(projectMilestones.dueDate, projectMilestones.position) : [];
  const ownMs = msRows.filter((m) => { const s = since(m.projectId); return !s || m.dueDate >= localDate(s, tz); });
  const onTime = (m: (typeof ownMs)[number]) => !!m.completedAt && localDate(m.completedAt, tz) <= m.dueDate;
  const nextOpen = (pid: string) => ownMs.find((m) => m.projectId === pid && !m.completedAt);
  const perProject = projectRows.map((p) => {
    const ts = ownTasks.filter((t) => t.projectId === p.id);
    const ms = ownMs.filter((m) => m.projectId === p.id);
    const done = ts.filter((t) => t.status === 'DONE').length;
    const delivered = ms.filter((m) => m.completedAt);
    const dueMs = ms.filter((m) => m.completedAt || m.dueDate <= today);
    const late = ms.some((m) => !m.completedAt && m.dueDate < today);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      completion_pct: ts.length ? ratioScore(done, ts.length) : ms.length ? ratioScore(delivered.length, ms.length) : null,
      tasks: access.sections.tasks ? { done, open: ts.length - done } : null,
      milestones: { done: delivered.length, total: ms.length, on_time: dueMs.filter(onTime).length, due: dueMs.length },
      delivery: !ms.length ? null : delivered.length === ms.length ? 'DONE' : late ? 'BEHIND' : 'ON_TRACK',
      next_milestone: nextOpen(p.id) ? { title: nextOpen(p.id)!.title, due_date: nextOpen(p.id)!.dueDate } : null,
    };
  });
  // Tasks completed per week, the last 8 weeks.
  const weeks: Array<{ start: string; tasks_done: number }> = [];
  let end = today;
  for (let i = 0; i < 8; i++) {
    const w = periodBounds('WEEK', end, org!.weekStart);
    weeks.unshift({ start: w.start, tasks_done: ownTasks.filter((t) => t.completedAt && localDate(t.completedAt, tz) >= w.start && localDate(t.completedAt, tz) <= w.end).length });
    end = addDaysToDate(w.start, -1);
  }
  const allDone = ownTasks.filter((t) => t.status === 'DONE').length;
  const dueAll = ownMs.filter((m) => m.completedAt || m.dueDate <= today);
  // People a client may thank: the project's members (names only).
  const contributorRows = ids.length
    ? await tx.selectDistinct({ id: memberships.id, name: users.name, projectId: projectMembers.projectId }).from(projectMembers).innerJoin(memberships, eq(memberships.id, projectMembers.membershipId)).innerJoin(users, eq(users.id, memberships.userId)).where(and(inArray(projectMembers.projectId, ids), eq(memberships.status, 'ACTIVE')))
    : [];
  const insights = {
    totals: {
      completion_pct: ownTasks.length ? ratioScore(allDone, ownTasks.length) : ownMs.length ? ratioScore(ownMs.filter((m) => m.completedAt).length, ownMs.length) : null,
      tasks_done: access.sections.tasks ? allDone : null,
      tasks_open: access.sections.tasks ? ownTasks.length - allDone : null,
      tasks_done_this_week: access.sections.tasks ? weeks.at(-1)!.tasks_done : null,
      milestones_done: ownMs.filter((m) => m.completedAt).length,
      milestones_total: ownMs.length,
      on_time_pct: ratioScore(dueAll.filter(onTime).length, dueAll.length),
      next_milestone: ownMs.find((m) => !m.completedAt) ? { title: ownMs.find((m) => !m.completedAt)!.title, due_date: ownMs.find((m) => !m.completedAt)!.dueDate } : null,
    },
    projects: perProject,
    milestones: ownMs.map((m) => ({ id: m.id, project_id: m.projectId, title: m.title, due_date: m.dueDate, status: m.completedAt ? 'DONE' : nextOpen(m.projectId)?.id === m.id ? 'IN_PROGRESS' : 'PLANNED', on_time: m.completedAt ? onTime(m) : null, overdue: !m.completedAt && m.dueDate < today })),
    weeks: access.sections.tasks ? weeks : [],
    contributors: contributorRows.map((c) => ({ membership_id: c.id, name: c.name, project_id: c.projectId })),
  };
  // Finish estimates from the client's own tasks (only when tasks are shared): the AI summary uses them.
  const finish = access.sections.tasks
    ? perProject.map((p) => {
        const ts = ownTasks.filter((t) => t.projectId === p.id);
        const doneLast28 = ts.filter((t) => t.completedAt && localDate(t.completedAt, tz) > addDaysToDate(today, -28)).length;
        const fc = finishForecast({ open: ts.filter((t) => t.status !== 'DONE').length, doneLast28, today, endDate: null });
        return { project: p.name, finishDate: fc?.finishDate ?? null, late: false };
      })
    : [];
  return { insights, finish, today };
}

/** A client thanks a project team or one of its members. Held for the organization's approval. */
export async function submitAppreciation(deps: Deps, access: PortalAccess, input: z.infer<typeof appreciationInput>) {
  return withTenant(deps.db, access.organizationId, async (tx) => {
    if (!access.projectIds.includes(input.project_id)) throw notFound('project');
    if (input.membership_id) {
      const members = await projectMemberIds(tx, input.project_id);
      if (!members.includes(input.membership_id)) throw notFound('member');
    }
    const pending = await tx.select({ id: clientAppreciations.id }).from(clientAppreciations).where(and(eq(clientAppreciations.portalAccessId, access.accessId!), eq(clientAppreciations.status, 'PENDING')));
    if (pending.length >= 20) throw businessRule('too_many_pending', 'You have sent a lot of appreciation that is still waiting. Please try again after it is reviewed.');
    const id = newId();
    await tx.insert(clientAppreciations).values({ id, organizationId: access.organizationId, clientId: access.clientId, portalAccessId: access.accessId!, projectId: input.project_id, membershipId: input.membership_id ?? null, message: input.message });
    await logPortalView(tx, access, 'portal.appreciation_sent', { appreciation_id: id, project_id: input.project_id });
    const [client] = await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, access.clientId));
    await notify(tx, deps, access.organizationId, await membersWith(tx, access.organizationId, 'achievements:award'), { type: 'appreciation.received', title: `${client?.name ?? 'A client'} sent appreciation`, body: 'Review it before the team sees it.', link: '/performance/achievements?tab=appreciation', payload: { appreciation_id: id } });
    return { id, status: 'PENDING' as const };
  });
}

// ─── Organization side ───────────────────────────────────────────────────────

async function canDecide(x: Ctx, a: { membershipId: string | null; projectId: string }) {
  if (!x.actor.grants['achievements:award']) return false;
  if (x.actor.grants['achievements:award'] === 'org') return true;
  if (a.membershipId) return can(x.actor, 'achievements:award', { ownerMembershipId: a.membershipId });
  // A whole project team: managers assigned to the project.
  return can(x.actor, 'projects:read', { projectId: a.projectId }) && x.actor.assignedProjectIds.has(a.projectId);
}

export async function listAppreciations(x: Ctx, status?: 'PENDING' | 'APPROVED' | 'DECLINED') {
  if (!x.actor.grants['achievements:award']) throw forbidden();
  const rows = await x.tx.select().from(clientAppreciations).where(status ? eq(clientAppreciations.status, status) : undefined).orderBy(desc(clientAppreciations.createdAt)).limit(200);
  const visible = [];
  for (const r of rows) if (await canDecide(x, r)) visible.push(r);
  const names = await memberNames(x, [...new Set(visible.flatMap((r) => [r.membershipId, r.decidedBy]).filter((v): v is string => !!v))]);
  const cids = [...new Set(visible.map((r) => r.clientId))];
  const pids = [...new Set(visible.map((r) => r.projectId))];
  const cnames = new Map(cids.length ? (await x.tx.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, cids))).map((c) => [c.id, c.name]) : []);
  const pnames = new Map(pids.length ? (await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, pids))).map((p) => [p.id, p.name]) : []);
  return visible.map((r) => ({
    id: r.id,
    client: { id: r.clientId, name: cnames.get(r.clientId) ?? '' },
    project: { id: r.projectId, name: pnames.get(r.projectId) ?? '' },
    member: r.membershipId ? { id: r.membershipId, name: names.get(r.membershipId) ?? '' } : null,
    message: r.message,
    status: r.status,
    decided_by: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
    decided_at: iso(r.decidedAt),
    created_at: iso(r.createdAt)!,
  }));
}

/** Approve (the recipient gets Client Hero, and the team sees the message) or decline it. */
export async function decideAppreciation(x: Ctx, id: string, approve: boolean) {
  const [a] = await x.tx.select().from(clientAppreciations).where(eq(clientAppreciations.id, id));
  if (!a || !(await canDecide(x, a))) throw notFound('appreciation');
  if (a.status !== 'PENDING') throw businessRule('already_decided', 'This appreciation was already reviewed.');
  await x.tx.update(clientAppreciations).set({ status: approve ? 'APPROVED' : 'DECLINED', decidedBy: x.actor.membershipId, decidedAt: x.deps.now() }).where(eq(clientAppreciations.id, id));
  await audit(x, { action: approve ? 'appreciation.approved' : 'appreciation.declined', targetType: 'client_appreciation', targetId: id });
  if (approve) {
    await ensureBuiltinAchievements(x.tx, x.org.id);
    const [def] = await x.tx.select().from(achievementDefinitions).where(and(eq(achievementDefinitions.key, 'client_hero'), isNotNull(achievementDefinitions.key)));
    const recipients = a.membershipId ? [a.membershipId] : await projectMemberIds(x.tx, a.projectId);
    const [client] = await x.tx.select({ name: clients.name }).from(clients).where(eq(clients.id, a.clientId));
    for (const m of recipients) {
      await grantAutomatic(x.tx, x.deps, x.org.id, { definition: def!, membershipId: m, tier: 'NONE', periodKey: `appreciation:${id}`, evidence: { appreciation_id: id, client: client?.name ?? null }, source: 'CLIENT', reason: a.message, awardedBy: x.actor.membershipId });
    }
    await emitFrom(x, 'recognition.awarded', { appreciation_id: id, source: 'CLIENT', recipients });
  }
}

