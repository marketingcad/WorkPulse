import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { AccrualPolicy, AttendanceStatus, OvertimeRules } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';

/** Recurring weekly schedule. `days` = [{ dow: 1, start: '09:00', end: '17:00' }, ...] */
export const workSchedules = pgTable(
  'work_schedules',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    name: text().notNull().default('Standard'),
    timezone: text().notNull(),
    days: jsonb().$type<Array<{ dow: number; start: string; end: string }>>().notNull(),
    effectiveFrom: text().notNull(),
    effectiveTo: text(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.membershipId)],
);

/** Materialized per-day shifts (from schedules + one-off shifts + exceptions). */
export const shifts = pgTable(
  'shifts',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    scheduleId: uuid(),
    localDate: text().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    kind: text().$type<'SCHEDULED' | 'ONE_OFF' | 'CANCELLED'>().notNull().default('SCHEDULED'),
    note: text(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.membershipId, t.localDate), index().on(t.organizationId, t.localDate)],
);

export const attendanceDays = pgTable(
  'attendance_days',
  {
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    localDate: text().notNull(),
    scheduledStart: tstz(),
    scheduledEnd: tstz(),
    firstIn: tstz(),
    lastOut: tstz(),
    workedSeconds: integer().notNull().default(0),
    scheduledSeconds: integer().notNull().default(0),
    lateSeconds: integer().notNull().default(0),
    earlyLeaveSeconds: integer().notNull().default(0),
    overtimeSeconds: integer().notNull().default(0),
    status: text().$type<AttendanceStatus>().notNull(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.localDate] }), index().on(t.organizationId, t.localDate)],
);

export const holidays = pgTable(
  'holidays',
  {
    id: pk(),
    organizationId: orgId(),
    date: text().notNull(),
    name: text().notNull(),
    paid: boolean().notNull().default(true),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [unique().on(t.organizationId, t.date)],
);

export const timeOffPolicies = pgTable('time_off_policies', {
  id: pk(),
  organizationId: orgId(),
  name: text().notNull(),
  paid: boolean().notNull().default(true),
  accrual: jsonb().$type<AccrualPolicy>().notNull(),
  requiresApproval: boolean().notNull().default(true),
  hoursPerDay: numeric({ precision: 5, scale: 2, mode: 'number' }).notNull().default(8),
  appliesToAll: boolean().notNull().default(true),
  archivedAt: tstz(),
  ...timestamps,
});

export const timeOffPolicyMembers = pgTable(
  'time_off_policy_members',
  {
    organizationId: orgId(),
    policyId: uuid().notNull(),
    membershipId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.membershipId] })],
);

export const timeOffLedger = pgTable(
  'time_off_ledger',
  {
    id: pk(),
    organizationId: orgId(),
    policyId: uuid().notNull(),
    membershipId: uuid().notNull(),
    hours: numeric({ precision: 8, scale: 2, mode: 'number' }).notNull(),
    kind: text().$type<'ACCRUAL' | 'REQUEST' | 'REVERSAL' | 'ADJUSTMENT' | 'CARRYOVER_EXPIRY'>().notNull(),
    requestId: uuid(),
    note: text(),
    effectiveDate: text().notNull(),
    createdBy: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.membershipId, t.policyId)],
);

export const timeOffRequests = pgTable(
  'time_off_requests',
  {
    id: pk(),
    organizationId: orgId(),
    policyId: uuid().notNull(),
    membershipId: uuid().notNull(),
    startDate: text().notNull(),
    endDate: text().notNull(),
    halfDay: boolean().notNull().default(false),
    hours: numeric({ precision: 8, scale: 2, mode: 'number' }).notNull(),
    reason: text(),
    status: text().$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    decidedBy: uuid(),
    decidedAt: tstz(),
    decisionComment: text(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.status), index().on(t.organizationId, t.membershipId, t.startDate)],
);

export const overtimeRuleSets = pgTable('overtime_rule_sets', {
  organizationId: uuid().primaryKey(),
  rules: jsonb().$type<OvertimeRules>().notNull(),
  updatedAt: tstz().notNull().default(sql`now()`),
});
