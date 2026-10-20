import { sql } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, smallint, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { EndReason, SegmentKind, SessionState } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';
import { memberships } from './identity';
import { devices, projects, tasks } from './workforce';

export type TrackingSource = 'DESKTOP' | 'WEB' | 'MOBILE' | 'API';

export const trackingSessions = pgTable(
  'tracking_sessions',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    deviceId: uuid(),
    source: text().$type<TrackingSource>().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    state: text().$type<SessionState>().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz(),
    endReason: text().$type<EndReason>(),
    /** last applied client sequence number (per session, from the agent) */
    lastSeq: integer().notNull().default(0),
    lastHeartbeatAt: tstz(),
    /** last time we have evidence of work (activity minute / heartbeat) */
    lastEvidenceAt: tstz(),
    timezone: text().notNull(),
    note: text(),
    ...timestamps,
  },
  (t) => [
    unique('tracking_sessions_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }),
    foreignKey({ columns: [t.organizationId, t.deviceId], foreignColumns: [devices.organizationId, devices.id] }),
    // At most one live session per worker — the DB guarantees the single-timer rule.
    uniqueIndex('tracking_sessions_one_live')
      .on(t.organizationId, t.membershipId)
      .where(sql`${t.state} in ('CREATED','ACTIVE','PAUSED','INTERRUPTED')`),
    index().on(t.organizationId, t.membershipId, t.startedAt),
    index().on(t.organizationId, t.state),
    index('tracking_sessions_live_idx').on(t.state).where(sql`${t.state} <> 'STOPPED'`),
  ],
);

/** The end-of-day report a worker writes when clocking out: what was completed, and whether the work is finished. */
export const eodReports = pgTable(
  'eod_reports',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    /** the session that was clocked out (one report per session) */
    sessionId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    /** the worker's local date of the clock-out */
    localDate: text().notNull(),
    body: text().notNull(),
    /** the worker marked the task or project as finished */
    finished: boolean().notNull().default(false),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('eod_reports_session_uq').on(t.organizationId, t.sessionId),
    foreignKey({ columns: [t.organizationId, t.sessionId], foreignColumns: [trackingSessions.organizationId, trackingSessions.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    index().on(t.organizationId, t.localDate),
    index().on(t.organizationId, t.membershipId, t.localDate),
  ],
);

export const sessionTransitions = pgTable(
  'session_transitions',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    fromState: text().$type<SessionState>(),
    toState: text().$type<SessionState>().notNull(),
    trigger: text().notNull(),
    cause: text(),
    actorType: text().$type<'user' | 'agent' | 'system' | 'api_key'>().notNull(),
    actorId: uuid(),
    occurredAt: tstz().notNull(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.sessionId], foreignColumns: [trackingSessions.organizationId, trackingSessions.id] }).onDelete('cascade'),
    index().on(t.sessionId),
  ],
);

export const timeSegments = pgTable(
  'time_segments',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    kind: text().$type<SegmentKind>().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz(),
    /** set when the segment has been converted into time entries */
    derivedAt: tstz(),
    /** BREAK segments: the break type chosen by the worker */
    breakTypeId: uuid(),
    /** set once the worker was told this break ran past its maximum */
    alertedAt: tstz(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.sessionId], foreignColumns: [trackingSessions.organizationId, trackingSessions.id] }).onDelete('cascade'),
    index().on(t.sessionId),
    index().on(t.organizationId, t.membershipId, t.startedAt),
    index('time_segments_open_idx').on(t.membershipId).where(sql`${t.endedAt} is null`),
  ],
);

export type TimeEntrySource = 'TRACKED' | 'MANUAL';

export const timeEntries = pgTable(
  'time_entries',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    sessionId: uuid(),
    segmentId: uuid(),
    source: text().$type<TimeEntrySource>().notNull(),
    trackingSource: text().$type<TrackingSource>(),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    durationSeconds: integer().notNull(),
    localDate: text().notNull(),
    timezone: text().notNull(),
    billable: boolean().notNull(),
    note: text(),
    /** Normal, Overtime, …; null = the organization's default type */
    timeTypeId: uuid(),
    /** entered as a duration only: the start/end are a placeholder slot, not real clock times */
    durationOnly: boolean().notNull().default(false),
    edited: boolean().notNull().default(false),
    revision: integer().notNull().default(1),
    lockedAt: tstz(),
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('time_entries_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }),
    index().on(t.organizationId, t.membershipId, t.localDate),
    index().on(t.organizationId, t.projectId, t.localDate),
    index().on(t.organizationId, t.localDate),
    index().on(t.sessionId),
  ],
);

export const timeEntryRevisions = pgTable(
  'time_entry_revisions',
  {
    id: pk(),
    organizationId: orgId(),
    timeEntryId: uuid().notNull(),
    revision: integer().notNull(),
    action: text().$type<'CREATE' | 'UPDATE' | 'SPLIT' | 'DELETE' | 'IDLE_DISCARD' | 'SCREENSHOT_DELETE'>().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    actorType: text().$type<'user' | 'agent' | 'system' | 'api_key'>().notNull(),
    actorId: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.timeEntryId], foreignColumns: [timeEntries.organizationId, timeEntries.id] }).onDelete('cascade'),
    unique().on(t.timeEntryId, t.revision),
  ],
);

export const activityMinutes = pgTable(
  'activity_minutes',
  {
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    minuteStart: tstz().notNull(),
    keyboardCount: integer().notNull().default(0),
    mouseCount: integer().notNull().default(0),
    activeSeconds: smallint().notNull(),
    trackedSeconds: smallint().notNull().default(60),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.minuteStart] }), index().on(t.organizationId, t.membershipId, t.minuteStart), index().on(t.organizationId, t.minuteStart)],
);

export const activityWindows = pgTable(
  'activity_windows',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    windowStart: tstz().notNull(),
    sessionId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    activeSeconds: integer().notNull(),
    trackedSeconds: integer().notNull(),
    keyboardCount: integer().notNull(),
    mouseCount: integer().notNull(),
    activityPct: smallint().notNull(),
    keyboardPct: smallint().notNull(),
    mousePct: smallint().notNull(),
    localDate: text().notNull(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.windowStart] }), index().on(t.organizationId, t.localDate)],
);

export const idleEvents = pgTable(
  'idle_events',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    startedAt: tstz().notNull(),
    endedAt: tstz(),
    resolution: text().$type<'PENDING' | 'KEPT' | 'DISCARDED' | 'REASSIGNED'>().notNull().default('PENDING'),
    resolvedBy: uuid(),
    resolvedAt: tstz(),
    reassignedTaskId: uuid(),
    clientEventId: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.membershipId, t.startedAt), index().on(t.sessionId)],
);

export const screenshots = pgTable(
  'screenshots',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    deviceId: uuid(),
    capturedAt: tstz().notNull(),
    displayIndex: smallint().notNull().default(0),
    storageKey: text().notNull(),
    thumbKey: text(),
    width: integer(),
    height: integer(),
    bytes: integer(),
    sha256: text(),
    blurred: boolean().notNull().default(false),
    status: text().$type<'PENDING_UPLOAD' | 'READY' | 'FAILED'>().notNull().default('PENDING_UPLOAD'),
    windowStart: tstz().notNull(),
    deletedAt: tstz(),
    deletedBy: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.membershipId, t.capturedAt), index().on(t.sessionId), index().on(t.organizationId, t.capturedAt)],
);

export const appSpans = pgTable(
  'app_spans',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    deviceId: uuid(),
    clientSpanId: uuid().notNull(),
    appName: text().notNull(),
    appId: text(),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    durationSeconds: integer().notNull(),
  },
  (t) => [uniqueIndex('app_spans_client_uq').on(t.sessionId, t.clientSpanId), index().on(t.organizationId, t.membershipId, t.startedAt), index().on(t.organizationId, t.startedAt)],
);

export const urlSpans = pgTable(
  'url_spans',
  {
    id: pk(),
    organizationId: orgId(),
    sessionId: uuid().notNull(),
    membershipId: uuid().notNull(),
    deviceId: uuid(),
    clientSpanId: uuid().notNull(),
    domain: text().notNull(),
    url: text(),
    browser: text(),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    durationSeconds: integer().notNull(),
  },
  (t) => [uniqueIndex('url_spans_client_uq').on(t.sessionId, t.clientSpanId), index().on(t.organizationId, t.membershipId, t.startedAt), index().on(t.organizationId, t.startedAt)],
);

/** Idempotency receipts for agent events: (device, client_event_id) processed once. */
export const ingestReceipts = pgTable(
  'ingest_receipts',
  {
    organizationId: orgId(),
    deviceId: uuid().notNull(),
    clientEventId: uuid().notNull(),
    eventType: text().notNull(),
    status: text().$type<'accepted' | 'rejected'>().notNull(),
    reason: text(),
    receivedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.clientEventId] }), index().on(t.organizationId, t.receivedAt)],
);

/** Daily rollup per worker × project × task (reporting layer L2). */
export const rollupWorkerDay = pgTable(
  'rollup_worker_day',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    localDate: text().notNull(),
    projectId: uuid().notNull(),
    taskKey: text().notNull(), // task id or '' (no task) — part of PK
    billable: boolean().notNull(),
    trackedSeconds: integer().notNull().default(0),
    manualSeconds: integer().notNull().default(0),
    activeSeconds: integer().notNull().default(0),
    activityTrackedSeconds: integer().notNull().default(0),
    idleSeconds: integer().notNull().default(0),
    /** tracked + manual seconds weighted by each entry's time-type pay / bill coefficient */
    payWeightedSeconds: integer().notNull().default(0),
    billWeightedSeconds: integer().notNull().default(0),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.membershipId, t.localDate, t.projectId, t.taskKey, t.billable] }),
    index().on(t.organizationId, t.localDate),
  ],
);

export const rollupAppDay = pgTable(
  'rollup_app_day',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    localDate: text().notNull(),
    kind: text().$type<'APP' | 'URL'>().notNull(),
    name: text().notNull(),
    projectId: uuid().notNull(),
    seconds: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.membershipId, t.localDate, t.kind, t.name, t.projectId] }), index().on(t.organizationId, t.localDate, t.kind)],
);

export const presence = pgTable('presence', {
  membershipId: uuid().primaryKey(),
  organizationId: orgId(),
  status: text().$type<'WORKING' | 'IDLE' | 'OFFLINE'>().notNull(),
  sessionId: uuid(),
  projectId: uuid(),
  taskId: uuid(),
  activityPct: smallint(),
  updatedAt: tstz().notNull().default(sql`now()`),
});
