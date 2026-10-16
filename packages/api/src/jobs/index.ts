import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
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
  trackingSessions,
  urlSpans,
  withSystem,
  withTenant,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, localDate, type TrackingPolicy } from '@tallywork/domain';
import type { Deps } from '../context';
import { auditSystem, emit } from '../services/events';
import { sendDigests } from '../services/digest';
import { runMissingTimeReminders } from '../services/reminders';
import { applyRetention } from '../services/retention';
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
      await notify(tx, deps, org, ids.rows.map((r) => r.id), { type: 'policy.changed', title: 'Tracking settings were updated', body: 'Review what is monitored on your devices.', link: '/me/monitoring' });
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
      // Idle prompts never answered → apply the default resolution.
      const pending = await tx.select().from(idleEvents).where(and(eq(idleEvents.sessionId, s.id), eq(idleEvents.resolution, 'PENDING')));
      for (const ev of pending) {
        const ageMs = now.getTime() - (ev.endedAt ?? ev.startedAt).getTime();
        if (ev.endedAt && ageMs > policy.idle.confirmationTimeoutMinutes * 60_000) {
          await resolveIdle(tx, { organizationId: s.organizationId, idleId: ev.id, sessionId: s.id, startedAt: ev.startedAt, endedAt: ev.endedAt, resolution: policy.idle.defaultResolution === 'discard' ? 'DISCARDED' : 'KEPT', actor: SYSTEM, resolvedBy: null });
          stats.idle_defaulted++;
        }
      }
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, s.organizationId));
      const hit = s.state === 'ACTIVE' ? await limitExceeded(tx, s.membershipId, s.timezone, policy, now, org?.weekStart ?? 1) : null;
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
  return stats;
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
  return { sessions, workforce, reports, offline, dispatched, webhooks, integrations };
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
  return summary;
}
