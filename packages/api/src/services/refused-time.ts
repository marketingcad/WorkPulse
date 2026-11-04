import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { manualTimeRequests, projects, refusedTime } from '@tallywork/db';
import { addDaysToDate, newId, notFound, startOfLocalDay, type DomainError } from '@tallywork/domain';
import type { AgentEvent, RefusedTimeDto } from '@tallywork/contracts';
import type { AgentCtx } from './agent';
import type { Ctx } from './ctx';
import { auditSystem } from './events';
import { narrowMemberships } from './scope';
import { memberNames } from './timer';

/**
 * "Time not added": records a desktop app sent that the server refused (usually tracked offline under
 * settings that changed meanwhile). They are kept so the worker and their managers can see them, and
 * are never added to anyone's time on their own: the worker asks for the time as manual time, which
 * goes through the usual approval (and its overlap and lock rules, so nothing is counted twice).
 */

/** Session events: refusing one of these means time was not added (the rest is monitoring data). */
const TIME_EVENTS = new Set(['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.interrupted', 'session.recover']);

/** Keep a refused record (called after the event's savepoint rolled back). Manual time has its own status. */
export async function recordRefused(a: AgentCtx, ev: AgentEvent, e: DomainError): Promise<void> {
  if (ev.type === 'manual_time.request') return;
  const sessionId = 'session_id' in ev ? ev.session_id : null;
  const kind = TIME_EVENTS.has(ev.type) ? 'time' : 'data';
  const at = new Date(ev.occurred_at);
  const projectId = ev.type === 'session.start' ? ev.project_id : null;
  const taskId = ev.type === 'session.start' ? (ev.task_id ?? null) : null;
  await a.tx
    .insert(refusedTime)
    .values({ id: newId(), organizationId: a.organizationId, membershipId: a.membershipId, deviceId: a.deviceId, sessionId, kind, projectId, taskId, startedAt: at, endedAt: at, code: e.code, message: e.message })
    .onConflictDoUpdate({
      target: [refusedTime.organizationId, refusedTime.membershipId, refusedTime.sessionId],
      set: {
        startedAt: sql`least(${refusedTime.startedAt}, excluded.started_at)`,
        endedAt: sql`greatest(${refusedTime.endedAt}, excluded.ended_at)`,
        eventCount: sql`${refusedTime.eventCount} + 1`,
        // The first refused session event explains the rest (a refused start, then "session not found").
        code: sql`case when ${refusedTime.kind} = 'data' and excluded.kind = 'time' then excluded.code else ${refusedTime.code} end`,
        message: sql`case when ${refusedTime.kind} = 'data' and excluded.kind = 'time' then excluded.message else ${refusedTime.message} end`,
        kind: sql`case when excluded.kind = 'time' then 'time' else ${refusedTime.kind} end`,
        projectId: sql`coalesce(${refusedTime.projectId}, excluded.project_id)`,
        taskId: sql`coalesce(${refusedTime.taskId}, excluded.task_id)`,
        updatedAt: sql`now()`,
      },
    });
}

/** The worker asked for refused time as manual time: link the request, which carries the decision. */
export async function linkCorrection(a: AgentCtx, sessionId: string, requestId: string): Promise<void> {
  await a.tx
    .update(refusedTime)
    .set({ manualRequestId: requestId, dismissedAt: null, updatedAt: new Date() })
    .where(and(eq(refusedTime.organizationId, a.organizationId), eq(refusedTime.membershipId, a.membershipId), eq(refusedTime.sessionId, sessionId)));
}

/** The worker removed the note without asking for the time. Audited: their managers see it as decided. */
export async function dismissRefused(a: AgentCtx, sessionId: string): Promise<void> {
  const [row] = await a.tx
    .update(refusedTime)
    .set({ dismissedAt: a.deps.now(), updatedAt: new Date() })
    .where(and(eq(refusedTime.organizationId, a.organizationId), eq(refusedTime.membershipId, a.membershipId), eq(refusedTime.sessionId, sessionId), isNull(refusedTime.manualRequestId)))
    .returning({ id: refusedTime.id });
  if (!row) throw notFound('refused_time');
  await auditSystem(a.tx, a.organizationId, { actorType: 'agent', actorId: a.deviceId, action: 'refused_time.dismissed', targetType: 'refused_time', targetId: row.id, metadata: { session_id: sessionId } });
}

type Status = RefusedTimeDto['status'];
function statusOf(r: { dismissedAt: Date | null; request: string | null }): Status {
  if (r.request === 'APPROVED') return 'CORRECTED';
  if (r.request === 'PENDING') return 'CORRECTION_REQUESTED';
  if (r.request === 'REJECTED' || r.request === 'CANCELLED') return 'CORRECTION_DECLINED';
  return r.dismissedAt ? 'DISMISSED' : 'OPEN';
}

/** Managers' list: refused time of the people they may see (tracking:read), newest first. */
export async function listRefusedTime(x: Ctx, q: { from: string; to: string; status?: 'open' | 'all' }): Promise<RefusedTimeDto[]> {
  const visible = narrowMemberships(x.actor, 'tracking:read');
  const from = startOfLocalDay(q.from, x.org.timezone);
  const to = startOfLocalDay(addDaysToDate(q.to, 1), x.org.timezone);
  const rows = await x.tx
    .select({ r: refusedTime, request: manualTimeRequests.status, reason: manualTimeRequests.reason, decisionComment: manualTimeRequests.decisionComment, projectName: projects.name })
    .from(refusedTime)
    .leftJoin(manualTimeRequests, eq(manualTimeRequests.id, refusedTime.manualRequestId))
    .leftJoin(projects, eq(projects.id, refusedTime.projectId))
    .where(
      and(
        visible === 'all' ? undefined : inArray(refusedTime.membershipId, visible.length ? visible : ['00000000-0000-7000-8000-000000000000']),
        // Monitoring data refused after a monitor was turned off is not time: the worker sees it, managers need not.
        eq(refusedTime.kind, 'time'),
        gte(refusedTime.startedAt, from),
        lt(refusedTime.startedAt, to),
      ),
    )
    .orderBy(desc(refusedTime.startedAt))
    .limit(500);
  const names = await memberNames(x, [...new Set(rows.map((r) => r.r.membershipId))]);
  const all = rows.map(({ r, request, reason, decisionComment, projectName }) => ({
    id: r.id,
    membership_id: r.membershipId,
    worker_name: names.get(r.membershipId) ?? '',
    kind: r.kind,
    project_id: r.projectId,
    project_name: projectName ?? null,
    started_at: r.startedAt.toISOString(),
    ended_at: r.endedAt.toISOString(),
    duration_seconds: Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000)),
    code: r.code,
    message: r.message,
    status: statusOf({ dismissedAt: r.dismissedAt, request }),
    manual_request_id: r.manualRequestId,
    worker_reason: reason ?? null,
    decision_comment: decisionComment ?? null,
    dismissed_at: r.dismissedAt?.toISOString() ?? null,
  }));
  return q.status === 'all' ? all : all.filter((r) => r.status === 'OPEN' || r.status === 'CORRECTION_REQUESTED');
}
