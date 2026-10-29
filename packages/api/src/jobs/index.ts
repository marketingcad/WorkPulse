import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  activityMinutes,
  appSpans,
  auditLogs,
  devices,
  idleEvents,
  ingestReceipts,
  invoices,
  organizations,
  outboxEvents,
  rateLimitBuckets,
  retentionPolicies,
  screenshots,
  timeSegments,
  timesheets,
  trackingSessions,
  urlSpans,
  withSystem,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, localDate, splitAtLocalMidnight, type TrackingPolicy } from '@tallywork/domain';
import type { Deps } from '../context';
import { auditSystem, emit } from '../services/events';
import { sendDigests } from '../services/digest';
import { runMissingTimeReminders } from '../services/reminders';
import { applyRetention } from '../services/retention';
import { checkOverdueCleanups, runScreenshotCleanup } from '../services/screenshot-cleanup';
import { processReportRuns, runSchedules } from '../services/report-runs';
import { runSyncs } from '../services/integrations';
import { checkBudgets } from '../services/finance';
import { alertLongBreaks, runAccruals, runShiftAlerts } from '../services/operations';
import { approversFor, membersWith, notify } from '../services/notify';
import { effectivePolicy } from '../services/policies';
import { deliverWebhooks, enqueueWebhooks } from '../services/platform';
import { reconcileWorkerDays, recomputeUsageDays, recomputeWorkerDays } from '../services/projector';
import { applyTrigger, limitExceeded, lockWorker, resolveIdle } from '../services/tracking';
import { memberNames } from '../services/timer';
import { idleEndEvidence } from '../services/activity';

const MAX_ATTEMPTS = 10;
const SYSTEM = { type: 'system' as const, id: null };

interface Envelope {
  event_id: string;
  event_type: string;
  organization_id: string;
  worker_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
}

async function handleEvent(tx: Tx, deps: Deps, e: Envelope): Promise<void> {
  const p = e.payload;
  const org = e.organization_id;
  switch (e.event_type) {
    case 'time.changed': {
      const m = p.membership_id as string;
      const dates = p.dates as string[];
      await recomputeWorkerDays(tx, org, m, dates);
      const projectIds = (await tx.execute<{ project_id: string }>(sql`select distinct project_id from rollup_worker_day where membership_id = ${m} and local_date in ${sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`)}`)) as unknown as { rows: Array<{ project_id: string }> };
      const [o] = await tx.select().from(organizations).where(eq(organizations.id, org));
      if (o) await checkBudgets(tx, deps, org, o.currency, o.timezone, (projectIds.rows ?? []).map((r) => r.project_id));
      break;
    }
    case 'usage.recorded':
      await recomputeUsageDays(tx, p.membership_id as string, p.dates as string[]);
      break;
    case 'timesheet.submitted': {
      const worker = p.membership_id as string;
      const names = await memberNames({ tx }, [worker]);
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'timesheets:approve'), {
        type: 'timesheet.submitted',
        title: `${names.get(worker) ?? 'A member'} submitted a timesheet`,
        body: `Period ${p.period_start} – ${p.period_end}`,
        link: `/timesheets/approvals`,
      });
      break;
    }
    case 'timesheet.late_time': {
      const worker = p.membership_id as string;
      const names = await memberNames({ tx }, [worker]);
      const mins = Math.max(1, Math.round((p.seconds as number) / 60));
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'timesheets:approve'), {
        type: 'timesheet.late_time',
        title: `${mins} min of time was added to ${names.get(worker) ?? 'a member'}'s ${String(p.status).toLowerCase()} timesheet`,
        body: p.status === 'APPROVED' ? `${p.period_start} – ${p.period_end}. It is locked and not included in the approval; reopen the timesheet to include it.` : `${p.period_start} – ${p.period_end}. Request changes so it can be reviewed and resubmitted.`,
        link: `/timesheets/approvals`,
      });
      break;
    }
    case 'time.needs_review': {
      const worker = p.membership_id as string;
      const names = await memberNames({ tx }, [worker]);
      const why: Record<string, string> = {
        offline_over_limit: 'Time recorded offline goes over the time limit',
        offline_project_unavailable: 'Time recorded offline is on a project that is archived, inactive or no longer assigned',
        offline_task_unavailable: 'Time recorded offline was on a task that can no longer take it, so it was kept without the task',
        duration_only_and_tracked: 'The day has both duration-only time and tracked time; check it is not counted twice',
      };
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'timesheets:approve'), {
        type: 'time.needs_review',
        title: `${names.get(worker) ?? 'A member'}'s time on ${String(p.local_date)} needs review`,
        body: why[String(p.reason)] ?? 'Kept and flagged for review',
        link: `/timesheets/approvals`,
      });
      break;
    }
    case 'timesheet.approved':
    case 'timesheet.rejected':
    case 'timesheet.changes_requested':
    case 'timesheet.reopened': {
      const verb = e.event_type.split('.')[1]!.replace('_', ' ');
      await notify(tx, deps, org, [p.membership_id as string], {
        type: e.event_type,
        title: `Your timesheet was ${verb}`,
        body: `${p.period_start} – ${p.period_end}${p.comment ? `: “${p.comment}”` : ''}`,
        link: `/timesheets?date=${p.period_start}`,
      });
      break;
    }
    case 'manual_time.requested': {
      const worker = p.membership_id as string;
      const names = await memberNames({ tx }, [worker]);
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'manual_time:approve'), { type: 'manual_time.requested', title: `${names.get(worker) ?? 'A member'} requested manual time`, link: `/timesheets/manual` });
      break;
    }
    case 'manual_time.approved':
    case 'manual_time.rejected':
      await notify(tx, deps, org, [p.membership_id as string], { type: e.event_type, title: `Your manual time was ${e.event_type.endsWith('approved') ? 'approved' : 'rejected'}`, link: `/timesheets/manual` });
      break;
    case 'time_off.requested': {
      const worker = p.membership_id as string;
      const names = await memberNames({ tx }, [worker]);
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'time_off:approve'), { type: 'time_off.requested', title: `${names.get(worker) ?? 'A member'} requested time off`, body: `${p.start_date} – ${p.end_date} (${p.hours}h)`, link: '/time-off?tab=requests' });
      break;
    }
    case 'time_off.approved':
    case 'time_off.rejected':
      await notify(tx, deps, org, [p.membership_id as string], { type: e.event_type, title: `Your time off request was ${e.event_type.split('.')[1]}`, link: '/time-off' });
      break;
    case 'expense.submitted': {
      const worker = p.membership_id as string;
      await notify(tx, deps, org, await approversFor(tx, org, worker, 'expenses:approve'), { type: 'expense.submitted', title: 'New expense to review', link: `/finance/expenses` });
      break;
    }
    case 'policy.changed': {
      // Transparency: tell every tracking member that monitoring settings changed.
      const ids = (await tx.execute<{ id: string }>(sql`select m.id from memberships m join worker_profiles w on w.membership_id = m.id where m.status = 'ACTIVE' and w.tracking_enabled`)) as unknown as { rows: Array<{ id: string }> };
      await notify(tx, deps, org, ids.rows.map((r) => r.id), { type: 'policy.changed', title: 'Tracking settings were updated', body: 'Your organization changed what is tracked on your devices.' });
      break;
    }
    case 'device.offline':
      await notify(tx, deps, org, await membersWith(tx, org, 'devices:manage'), { type: 'device.offline', title: 'A device went offline', body: String(p.name ?? ''), link: '/devices' });
      break;
    case 'payment.received':
      await notify(tx, deps, org, await membersWith(tx, org, 'payments:manage'), { type: 'payment.received', title: 'Payment received', link: '/finance/payments' });
      break;
    case 'invoice.overdue':
      await notify(tx, deps, org, await membersWith(tx, org, 'invoices:manage'), { type: 'invoice.overdue', title: `Invoice ${p.number} is overdue`, link: `/finance/invoices/${p.invoice_id}` });
      break;
    default:
      break;
  }
  await enqueueWebhooks(tx, org, e, deps.now());
}

/** Process pending outbox events. Each event runs in its own tenant transaction. */
export async function dispatchOutbox(deps: Deps, limit = 100): Promise<number> {
  const batch = await withSystem(deps.db, (tx) =>
    tx
      .select({ id: outboxEvents.id, organizationId: outboxEvents.organizationId, attempts: outboxEvents.attempts })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit),
  );
  let done = 0;
  for (const item of batch) {
    try {
      await withTenant(deps.db, item.organizationId, async (tx) => {
        // Claim the event (skip if another worker took it).
        const claimed = await tx.execute<{ envelope: Envelope }>(sql`select envelope from outbox_events where id = ${item.id} and processed_at is null for update skip locked`);
        const row = (claimed as unknown as { rows: Array<{ envelope: Envelope }> }).rows[0];
        if (!row) return;
        await handleEvent(tx, deps, row.envelope);
        await tx.update(outboxEvents).set({ processedAt: new Date() }).where(eq(outboxEvents.id, item.id));
      });
      done++;
    } catch (err) {
      await withSystem(deps.db, (tx) =>
        tx
          .update(outboxEvents)
          .set({ attempts: item.attempts + 1, lastError: err instanceof Error ? err.message.slice(0, 500) : 'failed' })
          .where(eq(outboxEvents.id, item.id)),
      );
    }
  }
  return done;
}

/** Stale sessions, pause timeouts, idle defaults and time limits. */
export async function sweepSessions(deps: Deps): Promise<Record<string, number>> {
  const now = deps.now();
  const stats = { interrupted: 0, stopped: 0, limit: 0, idle_defaulted: 0 };
  const live = await withSystem(deps.db, (tx) =>
    tx.select({ id: trackingSessions.id, org: trackingSessions.organizationId, m: trackingSessions.membershipId }).from(trackingSessions).where(inArray(trackingSessions.state, ['ACTIVE', 'PAUSED', 'INTERRUPTED'])),
  );
  for (const s0 of live) {
    await withTenant(deps.db, s0.org, async (tx) => {
      await lockWorker(tx, s0.m);
      const [s] = await tx.select().from(trackingSessions).where(eq(trackingSessions.id, s0.id));
      if (!s || s.state === 'STOPPED') return;
      const policy: TrackingPolicy = await effectivePolicy(tx, s.organizationId, s.membershipId);
      const graceMs = policy.tracking.heartbeatGraceSeconds * 1000;
      if (s.state === 'ACTIVE' && s.source === 'DESKTOP' && s.lastHeartbeatAt && now.getTime() - s.lastHeartbeatAt.getTime() > graceMs) {
        const evidence = [s.lastEvidenceAt, s.lastHeartbeatAt].filter((d): d is Date => !!d).reduce((a, b) => (a > b ? a : b));
        await applyTrigger(tx, s, 'INTERRUPT', { at: evidence, actor: SYSTEM, cause: 'heartbeat_lost' });
        stats.interrupted++;
        return;
      }
      if (s.state === 'INTERRUPTED') {
        const [last] = await tx.execute<{ occurred_at: Date }>(sql`select occurred_at from session_transitions where session_id = ${s.id} order by occurred_at desc limit 1`).then((r) => (r as unknown as { rows: Array<{ occurred_at: Date }> }).rows);
        const since = last ? new Date(last.occurred_at).getTime() : s.updatedAt.getTime();
        const windowMs = s.source === 'DESKTOP' ? policy.tracking.maxOfflineHours * 3600_000 : policy.tracking.recoveryWindowMinutes * 60_000;
        if (now.getTime() - since > windowMs) {
          await applyTrigger(tx, s, 'RECOVERY_TIMEOUT', { at: new Date(since), actor: SYSTEM });
          stats.stopped++;
        }
        return;
      }
      if (s.state === 'PAUSED') {
        const [open] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt)));
        if (open && now.getTime() - open.startedAt.getTime() > policy.tracking.maxPauseMinutes * 60_000) {
          await applyTrigger(tx, s, 'PAUSE_TIMEOUT', { at: open.startedAt, actor: SYSTEM });
          stats.stopped++;
        }
        return;
      }
      const [org]= await tx.select().from(organizations).where(eq(organizations.id, s.organizationId));
      // Backfill sessions are time recorded offline: flagged when over the limit, never stopped (Q7).
      const hit = s.state === 'ACTIVE' && !s.backfill ? await limitExceeded(tx, s.membershipId, s.timezone, policy, now, org?.weekStart ?? 1) : null;
      if (hit) {
        // Stop at the moment the limit was reached, not when this sweep ran.
        const [open] = await tx.select({ startedAt: timeSegments.startedAt }).from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt)));
        const exact = new Date(now.getTime() - hit.overBySeconds * 1000);
        const at = open && exact < open.startedAt ? open.startedAt : exact;
        await applyTrigger(tx, s, 'LIMIT_REACHED', { at, actor: SYSTEM, cause: `${hit.kind}_limit` });
        await notify(tx, deps, s.organizationId, [s.membershipId], { type: 'limit.reached', title: 'Tracking stopped: time limit reached', link: '/' });
        stats.limit++;
      }
    });
  }
  stats.idle_defaulted = await applyIdleDefaults(deps);
  return stats;
}

/**
 * Idle periods recorded from this date on get the organization's default resolution when nobody
 * answers in time. Older unanswered ones are left for a manager, so deploying this changes no past time.
 */
export const IDLE_DEFAULTS_FROM = new Date('2026-10-28T00:00:00Z');

/**
 * Unanswered idle → the policy's default resolution, once the worker has been back (or the session
 * ended) for longer than the confirmation timeout. Skipped while the idle period is still going, while
 * a pause-on-idle segment is open, and when the time is in a submitted or approved timesheet.
 */
export async function applyIdleDefaults(deps: Deps, from: Date = IDLE_DEFAULTS_FROM): Promise<number> {
  const now = deps.now();
  const pending = await withSystem(deps.db, (tx) =>
    tx
      .select({ id: idleEvents.id, org: idleEvents.organizationId, m: idleEvents.membershipId, sessionId: idleEvents.sessionId, startedAt: idleEvents.startedAt })
      .from(idleEvents)
      .where(and(eq(idleEvents.resolution, 'PENDING'), sql`${idleEvents.createdAt} >= ${from}`)),
  );
  let done = 0;
  for (const ev of pending) {
    await withTenant(deps.db, ev.org, async (tx) => {
      const [s] = await tx.select().from(trackingSessions).where(eq(trackingSessions.id, ev.sessionId));
      if (!s) return;
      const [openIdle] = await tx.select({ id: timeSegments.id }).from(timeSegments).where(and(eq(timeSegments.sessionId, s.id), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'IDLE')));
      if (openIdle) return;
      const end = await idleEndEvidence(tx, ev);
      if (!end) return; // still idle: no input since, and the session is still going
      const policy: TrackingPolicy = await effectivePolicy(tx, s.organizationId, s.membershipId);
      if (now.getTime() - end.getTime() <= policy.idle.confirmationTimeoutMinutes * 60_000) return;
      const dates = splitAtLocalMidnight({ start: ev.startedAt, end: end > ev.startedAt ? end : ev.startedAt }, s.timezone).map((p) => p.localDate);
      const [closed] = dates.length
        ? await tx
            .select({ id: timesheets.id })
            .from(timesheets)
            .where(and(eq(timesheets.membershipId, s.membershipId), inArray(timesheets.status, ['SUBMITTED', 'APPROVED']), lte(timesheets.periodStart, dates[dates.length - 1]!), gte(timesheets.periodEnd, dates[0]!)))
            .limit(1)
        : [];
      if (closed) return; // a manager resolves it; submitted or approved time is never changed by the system
      await resolveIdle(tx, { organizationId: s.organizationId, idleId: ev.id, sessionId: s.id, startedAt: ev.startedAt, endedAt: end, resolution: policy.idle.defaultResolution === 'discard' ? 'DISCARDED' : 'KEPT', actor: SYSTEM, resolvedBy: null });
      done++;
    });
  }
  return done;
}

export async function markDevicesOffline(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - 60 * 60_000);
  const stale = await withSystem(deps.db, (tx) => tx.select().from(devices).where(and(eq(devices.status, 'ACTIVE'), lt(devices.lastSeenAt, cutoff))));
  for (const d of stale) {
    await withTenant(deps.db, d.organizationId, async (tx) => {
      await tx.update(devices).set({ status: 'OFFLINE' }).where(eq(devices.id, d.id));
      await emit(tx, d.organizationId, 'device.offline', { device_id: d.id, name: d.name, membership_id: d.membershipId }, { workerId: d.membershipId, deviceId: d.id });
    });
  }
  return stale.length;
}

/** Shift "not started" alerts and long-break warnings, per organization. */
export async function runWorkforceAlerts(deps: Deps): Promise<{ shifts: number; breaks: number; missing_time: number }> {
  const now = deps.now();
  const out = { shifts: 0, breaks: 0, missing_time: 0 };
  const orgs = await withSystem(deps.db, (tx) => tx.select({ id: organizations.id, name: organizations.name, tz: organizations.timezone, weekStart: organizations.weekStart, settings: organizations.settings }).from(organizations));
  for (const o of orgs) {
    await withTenant(deps.db, o.id, async (tx) => {
      out.shifts += await runShiftAlerts(tx, deps, o.id, o.tz, o.settings.lateGraceMinutes, now);
      out.breaks += await alertLongBreaks(tx, deps, o.id, now);
      out.missing_time += await runMissingTimeReminders(tx, deps, { id: o.id, name: o.name, timezone: o.tz, weekStart: o.weekStart, settings: o.settings }, now);
    });
  }
  return out;
}

/** Every minute: sweep sessions, workforce alerts, dispatch events, deliver webhooks. */
export async function runTick(deps: Deps) {
  const sessions = await sweepSessions(deps);
  const workforce = await runWorkforceAlerts(deps);
  const reports = await runSchedules(deps);
  // Exports queued from the app are normally processed right after the request; this is the backstop.
  reports.processed += await processReportRuns(deps, 3);
  const offline = await markDevicesOffline(deps);
  const dispatched = await dispatchOutbox(deps, 200);
  const webhooks = await deliverWebhooks(deps, 50);
  const integrations = await runSyncs(deps);
  const screenshotCleanup = await runScreenshotCleanup(deps);
  return { sessions, workforce, reports, offline, dispatched, webhooks, integrations, screenshotCleanup };
}

/** Daily: retention cleanup, accruals, overdue invoices, housekeeping. */
export async function runDaily(deps: Deps) {
  const orgs = await withSystem(deps.db, (tx) => tx.select().from(organizations));
  const summary: Record<string, unknown> = {};
  for (const o of orgs) {
    const today = localDate(deps.now(), o.timezone);
    await withTenant(deps.db, o.id, async (tx) => {
      const deleted = await applyRetention(tx, deps);
      await tx.delete(ingestReceipts).where(lt(ingestReceipts.receivedAt, new Date(deps.now().getTime() - 30 * 86400_000)));
      await tx.delete(outboxEvents).where(and(sql`${outboxEvents.processedAt} is not null`, lt(outboxEvents.processedAt, new Date(deps.now().getTime() - 14 * 86400_000))));
      if (Object.values(deleted).some((n) => n > 0)) await auditSystem(tx, o.id, { action: 'retention.cleanup', metadata: deleted });

      const accrued = await runAccruals(tx, deps, o.id, today, o.timezone);

      // Rollups drive dashboards and reports: rebuild any worker-day that no longer matches its entries.
      const rollups = await reconcileWorkerDays(tx, o.id, addDaysToDate(today, -35), today);
      if (rollups.drifted > 0) await auditSystem(tx, o.id, { action: 'rollups.reconciled', metadata: rollups });

      const overdue = await tx.select().from(invoices).where(and(eq(invoices.status, 'SENT'), lt(invoices.dueDate, today), sql`${invoices.paidMinor} < ${invoices.totalMinor}`, isNull(invoices.overdueNotifiedAt)));
      for (const i of overdue) {
        await tx.update(invoices).set({ overdueNotifiedAt: deps.now() }).where(eq(invoices.id, i.id));
        await emit(tx, o.id, 'invoice.overdue', { invoice_id: i.id, number: i.number });
      }
      const digests = await sendDigests(tx, deps, o.id, today);
      summary[o.id] = { deleted, accrued, overdue: overdue.length, rollups, digests };
    });
  }
  await withSystem(deps.db, (tx) => tx.delete(rateLimitBuckets).where(lt(rateLimitBuckets.windowStart, new Date(deps.now().getTime() - 2 * 86400_000))));
  await checkOverdueCleanups(deps);
  return summary;
}
