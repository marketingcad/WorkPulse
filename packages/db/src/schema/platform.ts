import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    format: text().$type<'CSV' | 'XLSX' | 'PDF' | 'JSON'>().notNull(),
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
    actorType: text().$type<'user' | 'agent' | 'system' | 'api_key' | 'support' | 'client'>().notNull(),
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
  (t) => [index().on(t.organizationId, t.createdAt), index().on(t.organizationId, t.targetType, t.targetId), index().on(t.organizationId, t.actorId)],
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
    /** a shorter keep period waits 7 days before it takes effect, so an accidental change can be undone */
    pendingKeepDays: integer(),
    pendingFrom: tstz(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.dataClass] })],
);

/**
 * Screenshot retention & cleanup, one row per organization (no row = the defaults, not yet approved).
 * Screenshots are owned here rather than by retention_policies: deletion needs a preview and an
 * administrator's approval first, and runs on the organization's own schedule.
 */
export const screenshotCleanupSettings = pgTable('screenshot_cleanup_settings', {
  organizationId: uuid().primaryKey(),
  enabled: boolean().notNull().default(true),
  retentionDays: integer().notNull().default(30),
  frequency: text().$type<'DAILY' | 'WEEKLY'>().notNull().default('DAILY'),
  /** local wall time 'HH:MM' */
  runAt: text().notNull().default('02:00'),
  /** for WEEKLY: 0 = Sunday … 6 = Saturday */
  weekday: smallint().notNull().default(0),
  /** null = the organization's time zone */
  timezone: text(),
  retryFailed: boolean().notNull().default(true),
  /** bumped when the retention period gets shorter; an approval is for one version */
  policyVersion: integer().notNull().default(1),
  approvedAt: tstz(),
  approvedBy: uuid(),
  approvedPolicyVersion: integer(),
  approvedPreviewId: uuid(),
  nextRunAt: tstz(),
  lastRunId: uuid(),
  /** the open incident already notified about (repeated failures, stalled run…), so it is sent once */
  alertKey: text(),
  updatedBy: uuid(),
  ...timestamps,
});

export const screenshotCleanupRuns = pgTable(
  'screenshot_cleanup_runs',
  {
    id: pk(),
    organizationId: orgId(),
    trigger: text().$type<'SCHEDULED' | 'MANUAL' | 'PREVIEW'>().notNull(),
    status: text().$type<'PREVIEWED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'>().notNull(),
    retentionDays: integer().notNull(),
    policyVersion: integer().notNull(),
    /** fixed when the run starts; only screenshots captured strictly before it are deleted */
    cutoff: tstz().notNull(),
    requestedBy: uuid(),
    startedAt: tstz().notNull().default(sql`now()`),
    /** updated after every batch; a running run with an old heartbeat has stalled */
    heartbeatAt: tstz().notNull().default(sql`now()`),
    finishedAt: tstz(),
    scanned: integer().notNull().default(0),
    deleted: integer().notNull().default(0),
    objectsRemoved: integer().notNull().default(0),
    /** sum of the recorded image sizes of deleted screenshots (thumbnails are not measured) */
    bytesReclaimed: bigint({ mode: 'number' }).notNull().default(0),
    failed: integer().notNull().default(0),
    retries: integer().notNull().default(0),
    /** preview only: what the run would delete when it was made */
    eligibleCount: integer(),
    eligibleBytes: bigint({ mode: 'number' }),
    oldestEligibleAt: tstz(),
    newestEligibleAt: tstz(),
    excludedCount: integer(),
    error: text(),
  },
  (t) => [
    index().on(t.organizationId, t.startedAt),
    // At most one destructive run at a time per organization.
    uniqueIndex('screenshot_cleanup_runs_active_uq').on(t.organizationId).where(sql`${t.status} = 'RUNNING'`),
  ],
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
/** One reminder of a kind per member per day (e.g. missing time). */
export const reminderSends = pgTable(
  'reminder_sends',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    kind: text().notNull(),
    reminderDate: text().notNull(),
    sentAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.kind, t.reminderDate] })],
);

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

/** A connection to an external system (e.g. a project tool or accounting system). */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: pk(),
    organizationId: orgId(),
    provider: text().notNull(),
    name: text().notNull(),
    status: text().$type<'ACTIVE' | 'PAUSED' | 'ERROR'>().notNull().default('ACTIVE'),
    /** non-secret settings */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** credentials, encrypted with the app secret; never returned by the API */
    secretEnc: text(),
    syncRequestedAt: tstz(),
    lastSyncAt: tstz(),
    lastError: text(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId)],
);

/** Which external record a Tallywork record corresponds to, per connection. */
export const externalRefs = pgTable(
  'external_refs',
  {
    organizationId: orgId(),
    connectionId: uuid().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    externalId: text().notNull(),
    syncedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.entityType, t.externalId] }), index().on(t.connectionId, t.entityType, t.entityId)],
);

/** Time-limited, read-only access an organization grants to Tallywork support staff. */
export const supportGrants = pgTable(
  'support_grants',
  {
    id: pk(),
    organizationId: orgId(),
    grantedBy: uuid().notNull(),
    reason: text().notNull(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.expiresAt)],
);
