import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { organizations, screenshotCleanupRuns, screenshotCleanupSettings, screenshots, withSystem, withTenant, type Tx } from '@tallywork/db';
import {
  DEFAULT_SCREENSHOT_CLEANUP,
  DomainError,
  MAX_PURGE_ATTEMPTS,
  cleanupCutoff,
  conflict,
  forbidden,
  isMaterialRetentionChange,
  newId,
  nextCleanupAt,
  notFound,
  purgeRetryDelayMs,
} from '@tallywork/domain';
import type { ScreenshotCleanupRunDto, ScreenshotCleanupSettingsDto, ScreenshotStorageDto, screenshotCleanupInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { audit, auditSystem } from './events';
import { membersWith, notify } from './notify';
import { memberNames } from './timer';

/**
 * Screenshot retention & cleanup. An administrator sets how long screenshots are kept and when the
 * cleanup runs; the first deletion needs a preview and their approval. Runs are processed by the
 * minute tick in bounded batches: storage objects are deleted first, and a screenshot's row only
 * once its objects are gone, so the database never claims a deletion that storage did not make.
 */
type Settings = typeof screenshotCleanupSettings.$inferSelect;
type Run = typeof screenshotCleanupRuns.$inferSelect;

/** Screenshots per batch: one transaction, one storage call. */
export const CLEANUP_BATCH = 200;
/** Time the minute tick spends on cleanup before leaving the rest to the next tick. */
const TICK_BUDGET_MS = 25_000;
/** A preview can be approved for this long. */
const PREVIEW_VALID_MS = 24 * 3600_000;
/** A running run with no progress for this long has stalled (administrators are told). */
const STALLED_MS = 30 * 60_000;
/** …and is closed as failed after this long; what it left is picked up by the next run. */
const ABANDON_MS = 2 * 3600_000;

function defaults(organizationId: string): Settings {
  const now = new Date(0);
  return {
    organizationId,
    enabled: DEFAULT_SCREENSHOT_CLEANUP.enabled,
    retentionDays: DEFAULT_SCREENSHOT_CLEANUP.retentionDays,
    frequency: DEFAULT_SCREENSHOT_CLEANUP.frequency,
    runAt: DEFAULT_SCREENSHOT_CLEANUP.runAt,
    weekday: DEFAULT_SCREENSHOT_CLEANUP.weekday,
    timezone: null,
    retryFailed: DEFAULT_SCREENSHOT_CLEANUP.retryFailed,
    policyVersion: 1,
    approvedAt: null,
    approvedBy: null,
    approvedPolicyVersion: null,
    approvedPreviewId: null,
    nextRunAt: null,
    lastRunId: null,
    alertKey: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadSettings(tx: Tx, organizationId: string, lock = false): Promise<Settings> {
  const q = tx.select().from(screenshotCleanupSettings).where(eq(screenshotCleanupSettings.organizationId, organizationId));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? defaults(organizationId);
}

async function saveSettings(tx: Tx, s: Settings, now: Date): Promise<void> {
  const { organizationId: _org, createdAt: _created, ...changes } = s;
  await tx
    .insert(screenshotCleanupSettings)
    .values({ ...s, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: screenshotCleanupSettings.organizationId, set: { ...changes, updatedAt: now } });
}

const isApproved = (s: Settings) => s.approvedAt != null && s.approvedPolicyVersion === s.policyVersion;
const scheduleOf = (s: Settings) => ({ frequency: s.frequency, runAt: s.runAt, weekday: s.weekday });

/** Screenshots a run may delete now: captured strictly before the cutoff, and not waiting for a retry. */
function eligible(organizationId: string, cutoff: Date, now: Date, retryFailed: boolean): SQL {
  return and(
    eq(screenshots.organizationId, organizationId),
    lt(screenshots.capturedAt, cutoff),
    lt(screenshots.purgeAttempts, retryFailed ? MAX_PURGE_ATTEMPTS : 1),
    or(isNull(screenshots.purgeNextAt), lte(screenshots.purgeNextAt, now)),
  )!;
}

/** Expired screenshots whose storage deletion has failed too often: left for an administrator. */
function stuck(organizationId: string, cutoff: Date, retryFailed: boolean): SQL {
  return and(eq(screenshots.organizationId, organizationId), lt(screenshots.capturedAt, cutoff), gte(screenshots.purgeAttempts, retryFailed ? MAX_PURGE_ATTEMPTS : 1))!;
}

/** Previews and manual runs an organization may start per hour (counted in the request's own transaction). */
const HOURLY_LIMIT = { PREVIEW: 20, MANUAL: 10 } as const;

async function assertUnderLimit(x: Ctx, trigger: keyof typeof HOURLY_LIMIT) {
  const since = new Date(x.deps.now().getTime() - 3600_000);
  const [r] = await x.tx
    .select({ n: count() })
    .from(screenshotCleanupRuns)
    .where(and(eq(screenshotCleanupRuns.organizationId, x.org.id), eq(screenshotCleanupRuns.trigger, trigger), gte(screenshotCleanupRuns.startedAt, since)));
  if (Number(r?.n ?? 0) >= HOURLY_LIMIT[trigger]) throw new DomainError('rate_limited', 'rate_limited', `Too many ${trigger === 'PREVIEW' ? 'previews' : 'cleanups'} in the last hour. Try again later.`);
}

function assertRead(x: Ctx) {
  if (!x.actor.grants['retention:manage'] && !x.actor.grants['settings:security']) throw forbidden();
}
function assertManage(x: Ctx) {
  if (!x.actor.grants['retention:manage']) throw forbidden('Only administrators who manage data retention can change screenshot cleanup');
}

/** Error text safe to store and show: no storage keys, URLs or tokens. */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/org\/[0-9a-f-]{36}\/\S*/gi, '[object]')
    .replace(/(bearer|token|key|secret)[=:\s]+\S+/gi, '$1 [redacted]')
    .slice(0, 300);
}

async function runDtos(tx: Tx, rows: Run[]): Promise<ScreenshotCleanupRunDto[]> {
  const names = await memberNames({ tx }, [...new Set(rows.map((r) => r.requestedBy).filter((v): v is string => !!v))]);
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    retention_days: r.retentionDays,
    policy_version: r.policyVersion,
    cutoff: r.cutoff.toISOString(),
    requested_by_name: r.requestedBy ? (names.get(r.requestedBy) ?? null) : null,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    scanned: r.scanned,
    deleted: r.deleted,
    objects_removed: r.objectsRemoved,
    bytes_reclaimed: r.bytesReclaimed,
    failed: r.failed,
    retries: r.retries,
    preview:
      r.trigger === 'PREVIEW'
        ? { eligible: r.eligibleCount ?? 0, eligible_bytes: r.eligibleBytes ?? 0, oldest_at: r.oldestEligibleAt?.toISOString() ?? null, newest_at: r.newestEligibleAt?.toISOString() ?? null, excluded: r.excludedCount ?? 0 }
        : null,
    error: r.error,
  }));
}

const runDto = async (tx: Tx, r: Run) => (await runDtos(tx, [r]))[0]!;

// ─── Admin operations ────────────────────────────────────────────────────────

export async function getScreenshotCleanup(x: Ctx): Promise<ScreenshotCleanupSettingsDto> {
  assertRead(x);
  const s = await loadSettings(x.tx, x.org.id);
  const [last] = await x.tx
    .select()
    .from(screenshotCleanupRuns)
    .where(and(eq(screenshotCleanupRuns.organizationId, x.org.id), inArray(screenshotCleanupRuns.trigger, ['SCHEDULED', 'MANUAL']), sql`${screenshotCleanupRuns.status} <> 'RUNNING'`))
    .orderBy(desc(screenshotCleanupRuns.startedAt), desc(screenshotCleanupRuns.id))
    .limit(1);
  const [active] = await x.tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.organizationId, x.org.id), eq(screenshotCleanupRuns.status, 'RUNNING')));
  const approvedBy = s.approvedBy ? ((await memberNames(x, [s.approvedBy])).get(s.approvedBy) ?? null) : null;
  const approved = isApproved(s);
  return {
    enabled: s.enabled,
    retention_days: s.retentionDays,
    frequency: s.frequency,
    run_at: s.runAt,
    weekday: s.weekday,
    timezone: s.timezone,
    effective_timezone: s.timezone ?? x.org.timezone,
    retry_failed: s.retryFailed,
    policy_version: s.policyVersion,
    approval: { approved, approved_at: approved ? s.approvedAt!.toISOString() : null, approved_by_name: approved ? approvedBy : null, preview_id: approved ? s.approvedPreviewId : null },
    next_run_at: s.enabled ? (s.nextRunAt ?? nextCleanupAt(x.deps.now(), scheduleOf(s), s.timezone ?? x.org.timezone)).toISOString() : null,
    last_run: last ? await runDto(x.tx, last) : null,
    active_run: active ? await runDto(x.tx, active) : null,
    can_manage: !!x.actor.grants['retention:manage'],
  };
}

/** Save the policy. A shorter retention period voids the approval: the next deletion needs a new preview. */
export async function updateScreenshotCleanup(x: Ctx, input: z.infer<typeof screenshotCleanupInput>): Promise<ScreenshotCleanupSettingsDto> {
  assertManage(x);
  const now = x.deps.now();
  const cur = await loadSettings(x.tx, x.org.id, true);
  const material = isMaterialRetentionChange(cur.retentionDays, input.retention_days);
  const next: Settings = {
    ...cur,
    enabled: input.enabled,
    retentionDays: input.retention_days,
    frequency: input.frequency,
    runAt: input.run_at,
    weekday: input.weekday,
    timezone: input.timezone,
    retryFailed: input.retry_failed,
    policyVersion: material ? cur.policyVersion + 1 : cur.policyVersion,
    ...(material ? { approvedAt: null, approvedBy: null, approvedPolicyVersion: null, approvedPreviewId: null } : {}),
    updatedBy: x.actor.membershipId,
  };
  next.nextRunAt = next.enabled ? nextCleanupAt(now, scheduleOf(next), next.timezone ?? x.org.timezone) : null;
  await saveSettings(x.tx, next, now);
  const view = (s: Settings) => ({ enabled: s.enabled, retention_days: s.retentionDays, frequency: s.frequency, run_at: s.runAt, weekday: s.weekday, timezone: s.timezone, retry_failed: s.retryFailed, policy_version: s.policyVersion });
  await audit(x, { action: 'screenshot_cleanup.updated', targetType: 'organization', targetId: x.org.id, before: view(cur), after: view(next), metadata: material && isApproved(cur) ? { approval_revoked: true } : undefined });
  return getScreenshotCleanup(x);
}

/** Dry run: what a cleanup would delete now. Never deletes anything. */
export async function previewScreenshotCleanup(x: Ctx): Promise<ScreenshotCleanupRunDto> {
  assertManage(x);
  await assertUnderLimit(x, 'PREVIEW');
  const now = x.deps.now();
  const s = await loadSettings(x.tx, x.org.id);
  const cutoff = cleanupCutoff(now, s.retentionDays);
  const [agg] = await x.tx
    .select({ n: count(), bytes: sql<string | null>`sum(${screenshots.bytes})`, oldest: sql<Date | null>`min(${screenshots.capturedAt})`, newest: sql<Date | null>`max(${screenshots.capturedAt})` })
    .from(screenshots)
    .where(eligible(x.org.id, cutoff, now, s.retryFailed));
  const [ex] = await x.tx.select({ n: count() }).from(screenshots).where(stuck(x.org.id, cutoff, s.retryFailed));
  const id = newId();
  const [row] = await x.tx
    .insert(screenshotCleanupRuns)
    .values({
      id,
      organizationId: x.org.id,
      trigger: 'PREVIEW',
      status: 'PREVIEWED',
      retentionDays: s.retentionDays,
      policyVersion: s.policyVersion,
      cutoff,
      requestedBy: x.actor.membershipId,
      startedAt: now,
      heartbeatAt: now,
      finishedAt: now,
      eligibleCount: Number(agg?.n ?? 0),
      eligibleBytes: Number(agg?.bytes ?? 0),
      oldestEligibleAt: agg?.oldest ? new Date(agg.oldest) : null,
      newestEligibleAt: agg?.newest ? new Date(agg.newest) : null,
      excludedCount: Number(ex?.n ?? 0),
    })
    .returning();
  await audit(x, { action: 'screenshot_cleanup.previewed', targetType: 'screenshot_cleanup_run', targetId: id, metadata: { cutoff: cutoff.toISOString(), eligible: row!.eligibleCount, retention_days: s.retentionDays } });
  return runDto(x.tx, row!);
}

/** Approve the first deletion, from a recent preview of the current policy. */
export async function approveScreenshotCleanup(x: Ctx, previewId: string): Promise<ScreenshotCleanupSettingsDto> {
  assertManage(x);
  const now = x.deps.now();
  const s = await loadSettings(x.tx, x.org.id, true);
  const [p] = await x.tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.id, previewId), eq(screenshotCleanupRuns.trigger, 'PREVIEW')));
  if (!p) throw notFound('preview');
  if (p.policyVersion !== s.policyVersion || p.retentionDays !== s.retentionDays || now.getTime() - p.startedAt.getTime() > PREVIEW_VALID_MS)
    throw conflict('preview_stale', 'This preview is out of date. Make a new preview, then approve it.');
  const next: Settings = { ...s, approvedAt: now, approvedBy: x.actor.membershipId, approvedPolicyVersion: s.policyVersion, approvedPreviewId: p.id };
  if (next.enabled && !next.nextRunAt) next.nextRunAt = nextCleanupAt(now, scheduleOf(next), next.timezone ?? x.org.timezone);
  await saveSettings(x.tx, next, now);
  await audit(x, { action: 'screenshot_cleanup.approved', targetType: 'screenshot_cleanup_run', targetId: p.id, metadata: { policy_version: s.policyVersion, retention_days: s.retentionDays, previewed_eligible: p.eligibleCount } });
  return getScreenshotCleanup(x);
}

/** Start a cleanup now. It runs in the background, never inside this request. */
export async function requestScreenshotCleanup(x: Ctx): Promise<ScreenshotCleanupRunDto> {
  assertManage(x);
  await assertUnderLimit(x, 'MANUAL');
  const now = x.deps.now();
  const s = await loadSettings(x.tx, x.org.id, true);
  if (!isApproved(s)) throw conflict('approval_required', 'Preview the cleanup and approve it before the first deletion.');
  const id = newId();
  const [row] = await x.tx
    .insert(screenshotCleanupRuns)
    .values({ id, organizationId: x.org.id, trigger: 'MANUAL', status: 'RUNNING', retentionDays: s.retentionDays, policyVersion: s.policyVersion, cutoff: cleanupCutoff(now, s.retentionDays), requestedBy: x.actor.membershipId, startedAt: now, heartbeatAt: now })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict('cleanup_running', 'A cleanup is already running. Wait for it to finish.');
  await audit(x, { action: 'screenshot_cleanup.requested', targetType: 'screenshot_cleanup_run', targetId: id, metadata: { cutoff: row.cutoff.toISOString(), retention_days: s.retentionDays } });
  x.deps.defer(() => processScreenshotCleanup(x.deps).then(() => undefined));
  return runDto(x.tx, row);
}

export async function listScreenshotCleanupRuns(x: Ctx): Promise<ScreenshotCleanupRunDto[]> {
  assertRead(x);
  const rows = await x.tx.select().from(screenshotCleanupRuns).where(eq(screenshotCleanupRuns.organizationId, x.org.id)).orderBy(desc(screenshotCleanupRuns.startedAt), desc(screenshotCleanupRuns.id)).limit(50);
  return runDtos(x.tx, rows);
}

export async function getScreenshotCleanupRun(x: Ctx, id: string): Promise<ScreenshotCleanupRunDto> {
  assertRead(x);
  const [row] = await x.tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.id, id), eq(screenshotCleanupRuns.organizationId, x.org.id)));
  if (!row) throw notFound('cleanup run');
  return runDto(x.tx, row);
}

export async function screenshotStorage(x: Ctx): Promise<ScreenshotStorageDto> {
  assertRead(x);
  const now = x.deps.now();
  const s = await loadSettings(x.tx, x.org.id);
  const cutoff = cleanupCutoff(now, s.retentionDays);
  const sum = (where: SQL) => x.tx.select({ n: count(), bytes: sql<string | null>`sum(${screenshots.bytes})` }).from(screenshots).where(where);
  const [all] = await sum(eq(screenshots.organizationId, x.org.id));
  const [old] = await sum(eligible(x.org.id, cutoff, now, s.retryFailed));
  const [st] = await x.tx.select({ n: count() }).from(screenshots).where(stuck(x.org.id, cutoff, s.retryFailed));
  return { screenshots: Number(all?.n ?? 0), recorded_bytes: Number(all?.bytes ?? 0), reclaimable_screenshots: Number(old?.n ?? 0), reclaimable_bytes: Number(old?.bytes ?? 0), stuck: Number(st?.n ?? 0) };
}

// ─── Background engine (minute tick) ─────────────────────────────────────────

async function alert(tx: Tx, deps: Deps, organizationId: string, s: Settings, key: string, title: string, body: string): Promise<void> {
  if (s.alertKey === key) return;
  await tx.update(screenshotCleanupSettings).set({ alertKey: key }).where(eq(screenshotCleanupSettings.organizationId, organizationId));
  await notify(tx, deps, organizationId, await membersWith(tx, organizationId, 'retention:manage'), { type: 'screenshot_cleanup.alert', title, body, link: '/settings/screenshot-retention' });
}

/** Start every approved, enabled cleanup whose time has come; move the schedule on either way. */
export async function startDueCleanups(deps: Deps): Promise<number> {
  const now = deps.now();
  const due = await withSystem(deps.db, (tx) =>
    tx.select({ org: screenshotCleanupSettings.organizationId }).from(screenshotCleanupSettings).where(and(eq(screenshotCleanupSettings.enabled, true), lte(screenshotCleanupSettings.nextRunAt, now))),
  );
  let started = 0;
  for (const { org } of due) {
    await withTenant(deps.db, org, async (tx) => {
      const s = await loadSettings(tx, org, true);
      if (!s.enabled || !s.nextRunAt || s.nextRunAt > now) return;
      const [o] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, org));
      // A missed run (the app was down) runs once now; the schedule continues from now, without catch-up runs.
      const nextRunAt = nextCleanupAt(now, scheduleOf(s), s.timezone ?? o?.tz ?? 'UTC');
      if (!isApproved(s)) {
        await tx.update(screenshotCleanupSettings).set({ nextRunAt }).where(eq(screenshotCleanupSettings.organizationId, org));
        return;
      }
      const id = newId();
      const [row] = await tx
        .insert(screenshotCleanupRuns)
        .values({ id, organizationId: org, trigger: 'SCHEDULED', status: 'RUNNING', retentionDays: s.retentionDays, policyVersion: s.policyVersion, cutoff: cleanupCutoff(now, s.retentionDays), startedAt: now, heartbeatAt: now })
        .onConflictDoNothing()
        .returning();
      await tx.update(screenshotCleanupSettings).set({ nextRunAt, ...(row ? { lastRunId: id } : {}) }).where(eq(screenshotCleanupSettings.organizationId, org));
      if (!row) return; // one is already running; it covers this run's work
      await auditSystem(tx, org, { action: 'screenshot_cleanup.started', targetType: 'screenshot_cleanup_run', targetId: id, metadata: { cutoff: row.cutoff.toISOString(), retention_days: s.retentionDays } });
      started++;
    });
  }
  return started;
}

type BatchResult = 'more' | 'done' | 'busy';

/**
 * One batch of one run, in one tenant transaction that holds the run's row lock (so no other worker
 * processes the same run) and skips screenshots another transaction has locked.
 */
export async function cleanupBatch(deps: Deps, organizationId: string, runId: string, batchSize = CLEANUP_BATCH): Promise<BatchResult> {
  return withTenant(deps.db, organizationId, async (tx) => {
    const now = deps.now();
    const [run] = await tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.id, runId), eq(screenshotCleanupRuns.status, 'RUNNING'))).for('update', { skipLocked: true });
    if (!run) return 'busy';
    const s = await loadSettings(tx, organizationId);
    // Turned off, or the policy changed under the run: stop deleting.
    if (!s.enabled && run.trigger === 'SCHEDULED') return finish(tx, deps, run, s, 'CANCELLED', 'Cleanup was turned off while it ran');
    if (run.policyVersion !== s.policyVersion || !isApproved(s)) return finish(tx, deps, run, s, 'CANCELLED', 'The retention policy changed while it ran; a new approval is needed');

    const rows = await tx
      .select({ id: screenshots.id, key: screenshots.storageKey, bytes: screenshots.bytes, attempts: screenshots.purgeAttempts })
      .from(screenshots)
      .where(eligible(organizationId, run.cutoff, now, s.retryFailed))
      .orderBy(asc(screenshots.capturedAt), asc(screenshots.id))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (!rows.length) return finish(tx, deps, run, s, null, null);

    // Only objects under this organization's prefix, taken from the screenshot's own record.
    const prefix = `org/${organizationId}/`;
    const foreign = rows.filter((r) => !r.key.startsWith(prefix) || r.key.includes('..'));
    const ours = rows.filter((r) => !foreign.includes(r));
    const keysOf = (r: (typeof rows)[number]) => [r.key, `${r.key}.thumb`];

    const ok: typeof rows = [];
    const failed: Array<{ row: (typeof rows)[number]; error: string }> = foreign.map((row) => ({ row, error: 'Storage key outside this organization; not deleted' }));
    try {
      // Deleting an object that is already gone succeeds, so a retry after a crash is safe.
      await deps.storage.delete(ours.flatMap(keysOf));
      ok.push(...ours);
    } catch {
      // Find which ones failed, so one bad object does not hold back the rest.
      for (const r of ours) {
        try {
          await deps.storage.delete(keysOf(r));
          ok.push(r);
        } catch (e) {
          failed.push({ row: r, error: sanitizeError(e) });
        }
      }
    }

    if (ok.length) await tx.delete(screenshots).where(and(eq(screenshots.organizationId, organizationId), inArray(screenshots.id, ok.map((r) => r.id))));
    for (const f of failed) {
      const attempts = f.row.attempts + 1;
      const permanent = foreign.includes(f.row);
      await tx
        .update(screenshots)
        .set({ purgeAttempts: permanent ? MAX_PURGE_ATTEMPTS : attempts, purgeNextAt: new Date(now.getTime() + purgeRetryDelayMs(attempts)), purgeError: f.error })
        .where(eq(screenshots.id, f.row.id));
    }
    await tx
      .update(screenshotCleanupRuns)
      .set({
        scanned: run.scanned + rows.length,
        deleted: run.deleted + ok.length,
        objectsRemoved: run.objectsRemoved + ok.length * 2,
        bytesReclaimed: run.bytesReclaimed + ok.reduce((n, r) => n + (r.bytes ?? 0), 0),
        failed: run.failed + failed.length,
        retries: run.retries + rows.filter((r) => r.attempts > 0).length,
        error: failed.length ? `${failed.length} could not be deleted from storage: ${failed[0]!.error}` : run.error,
        heartbeatAt: now,
      })
      .where(eq(screenshotCleanupRuns.id, run.id));
    return 'more';
  });
}

async function finish(tx: Tx, deps: Deps, run: Run, s: Settings, forced: Run['status'] | null, reason: string | null): Promise<'done'> {
  const now = deps.now();
  const status: Run['status'] = forced ?? (run.failed === 0 ? 'SUCCEEDED' : run.deleted > 0 ? 'PARTIAL' : 'FAILED');
  await tx.update(screenshotCleanupRuns).set({ status, finishedAt: now, heartbeatAt: now, error: reason ?? run.error }).where(eq(screenshotCleanupRuns.id, run.id));
  await auditSystem(tx, run.organizationId, {
    action: status === 'SUCCEEDED' ? 'screenshot_cleanup.completed' : status === 'CANCELLED' ? 'screenshot_cleanup.cancelled' : 'screenshot_cleanup.failed',
    targetType: 'screenshot_cleanup_run',
    targetId: run.id,
    metadata: { status, deleted: run.deleted, failed: run.failed, bytes_reclaimed: run.bytesReclaimed, reason },
  });
  if (status === 'SUCCEEDED') {
    if (s.alertKey) await tx.update(screenshotCleanupSettings).set({ alertKey: null }).where(eq(screenshotCleanupSettings.organizationId, run.organizationId));
  } else if (status === 'PARTIAL' || status === 'FAILED') {
    const [prev] = await tx
      .select({ status: screenshotCleanupRuns.status })
      .from(screenshotCleanupRuns)
      .where(and(eq(screenshotCleanupRuns.organizationId, run.organizationId), inArray(screenshotCleanupRuns.trigger, ['SCHEDULED', 'MANUAL']), lt(screenshotCleanupRuns.startedAt, run.startedAt)))
      .orderBy(desc(screenshotCleanupRuns.startedAt), desc(screenshotCleanupRuns.id))
      .limit(1);
    if (prev && (prev.status === 'PARTIAL' || prev.status === 'FAILED'))
      await alert(tx, deps, run.organizationId, s, 'repeated_failures', 'Screenshot cleanup keeps failing', `The last two cleanups could not delete every expired screenshot (${run.failed} failed this time). Check storage access.`);
    const [st] = await tx.select({ n: count() }).from(screenshots).where(stuck(run.organizationId, run.cutoff, s.retryFailed));
    if (Number(st?.n ?? 0) > 0)
      await alert(tx, deps, run.organizationId, s, 'stuck_objects', 'Some screenshots cannot be deleted from storage', `${st!.n} expired screenshots failed to delete after every retry. They stay listed until storage accepts the deletion.`);
  }
  return 'done';
}

/** Runs that stopped making progress: tell administrators, and close them after a while. */
async function checkStalled(deps: Deps): Promise<void> {
  const now = deps.now();
  const stale = await withSystem(deps.db, (tx) =>
    tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.status, 'RUNNING'), lt(screenshotCleanupRuns.heartbeatAt, new Date(now.getTime() - STALLED_MS)))),
  );
  for (const run of stale) {
    await withTenant(deps.db, run.organizationId, async (tx) => {
      const s = await loadSettings(tx, run.organizationId);
      if (now.getTime() - run.heartbeatAt.getTime() > ABANDON_MS) {
        const [locked] = await tx.select().from(screenshotCleanupRuns).where(and(eq(screenshotCleanupRuns.id, run.id), eq(screenshotCleanupRuns.status, 'RUNNING'))).for('update', { skipLocked: true });
        if (locked) await finish(tx, deps, locked, s, 'FAILED', 'Stopped making progress; the next run continues with what is left');
      }
      await alert(tx, deps, run.organizationId, s, `stalled:${run.id}`, 'Screenshot cleanup has stalled', 'A cleanup run has made no progress for 30 minutes.');
    });
  }
}

/** Process running cleanups batch by batch until done or the tick's time budget is used. */
export async function processScreenshotCleanup(deps: Deps, budgetMs = TICK_BUDGET_MS): Promise<{ batches: number }> {
  const started = Date.now();
  let batches = 0;
  const runs = await withSystem(deps.db, (tx) => tx.select({ id: screenshotCleanupRuns.id, org: screenshotCleanupRuns.organizationId }).from(screenshotCleanupRuns).where(eq(screenshotCleanupRuns.status, 'RUNNING')).orderBy(asc(screenshotCleanupRuns.startedAt)));
  for (const r of runs) {
    while (Date.now() - started < budgetMs) {
      let res: BatchResult;
      try {
        res = await cleanupBatch(deps, r.org, r.id);
      } catch (e) {
        // A database error: the batch rolled back and nothing was lost; the next tick tries again.
        await withTenant(deps.db, r.org, (tx) => tx.update(screenshotCleanupRuns).set({ error: sanitizeError(e) }).where(eq(screenshotCleanupRuns.id, r.id))).catch(() => undefined);
        break;
      }
      if (res !== 'more') break;
      batches++;
    }
  }
  return { batches };
}

/** Minute tick: start due runs, continue running ones, watch for stalls. */
export async function runScreenshotCleanup(deps: Deps): Promise<{ started: number; batches: number }> {
  const started = await startDueCleanups(deps);
  const { batches } = await processScreenshotCleanup(deps);
  await checkStalled(deps);
  return { started, batches };
}

/** Daily: tell administrators when an approved, enabled cleanup has not succeeded for too long. */
export async function checkOverdueCleanups(deps: Deps): Promise<void> {
  const now = deps.now();
  const rows = await withSystem(deps.db, (tx) => tx.select().from(screenshotCleanupSettings).where(eq(screenshotCleanupSettings.enabled, true)));
  for (const s of rows) {
    if (!isApproved(s)) continue;
    const intervalDays = s.frequency === 'WEEKLY' ? 7 : 1;
    await withTenant(deps.db, s.organizationId, async (tx) => {
      const [ok] = await tx
        .select({ at: sql<Date | null>`max(${screenshotCleanupRuns.finishedAt})` })
        .from(screenshotCleanupRuns)
        .where(and(eq(screenshotCleanupRuns.organizationId, s.organizationId), eq(screenshotCleanupRuns.status, 'SUCCEEDED')));
      const since = ok?.at ? new Date(ok.at) : s.approvedAt!;
      if (now.getTime() - since.getTime() > (intervalDays * 2 + 1) * 86_400_000)
        await alert(tx, deps, s.organizationId, s, 'overdue', 'Screenshot cleanup has not run successfully', `No cleanup has succeeded since ${since.toISOString().slice(0, 10)}.`);
    });
  }
}
