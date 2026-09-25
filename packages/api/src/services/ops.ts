import { and, count, eq, gte, isNull, lt, max, min, sql } from 'drizzle-orm';
import { auditLogs, devices, integrationConnections, outboxEvents, reportRuns, trackingSessions, webhookDeliveries, withSystem } from '@tallywork/db';
import type { Deps } from '../context';

/**
 * Operational gauges for monitoring (all organizations). No tenant data, only counts and ages,
 * so it is safe to expose to the monitoring system behind the cron secret.
 */
export interface Metrics {
  outbox_pending: number;
  outbox_oldest_pending_seconds: number;
  outbox_parked: number;
  seconds_since_last_dispatch: number | null;
  webhooks_pending: number;
  webhooks_overdue_seconds: number;
  webhooks_dead_24h: number;
  report_runs_queued: number;
  report_runs_oldest_queued_seconds: number;
  report_runs_failed_24h: number;
  tracking_sessions_live: number;
  agents_not_synced_1h: number;
  integrations_in_error: number;
  rollup_drift_orgs_24h: number;
}

export async function opsMetrics(deps: Deps): Promise<{ time: string; metrics: Metrics; alerts: Array<{ key: string; severity: 'page' | 'ticket'; summary: string }> }> {
  const now = deps.now();
  const dayAgo = new Date(now.getTime() - 86400_000);
  const hourAgo = new Date(now.getTime() - 3600_000);
  return withSystem(deps.db, async (tx) => {
    const [ob] = await tx.select({ n: count(), oldest: min(outboxEvents.createdAt) }).from(outboxEvents).where(isNull(outboxEvents.processedAt));
    const [parked] = await tx.select({ n: count() }).from(outboxEvents).where(and(isNull(outboxEvents.processedAt), gte(outboxEvents.attempts, 10)));
    const [lastDispatch] = await tx.select({ at: max(outboxEvents.processedAt) }).from(outboxEvents);
    const [whPending] = await tx.select({ n: count(), oldest: min(webhookDeliveries.nextAttemptAt) }).from(webhookDeliveries).where(eq(webhookDeliveries.status, 'PENDING'));
    const [whDead] = await tx.select({ n: count() }).from(webhookDeliveries).where(and(eq(webhookDeliveries.status, 'DEAD'), gte(webhookDeliveries.updatedAt, dayAgo)));
    const [runsQueued] = await tx.select({ n: count(), oldest: min(reportRuns.createdAt) }).from(reportRuns).where(eq(reportRuns.status, 'QUEUED'));
    const [runsFailed] = await tx.select({ n: count() }).from(reportRuns).where(and(eq(reportRuns.status, 'FAILED'), gte(reportRuns.createdAt, dayAgo)));
    const [live] = await tx.select({ n: count() }).from(trackingSessions).where(sql`${trackingSessions.state} <> 'STOPPED'`);
    const [staleAgents] = await tx.select({ n: count() }).from(devices).where(and(eq(devices.status, 'ACTIVE'), lt(devices.lastSyncAt, hourAgo)));
    const [intErrors] = await tx.select({ n: count() }).from(integrationConnections).where(eq(integrationConnections.status, 'ERROR'));
    const [drift] = await tx.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.action, 'rollups.reconciled'), gte(auditLogs.createdAt, dayAgo)));
    const age = (d: Date | null | undefined) => (d ? Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 1000)) : 0);
    const metrics: Metrics = {
      outbox_pending: Number(ob?.n ?? 0),
      outbox_oldest_pending_seconds: age(ob?.oldest),
      outbox_parked: Number(parked?.n ?? 0),
      seconds_since_last_dispatch: lastDispatch?.at ? age(lastDispatch.at) : null,
      webhooks_pending: Number(whPending?.n ?? 0),
      webhooks_overdue_seconds: whPending?.oldest && whPending.oldest < now ? age(whPending.oldest) : 0,
      webhooks_dead_24h: Number(whDead?.n ?? 0),
      report_runs_queued: Number(runsQueued?.n ?? 0),
      report_runs_oldest_queued_seconds: age(runsQueued?.oldest),
      report_runs_failed_24h: Number(runsFailed?.n ?? 0),
      tracking_sessions_live: Number(live?.n ?? 0),
      agents_not_synced_1h: Number(staleAgents?.n ?? 0),
      integrations_in_error: Number(intErrors?.n ?? 0),
      rollup_drift_orgs_24h: Number(drift?.n ?? 0),
    };
    return { time: now.toISOString(), metrics, alerts: evaluateAlerts(metrics) };
  });
}


/**
 * Alert rules (docs/ops/runbooks.md has what to do for each). Thresholds are chosen so a healthy
 * system with the minute cron never fires them.
 */
export const ALERT_RULES: Array<{ key: string; severity: 'page' | 'ticket'; when: (m: Metrics) => boolean; summary: (m: Metrics) => string }> = [
  { key: 'outbox_backlog', severity: 'page', when: (m) => m.outbox_oldest_pending_seconds > 300, summary: (m) => `Oldest undelivered event is ${m.outbox_oldest_pending_seconds}s old (${m.outbox_pending} pending)` },
  { key: 'outbox_parked', severity: 'ticket', when: (m) => m.outbox_parked > 0, summary: (m) => `${m.outbox_parked} event(s) failed 10 times and are parked` },
  { key: 'webhooks_overdue', severity: 'ticket', when: (m) => m.webhooks_overdue_seconds > 600, summary: (m) => `Webhook deliveries are ${m.webhooks_overdue_seconds}s behind` },
  { key: 'webhooks_dead', severity: 'ticket', when: (m) => m.webhooks_dead_24h > 20, summary: (m) => `${m.webhooks_dead_24h} webhook deliveries gave up in 24h` },
  { key: 'exports_stuck', severity: 'ticket', when: (m) => m.report_runs_oldest_queued_seconds > 900, summary: (m) => `An export has waited ${m.report_runs_oldest_queued_seconds}s` },
  { key: 'exports_failing', severity: 'ticket', when: (m) => m.report_runs_failed_24h > 10, summary: (m) => `${m.report_runs_failed_24h} exports failed in 24h` },
  { key: 'rollup_drift', severity: 'ticket', when: (m) => m.rollup_drift_orgs_24h > 0, summary: (m) => `Rollups drifted in ${m.rollup_drift_orgs_24h} organization(s); nightly job repaired them` },
];

export function evaluateAlerts(m: Metrics) {
  return ALERT_RULES.filter((r) => r.when(m)).map((r) => ({ key: r.key, severity: r.severity, summary: r.summary(m) }));
}

/** Readiness: the database answers within the timeout. */
export async function readiness(deps: Deps, timeoutMs = 2000): Promise<{ ok: boolean; db_ms: number | null; error?: string }> {
  const started = Date.now();
  try {
    await Promise.race([deps.db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error('database timeout')), timeoutMs))]);
    return { ok: true, db_ms: Date.now() - started };
  } catch (e) {
    return { ok: false, db_ms: null, error: e instanceof Error ? e.message.split('\n')[0] : 'database unavailable' };
  }
}
