import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { reportRuns, savedReports } from '@tallywork/db';
import { apiKeyInput, dashboardLayoutInput, exportInput, reportQueryInput, retentionInput, savedReportInput, webhookInput } from '@tallywork/contracts';
import { newId, notFound } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { toCsv, toPdf, toXlsx } from '../lib/export';
import { ctx } from '../services/ctx';
import { audit } from '../services/events';
import { getLayout, resetLayout, saveLayout, widgetData } from '../services/dashboard';
import { reportCatalog, runReport } from '../services/reports';
import {
  WEBHOOK_EVENTS,
  createApiKey,
  deleteWebhook,
  fileForDownload,
  getNotificationPrefs,
  getRetention,
  listApiKeys,
  listAudit,
  listDeliveries,
  listNotifications,
  listWebhooks,
  markNotificationsRead,
  replayDelivery,
  revokeApiKey,
  setNotificationPrefs,
  setRetention,
  testWebhook,
  uploadReceipt,
  upsertWebhook,
} from '../services/platform';

const scope = z.enum(['ALL', 'ME', 'WORKER']);

export const insightRoutes = new Hono<AppEnv>()
  .get('/dashboard/layout', async (c) => c.json(await getLayout(ctx(c), scope.parse(c.req.query('scope') ?? 'ALL'))))
  .put('/dashboard/layout', async (c) => c.json(await saveLayout(ctx(c), await body(c, dashboardLayoutInput))))
  .delete('/dashboard/layout', async (c) => c.json(await resetLayout(ctx(c), scope.parse(c.req.query('scope') ?? 'ALL'))))
  .get('/dashboard/widgets', async (c) => {
    const q = query(c, z.object({ keys: z.string().max(1000), scope: scope.default('ALL'), membership_id: z.uuid().optional() }));
    return c.json(await widgetData(ctx(c), q.keys.split(','), q.scope, q.membership_id));
  })

  .get('/reports', async (c) => c.json(reportCatalog(ctx(c))))
  .post('/reports/:key/query', async (c) => c.json(await runReport(ctx(c), c.req.param('key'), await body(c, reportQueryInput))))
  .post('/reports/:key/export', async (c) => {
    const x = ctx(c);
    const input = await body(c, exportInput);
    const { format, ...params } = input;
    const result = await runReport(x, c.req.param('key'), params);
    const runId = newId();
    await x.tx.insert(reportRuns).values({ id: runId, organizationId: x.org.id, membershipId: x.actor.membershipId, reportKey: result.key, format, params, status: 'DONE', rowCount: result.rows.length, startedAt: new Date(), finishedAt: new Date() });
    await audit(x, { action: 'report.exported', targetType: 'report', targetId: result.key, metadata: { format, rows: result.rows.length, from: params.from, to: params.to } });
    const base = `${result.key}_${params.from}_${params.to}`;
    if (format === 'CSV') return new Response(toCsv(result), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` } });
    if (format === 'XLSX') return new Response(new Uint8Array(await toXlsx(result)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"` } });
    return new Response(new Uint8Array(await toPdf(result, `${x.org.name} · ${params.from} – ${params.to}`)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${base}.pdf"` } });
  })
  .get('/saved-reports', async (c) => {
    const x = ctx(c);
    const rows = await x.tx.select().from(savedReports);
    return c.json(rows.filter((r) => r.membershipId === x.actor.membershipId || r.shared).map((r) => ({ id: r.id, report_key: r.reportKey, name: r.name, params: r.params, shared: r.shared, schedule_cron: r.scheduleCron, owner: r.membershipId === x.actor.membershipId })));
  })
  .post('/saved-reports', async (c) => {
    const x = ctx(c);
    const i = await body(c, savedReportInput);
    const id = newId();
    await x.tx.insert(savedReports).values({ id, organizationId: x.org.id, membershipId: x.actor.membershipId, reportKey: i.report_key, name: i.name, params: i.params, shared: i.shared, scheduleCron: i.schedule_cron ?? null, scheduleTimezone: i.schedule_timezone ?? null, recipients: i.recipients });
    return c.json({ id }, 201);
  })
  .delete('/saved-reports/:id', async (c) => {
    const x = ctx(c);
    const [r] = await x.tx.select().from(savedReports).where(eq(savedReports.id, c.req.param('id')));
    if (!r || r.membershipId !== x.actor.membershipId) throw notFound('saved_report');
    await x.tx.delete(savedReports).where(eq(savedReports.id, r.id));
    return c.body(null, 204);
  })

  .get('/notifications', async (c) => c.json(await listNotifications(ctx(c), c.req.query('unread') === 'true')))
  .post('/notifications/read', async (c) => {
    const i = await body(c, z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(200)]) }));
    await markNotificationsRead(ctx(c), i.ids);
    return c.body(null, 204);
  })
  .get('/notification-preferences', async (c) => c.json(await getNotificationPrefs(ctx(c))))
  .put('/notification-preferences', async (c) => c.json(await setNotificationPrefs(ctx(c), (await body(c, z.object({ preferences: z.array(z.object({ type: z.string().max(60), in_app: z.boolean(), email: z.boolean() })).max(100) }))).preferences)));

export const platformRoutes = new Hono<AppEnv>()
  .get('/api-keys', async (c) => c.json(await listApiKeys(ctx(c))))
  .post('/api-keys', async (c) => c.json(await createApiKey(ctx(c), await body(c, apiKeyInput)), 201))
  .delete('/api-keys/:id', async (c) => {
    await revokeApiKey(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/webhooks', async (c) => c.json({ endpoints: await listWebhooks(ctx(c)), events: WEBHOOK_EVENTS }))
  .post('/webhooks', async (c) => c.json(await upsertWebhook(ctx(c), null, await body(c, webhookInput)), 201))
  .patch('/webhooks/:id', async (c) => c.json(await upsertWebhook(ctx(c), c.req.param('id'), await body(c, webhookInput))))
  .delete('/webhooks/:id', async (c) => {
    await deleteWebhook(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/webhooks/:id/deliveries', async (c) => c.json(await listDeliveries(ctx(c), c.req.param('id'))))
  .post('/webhooks/:id/deliveries/:deliveryId/replay', async (c) => c.json(await replayDelivery(ctx(c), c.req.param('id'), c.req.param('deliveryId'))))
  .post('/webhooks/:id/test', async (c) => c.json(await testWebhook(ctx(c), c.req.param('id'))))
  .get('/audit-logs', async (c) => {
    const q = query(c, z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), action: z.string().max(60).optional(), target_type: z.string().max(40).optional(), target_id: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }));
    return c.json(await listAudit(ctx(c), { from: q.from, to: q.to, action: q.action, targetType: q.target_type, targetId: q.target_id, limit: q.limit }));
  })
  .get('/retention-policies', async (c) => c.json(await getRetention(ctx(c))))
  .put('/retention-policies', async (c) => c.json(await setRetention(ctx(c), await body(c, retentionInput))))
  .post('/files/receipts', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw notFound('file');
    return c.json(await uploadReceipt(ctx(c), file), 201);
  })
  .get('/files/:id', async (c) => {
    const x = ctx(c);
    const f = await fileForDownload(x, c.req.param('id'));
    const obj = await x.deps.storage.get(f.storageKey);
    if (!obj) throw notFound('file');
    return new Response(obj.body, { headers: { 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' } });
  });
