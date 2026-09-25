import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { TimesheetStatus } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';
import { memberships } from './identity';

export const timesheets = pgTable(
  'timesheets',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    periodStart: text().notNull(),
    periodEnd: text().notNull(),
    status: text().$type<TimesheetStatus>().notNull().default('DRAFT'),
    submittedAt: tstz(),
    decidedAt: tstz(),
    decidedBy: uuid(),
    totalSeconds: integer().notNull().default(0),
    billableSeconds: integer().notNull().default(0),
    manualSeconds: integer().notNull().default(0),
    comment: text(),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('timesheets_org_id_uq').on(t.organizationId, t.id),
    unique().on(t.organizationId, t.membershipId, t.periodStart),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    index().on(t.organizationId, t.status),
  ],
);

/** Snapshot of what was submitted/approved; immutable once written. */
export const timesheetEntries = pgTable(
  'timesheet_entries',
  {
    id: pk(),
    organizationId: orgId(),
    timesheetId: uuid().notNull(),
    timeEntryId: uuid().notNull(),
    revision: integer().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    localDate: text().notNull(),
    durationSeconds: integer().notNull(),
    billable: boolean().notNull(),
    source: text().notNull(),
    snapshotAt: tstz().notNull().default(sql`now()`),
    /** Set when a later submission replaces this snapshot; the row itself is never changed otherwise. */
    supersededAt: tstz(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.timesheetId], foreignColumns: [timesheets.organizationId, timesheets.id] }).onDelete('cascade'),
    index().on(t.timesheetId),
    uniqueIndex('timesheet_entries_current_uq').on(t.timesheetId, t.timeEntryId).where(sql`${t.supersededAt} is null`),
  ],
);

export const approvalActions = pgTable(
  'approval_actions',
  {
    id: pk(),
    organizationId: orgId(),
    subjectType: text().$type<'TIMESHEET' | 'MANUAL_TIME' | 'TIME_OFF' | 'EXPENSE'>().notNull(),
    subjectId: uuid().notNull(),
    action: text().notNull(),
    fromStatus: text(),
    toStatus: text().notNull(),
    comment: text(),
    actorId: uuid().notNull(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.subjectType, t.subjectId)],
);

export const manualTimeRequests = pgTable(
  'manual_time_requests',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    projectId: uuid().notNull(),
    taskId: uuid(),
    startedAt: tstz().notNull(),
    endedAt: tstz().notNull(),
    reason: text(),
    note: text(),
    billable: boolean().notNull(),
    status: text().$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    createdBy: uuid().notNull(),
    decidedBy: uuid(),
    decidedAt: tstz(),
    decisionComment: text(),
    timeEntryId: uuid(),
    clientEventId: uuid(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.status), index().on(t.organizationId, t.membershipId)],
);

