import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { fileObjects, memberships, organizations, reportRuns, savedReports, users, withSystem, withTenant, type Tx } from '@tallywork/db';
import { REPORT_RANGES, cronMatches, forbidden, localDate, newId, notFound, parseCron, resolveRange, validation, type ReportRange } from '@tallywork/domain';
import { reportQueryInput, type savedReportInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import { signToken } from '../lib/crypto';
import { csvStream, toPdf, toXlsx } from '../lib/export';
import { loadActor, loadOrg } from '../middleware/tenant';
import type { Ctx } from './ctx';
import { audit } from './events';
import { notify } from './notify';
import { REPORTS, mayRun, runReport, type ReportParams } from './reports';
import { DATA_EXPORT_KEY, collectMemberData } from './privacy';
import { renderEmail } from '../lib/email';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';
const EXT: Record<ExportFormat | 'JSON', { ext: string; type: string }> = {
  JSON: { ext: 'json', type: 'application/json' },
  CSV: { ext: 'csv', type: 'text/csv; charset=utf-8' },
  XLSX: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  PDF: { ext: 'pdf', type: 'application/pdf' },
};
/** Links in the app are short-lived; links emailed by a schedule last a week. */
const LINK_TTL_SECONDS = 15 * 60;
const EMAIL_LINK_TTL_SECONDS = 7 * 86400;

/** A signed download link for an export file (served by the /media route with a file name). */
export function exportLink(deps: Deps, organizationId: string, storageKey: string, fileName: string, ttlSeconds: number, absolute = false): string {
  const token = signToken(deps.config.appSecret, 'media', { k: storageKey, o: organizationId, v: 'full', n: fileName }, ttlSeconds);
  return `${absolute ? deps.config.appUrl : ''}/api/v1/media/${token}`;
}

/**
 * Saved/scheduled report params → concrete query params. A `range` (e.g. `last_week`) is
 * resolved on the day the report runs, in the organization's time zone.
 */
export function resolveParams(raw: Record<string, unknown>, today: string, weekStart: number): ReportParams {
  const { range, format: _format, ...rest } = raw;
  const dates = typeof range === 'string' && (REPORT_RANGES as readonly string[]).includes(range) ? resolveRange(range as ReportRange, today, weekStart) : {};
  const parsed = reportQueryInput.safeParse({ ...rest, ...dates });
  if (!parsed.success) throw fieldError('params', 'The report parameters are not valid: set a date range or a relative range');
  return parsed.data;
}

/** A 400 whose message is also attached to one field (the web shows it next to that field). */
const fieldError = (field: string, message: string) => validation(message, { errors: [{ field, message }] });

function formatOf(raw: Record<string, unknown>): ExportFormat {
  return raw.format === 'XLSX' || raw.format === 'PDF' ? raw.format : 'CSV';
}

function assertReport(x: Pick<Ctx, 'actor'>, key: string) {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw notFound('report');
  if (!mayRun(x, def)) throw forbidden();
  return def;
}

type RunRow = typeof reportRuns.$inferSelect;
function runDto(deps: Deps, r: RunRow, file: { storageKey: string } | null) {
  const name = r.reportKey === DATA_EXPORT_KEY ? `personal-data_${r.createdAt.toISOString().slice(0, 10)}.json` : `${r.reportKey}_${(r.params as { from?: string }).from ?? ''}_${(r.params as { to?: string }).to ?? ''}.${EXT[r.format].ext}`;
  return {
    id: r.id,
    report_key: r.reportKey,
    format: r.format,
    status: r.status,
    row_count: r.rowCount,
    error: r.error,
    scheduled: !!r.savedReportId,
    created_at: r.createdAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    download_url: r.status === 'DONE' && file ? exportLink(deps, r.organizationId, file.storageKey, name, LINK_TTL_SECONDS) : null,
  };
}

// ─── Exports run in the background ───────────────────────────────────────────
export async function queueExport(x: Ctx, key: string, params: ReportParams, format: ExportFormat) {
  assertReport(x, key);
  const id = newId();
  const [row] = await x.tx.insert(reportRuns).values({ id, organizationId: x.org.id, membershipId: x.actor.membershipId, reportKey: key, format, params }).returning();
  await audit(x, { action: 'report.export_queued', targetType: 'report', targetId: key, metadata: { run_id: id, format, from: params.from, to: params.to } });
  x.deps.defer(() => processReportRuns(x.deps).then(() => undefined));
  return runDto(x.deps, row!, null);
}

export async function listRuns(x: Ctx) {
  const rows = await x.tx.select().from(reportRuns).where(eq(reportRuns.membershipId, x.actor.membershipId)).orderBy(desc(reportRuns.createdAt)).limit(50);
  const files = rows.some((r) => r.fileId) ? await x.tx.select({ id: fileObjects.id, storageKey: fileObjects.storageKey }).from(fileObjects).where(inArray(fileObjects.id, rows.filter((r) => r.fileId).map((r) => r.fileId!))) : [];
  return rows.map((r) => runDto(x.deps, r, files.find((f) => f.id === r.fileId) ?? null));
}

/**
 * Process queued runs: each as the member who asked for it (permissions and scope as of now),
 * stored as a private file, delivered by signed link (in-app, or by email for schedules).
 */
export async function processReportRuns(deps: Deps, limit = 5): Promise<number> {
  const queued = await withSystem(deps.db, (tx) => tx.select({ id: reportRuns.id, org: reportRuns.organizationId }).from(reportRuns).where(eq(reportRuns.status, 'QUEUED')).orderBy(reportRuns.createdAt).limit(limit));
  let done = 0;
  for (const q of queued) {
    const claimed = await withSystem(deps.db, (tx) => tx.update(reportRuns).set({ status: 'RUNNING', startedAt: deps.now() }).where(and(eq(reportRuns.id, q.id), eq(reportRuns.status, 'QUEUED'))).returning());
    const run = claimed[0];
    if (!run) continue;
    try {
      await withTenant(deps.db, q.org, (tx) => executeRun(tx, deps, run));
      done++;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : 'Export failed';
      await withSystem(deps.db, (tx) => tx.update(reportRuns).set({ status: 'FAILED', error: message, finishedAt: deps.now() }).where(eq(reportRuns.id, run.id)));
    }
  }
  return done;
}

async function memberCtx(tx: Tx, deps: Deps, organizationId: string, membershipId: string): Promise<Ctx> {
  const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, membershipId));
  if (!m) throw forbidden('The member who owns this report no longer exists');
  const actor = await loadActor(tx, { type: 'user', userId: m.userId, sessionId: 'report-run', mfaVerified: true }, organizationId, membershipId);
  return { tx, deps, actor, org: await loadOrg(tx, organizationId), requestId: 'report-run', ip: null, userAgent: null, policyCache: new Map() };
}

async function executeRun(tx: Tx, deps: Deps, run: RunRow) {
  const x = await memberCtx(tx, deps, run.organizationId, run.membershipId);
  if (run.reportKey === DATA_EXPORT_KEY) return executeDataExport(x, run);
  const params = run.params as ReportParams;
  const result = await runReport(x, run.reportKey, params);
  const fmt = EXT[run.format];
  const body = run.format === 'CSV' ? csvStream(result) : run.format === 'XLSX' ? await toXlsx(result) : await toPdf(result, `${x.org.name} · ${params.from} – ${params.to}`);
  const storageKey = `org/${run.organizationId}/exports/${run.id}.${fmt.ext}`;
  await deps.storage.put(storageKey, body, fmt.type);
  const fileId = newId();
  await tx.insert(fileObjects).values({ id: fileId, organizationId: run.organizationId, purpose: 'EXPORT', storageKey, contentType: fmt.type, uploadedBy: run.membershipId });
  await tx.update(reportRuns).set({ status: 'DONE', fileId, rowCount: result.rows.length, finishedAt: deps.now() }).where(eq(reportRuns.id, run.id));
  const fileName = `${run.reportKey}_${params.from}_${params.to}.${fmt.ext}`;

  if (run.savedReportId) {
    const [saved] = await tx.select().from(savedReports).where(eq(savedReports.id, run.savedReportId));
    const to = saved ? await memberEmails(tx, saved.recipients) : [];
    const link = exportLink(deps, run.organizationId, storageKey, fileName, EMAIL_LINK_TTL_SECONDS, true);
    for (const email of to) {
      await deps.mailer
        .send(
          renderEmail(
            {
              subject: `${saved!.name} — ${params.from} to ${params.to}`,
              preheader: `${result.title}, ${result.rows.length} rows, ready to download.`,
              heading: saved!.name,
              paragraphs: [`Your scheduled report from ${x.org.name} is ready.`],
              details: [
                { label: 'Report', value: result.title },
                { label: 'Period', value: `${params.from} – ${params.to}` },
                { label: 'Rows', value: String(result.rows.length) },
              ],
              action: { label: 'Download report', url: link },
              note: 'The download link is valid for 7 days.',
              reason: `You received this email because you are a recipient of the scheduled report “${saved!.name}”.`,
            },
            { appUrl: deps.config.appUrl, to: email },
          ),
        )
        .catch(() => undefined);
    }
  }
  await notify(tx, deps, run.organizationId, [run.membershipId], { type: 'report.ready', title: `${result.title} export is ready`, body: `${params.from} – ${params.to}, ${result.rows.length} rows`, link: `/reports?runs=1`, payload: { run_id: run.id } });
}

/** A personal data export (access request), checked again at run time against the requester's rights. */
async function executeDataExport(x: Ctx, run: RunRow) {
  const subject = (run.params as { membership_id: string }).membership_id;
  if (subject !== x.actor.membershipId && !x.actor.grants['members:manage']) throw forbidden();
  const data = await collectMemberData(x.tx, subject);
  const storageKey = `org/${run.organizationId}/exports/${run.id}.json`;
  const body = Buffer.from(JSON.stringify(data, null, 2));
  await x.deps.storage.put(storageKey, body, 'application/json');
  const fileId = newId();
  await x.tx.insert(fileObjects).values({ id: fileId, organizationId: run.organizationId, purpose: 'EXPORT', storageKey, contentType: 'application/json', bytes: body.length, uploadedBy: run.membershipId });
  await x.tx.update(reportRuns).set({ status: 'DONE', fileId, rowCount: data.time_entries.length, finishedAt: x.deps.now() }).where(eq(reportRuns.id, run.id));
  await audit(x, { action: 'privacy.export_completed', targetType: 'membership', targetId: subject, metadata: { run_id: run.id, bytes: body.length } });
  await notify(x.tx, x.deps, run.organizationId, [run.membershipId], { type: 'report.ready', title: 'Personal data export is ready', body: data.account?.name ?? '', link: '/reports?runs=1', payload: { run_id: run.id } });
}

/** Only active members of the organization receive scheduled reports (no external addresses). */
async function memberEmails(tx: Tx, emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const rows = await tx.select({ email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.status, 'ACTIVE'), inArray(sql`lower(${users.email})`, emails.map((e) => e.toLowerCase()))));
  return rows.map((r) => r.email);
}

// ─── Saved and scheduled reports ─────────────────────────────────────────────
function savedDto(x: Ctx, r: typeof savedReports.$inferSelect) {
  return {
    id: r.id,
    report_key: r.reportKey,
    name: r.name,
    params: r.params,
    shared: r.shared,
    schedule_cron: r.scheduleCron,
    schedule_timezone: r.scheduleTimezone,
    recipients: r.recipients,
    last_run_at: r.lastRunAt?.toISOString() ?? null,
    owner: r.membershipId === x.actor.membershipId,
  };
}

export async function listSavedReports(x: Ctx) {
  const rows = await x.tx.select().from(savedReports).orderBy(savedReports.name);
  // Shared reports are listed only for members who may run that report.
  return rows.filter((r) => r.membershipId === x.actor.membershipId || (r.shared && REPORTS.some((d) => d.key === r.reportKey && mayRun(x, d)))).map((r) => savedDto(x, r));
}

async function validateSaved(x: Ctx, i: z.infer<typeof savedReportInput>) {
  assertReport(x, i.report_key);
  resolveParams(i.params, localDate(x.deps.now(), x.org.timezone), x.org.weekStart);
  if (i.schedule_cron && !parseCron(i.schedule_cron)) throw fieldError('schedule_cron', 'The schedule is not a valid cron expression (minute hour day month weekday)');
  if (i.schedule_cron && !i.recipients.length) throw fieldError('recipients', 'Add at least one recipient for a scheduled report');
  const known = new Set((await memberEmails(x.tx, i.recipients)).map((e) => e.toLowerCase()));
  const unknown = i.recipients.filter((e) => !known.has(e.toLowerCase()));
  if (unknown.length) throw fieldError('recipients', `Recipients must be members of this organization: ${unknown.join(', ')}`);
}

export async function createSavedReport(x: Ctx, i: z.infer<typeof savedReportInput>) {
  await validateSaved(x, i);
  const id = newId();
  const [row] = await x.tx
    .insert(savedReports)
    .values({ id, organizationId: x.org.id, membershipId: x.actor.membershipId, reportKey: i.report_key, name: i.name, params: i.params, shared: i.shared, scheduleCron: i.schedule_cron ?? null, scheduleTimezone: i.schedule_timezone ?? null, recipients: i.recipients, lastRunAt: i.schedule_cron ? x.deps.now() : null })
    .returning();
  await audit(x, { action: 'saved_report.created', targetType: 'saved_report', targetId: id, after: i });
  return savedDto(x, row!);
}

export async function updateSavedReport(x: Ctx, id: string, i: z.infer<typeof savedReportInput>) {
  const [r] = await x.tx.select().from(savedReports).where(eq(savedReports.id, id));
  if (!r || r.membershipId !== x.actor.membershipId) throw notFound('saved_report');
  await validateSaved(x, i);
  const scheduleChanged = (i.schedule_cron ?? null) !== r.scheduleCron;
  const [row] = await x.tx
    .update(savedReports)
    .set({ name: i.name, params: i.params, shared: i.shared, scheduleCron: i.schedule_cron ?? null, scheduleTimezone: i.schedule_timezone ?? null, recipients: i.recipients, ...(scheduleChanged ? { lastRunAt: i.schedule_cron ? x.deps.now() : null } : {}), updatedAt: new Date() })
    .where(eq(savedReports.id, id))
    .returning();
  await audit(x, { action: 'saved_report.updated', targetType: 'saved_report', targetId: id, before: r, after: i });
  return savedDto(x, row!);
}

/**
 * Every minute: queue each scheduled report whose cron fired since it last ran (looking back at
 * most an hour, so a missed tick still runs it once). Runs are processed right after.
 */
export async function runSchedules(deps: Deps): Promise<{ queued: number; processed: number }> {
  const now = deps.now();
  const due = await withSystem(deps.db, (tx) =>
    tx.select({ s: savedReports, tz: organizations.timezone, weekStart: organizations.weekStart }).from(savedReports).innerJoin(organizations, eq(organizations.id, savedReports.organizationId)).where(isNotNull(savedReports.scheduleCron)),
  );
  let queued = 0;
  for (const { s, tz, weekStart } of due) {
    const cron = parseCron(s.scheduleCron!);
    if (!cron) continue;
    const zone = s.scheduleTimezone ?? tz;
    const since = Math.max((s.lastRunAt ?? s.createdAt).getTime(), now.getTime() - 3600_000);
    let fired = false;
    for (let m = Math.floor(since / 60_000) * 60_000 + 60_000; m <= now.getTime(); m += 60_000) {
      if (cronMatches(cron, new Date(m), zone)) {
        fired = true;
        break;
      }
    }
    if (!fired) continue;
    await withTenant(deps.db, s.organizationId, async (tx) => {
      // Claim this firing (another tick may be running the same minute).
      const claim = await tx.update(savedReports).set({ lastRunAt: now }).where(and(eq(savedReports.id, s.id), s.lastRunAt ? eq(savedReports.lastRunAt, s.lastRunAt) : sql`${savedReports.lastRunAt} is null`)).returning({ id: savedReports.id });
      if (!claim.length) return;
      let params: ReportParams | null = null;
      let error: string | null = null;
      try {
        params = resolveParams(s.params, localDate(now, tz), weekStart);
      } catch (e) {
        error = e instanceof Error ? e.message : 'Invalid parameters';
      }
      await tx.insert(reportRuns).values({ id: newId(), organizationId: s.organizationId, membershipId: s.membershipId, savedReportId: s.id, reportKey: s.reportKey, format: formatOf(s.params), params: params ?? s.params, status: error ? 'FAILED' : 'QUEUED', error, finishedAt: error ? now : null });
      if (!error) queued++;
    });
  }
  const processed = queued ? await processReportRuns(deps, queued + 5) : 0;
  return { queued, processed };
}
