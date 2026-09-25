import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { orgId, pk, timestamps, tstz } from './_helpers';

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    link: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.membershipId, t.readAt, t.createdAt)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    type: text().notNull(),
    inApp: boolean().notNull().default(true),
    email: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.type] })],
);

export const dashboardLayouts = pgTable(
  'dashboard_layouts',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    scope: text().$type<'ALL' | 'ME' | 'WORKER'>().notNull(),
    widgets: jsonb().$type<Array<{ key: string; size: 'S' | 'M' | 'L'; settings?: Record<string, unknown> }>>().notNull(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.scope] })],
);

export const savedReports = pgTable('saved_reports', {
  id: pk(),
  organizationId: orgId(),
  membershipId: uuid().notNull(),
  reportKey: text().notNull(),
  name: text().notNull(),
  params: jsonb().$type<Record<string, unknown>>().notNull(),
  shared: boolean().notNull().default(false),
  scheduleCron: text(),
  scheduleTimezone: text(),
  recipients: jsonb().$type<string[]>().notNull().default([]),
  lastRunAt: tstz(),
  ...timestamps,
});

export const reportRuns = pgTable(
  'report_runs',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    reportKey: text().notNull(),
    format: text().$type<'CSV' | 'XLSX' | 'PDF'>().notNull(),
    /** set for runs started by a schedule; the saved report holds the recipients */
    savedReportId: uuid(),
    params: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().$type<'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'>().notNull().default('QUEUED'),
    fileId: uuid(),
    rowCount: integer(),
    error: text(),
    startedAt: tstz(),
    finishedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.status, t.createdAt)],
);

export const apiKeys = pgTable('api_keys', {
  id: pk(),
  organizationId: orgId(),
  name: text().notNull(),
  prefix: text().notNull().unique(),
  secretHash: text().notNull(),
  scopes: jsonb().$type<string[]>().notNull(),
  createdBy: uuid().notNull(),
  lastUsedAt: tstz(),
  expiresAt: tstz(),
  revokedAt: tstz(),
  createdAt: tstz().notNull().default(sql`now()`),
});

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: pk(),
  organizationId: orgId(),
  url: text().notNull(),
  description: text(),
  secretEnc: text().notNull(),
  events: jsonb().$type<string[]>().notNull(),
  enabled: boolean().notNull().default(true),
  failureCount: integer().notNull().default(0),
  disabledReason: text(),
  ...timestamps,
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    organizationId: orgId(),
    endpointId: uuid().notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    attempt: integer().notNull().default(0),
    status: text().$type<'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD'>().notNull().default('PENDING'),
    responseStatus: integer(),
    responseBody: text(),
    durationMs: integer(),
    nextAttemptAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.status, t.nextAttemptAt), index().on(t.endpointId, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    organizationId: orgId(),
    actorType: text().$type<'user' | 'agent' | 'system' | 'api_key'>().notNull(),
    actorId: uuid(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ipAddress: text(),
    userAgent: text(),
    requestId: text(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.createdAt), index().on(t.organizationId, t.targetType, t.targetId)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid().primaryKey(),
    organizationId: orgId(),
    eventType: text().notNull(),
    eventVersion: integer().notNull().default(1),
    envelope: jsonb().notNull(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    processedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index('outbox_pending_idx').on(t.createdAt).where(sql`${t.processedAt} is null`)],
);

export const retentionPolicies = pgTable(
  'retention_policies',
  {
    organizationId: orgId(),
    dataClass: text()
      .$type<'SCREENSHOTS' | 'ACTIVITY' | 'APPS' | 'URLS' | 'SESSIONS' | 'TIMESHEETS' | 'INVOICES' | 'AUDIT' | 'LOCATION'>()
      .notNull(),
    keepDays: integer().notNull(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.dataClass] })],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    principal: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    responseStatus: integer().notNull(),
    responseBody: jsonb().notNull(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.principal, t.key] })],
);

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text().primaryKey(),
  count: integer().notNull(),
  windowStart: tstz().notNull(),
});


/** One row per digest email sent, so the daily job sends each member at most one per day. */
export const digestSends = pgTable(
  'digest_sends',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    digestDate: text().notNull(),
    sentAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.digestDate] })],
);
