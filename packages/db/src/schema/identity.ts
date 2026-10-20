import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { PayPeriodConfig } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';

/** Global login identity. NOT tenant-scoped. */
export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    emailVerifiedAt: tstz(),
    avatarUrl: text(),
    locale: text().notNull().default('en-US'),
    /** when the person finished or skipped the web app's product tour (null = not yet: show it once) */
    tourDoneAt: tstz(),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: tstz(),
    /** set when personal data was erased on request; the row stays so history keeps its references */
    anonymizedAt: tstz(),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: pk(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque session token */
    tokenHash: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    mfaVerified: boolean().notNull().default(false),
    /** signed in with a password but the two-factor step is not done yet: the session can only finish it */
    mfaPending: boolean().notNull().default(false),
    lastSeenAt: tstz().notNull().default(sql`now()`),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [uniqueIndex('user_sessions_token_uq').on(t.tokenHash), index().on(t.userId)],
);

export const mfaFactors = pgTable('mfa_factors', {
  id: pk(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text().$type<'TOTP'>().notNull(),
  /** encrypted with APP_SECRET-derived key */
  secretEnc: text().notNull(),
  verifiedAt: tstz(),
  recoveryCodeHashes: jsonb().$type<string[]>().notNull().default([]),
  /** last TOTP time step accepted, so a code cannot be used twice */
  lastUsedStep: integer(),
  createdAt: tstz().notNull().default(sql`now()`),
});

export const emailTokens = pgTable('email_tokens', {
  id: pk(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text().$type<'VERIFY_EMAIL' | 'RESET_PASSWORD'>().notNull(),
  tokenHash: text().notNull().unique(),
  expiresAt: tstz().notNull(),
  usedAt: tstz(),
  createdAt: tstz().notNull().default(sql`now()`),
});

export interface OrgSettings {
  lateGraceMinutes: number;
  durationFormat: 'hm' | 'clock' | 'decimal';
  budgetWarnPct: number;
  requireDeviceApproval: boolean;
  enforceMfa: 'none' | 'admins' | 'all';
  sessionTtlHours: number;
  /** CIDR ranges people and API keys may use this organization from (empty = anywhere) */
  ipAllowlist?: string[];
  /** members cannot add, edit or delete their own time on days more than this many days ago */
  lockAfterDays?: number | null;
  /** members cannot add, edit or delete their own time before this date (YYYY-MM-DD) */
  lockBeforeDate?: string | null;
  /** minimum time each tracking member should log per working day / per week */
  minDailySeconds?: number | null;
  minWeeklySeconds?: number | null;
  /** remind members who are under the minimum, at this local time (HH:MM) on working days */
  missingTimeReminder?: boolean;
  missingTimeCheckAt?: string;
  /** converts hours and days, e.g. for project estimates (default 8) */
  workingHoursPerDay?: number;
}

export const organizations = pgTable('organizations', {
  id: pk(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  timezone: text().notNull().default('UTC'),
  weekStart: integer().notNull().default(1),
  currency: text().notNull().default('USD'),
  locale: text().notNull().default('en-US'),
  payPeriod: jsonb().$type<PayPeriodConfig>().notNull().default({ type: 'weekly' }),
  settings: jsonb().$type<OrgSettings>().notNull(),
  isDemo: boolean().notNull().default(false),
  /** company profile printed on invoices and reports */
  logo: text(),
  brief: text(),
  taxId: text(),
  address: text(),
  phone: text(),
  email: text(),
  /** default language for invoices and other documents; a client's own setting wins */
  documentLanguage: text(),
  ...timestamps,
});

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    key: text().notNull(), // SYSTEM_ADMIN | TEAM_MANAGER | WORKER | AGENT | custom slug
    name: text().notNull(),
    description: text(),
    builtin: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.key), unique('roles_org_id_uq').on(t.organizationId, t.id)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    organizationId: orgId(),
    roleId: uuid().notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
    scope: text().$type<'own' | 'assigned' | 'team' | 'org'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull().references(() => roles.id),
    status: text().$type<'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED'>().notNull().default('ACTIVE'),
    isOwner: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique().on(t.organizationId, t.userId),
    unique('memberships_org_id_uq').on(t.organizationId, t.id),
    uniqueIndex('memberships_one_owner').on(t.organizationId).where(sql`${t.isOwner}`),
    index().on(t.userId),
  ],
);

export const workerProfiles = pgTable('worker_profiles', {
  membershipId: uuid().primaryKey().references(() => memberships.id, { onDelete: 'cascade' }),
  organizationId: orgId(),
  trackingEnabled: boolean().notNull().default(true),
  title: text(),
  timezone: text().notNull().default('UTC'),
  employmentType: text().$type<'EMPLOYEE' | 'CONTRACTOR'>().notNull().default('EMPLOYEE'),
  weeklyExpectedSeconds: integer(),
  startDate: text(),
  /** employment end ("date left"); set when the member is removed unless already set */
  endDate: text(),
  ...timestamps,
});

/**
 * HR contact details. Kept apart from worker_profiles because they are personal data: only the
 * member and admins with members:manage may read them, and erasure deletes the row.
 */
export const memberDetails = pgTable('member_details', {
  membershipId: uuid().primaryKey().references(() => memberships.id, { onDelete: 'cascade' }),
  organizationId: orgId(),
  firstName: text(),
  lastName: text(),
  birthDate: text(),
  personalEmail: text(),
  phone: text(),
  country: text(),
  region: text(),
  city: text(),
  postalCode: text(),
  address: text(),
  emergencyContactName: text(),
  emergencyContactPhone: text(),
  education: text(),
  /** admin-only HR notes; never shown to the member */
  notes: text(),
  ...timestamps,
});

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    name: text(),
    roleId: uuid().notNull().references(() => roles.id),
    teamIds: jsonb().$type<string[]>().notNull().default([]),
    /** Team role given on the teams above (MANAGER makes a Team Manager actually manage them). */
    teamRole: text().$type<'MANAGER' | 'MEMBER'>().notNull().default('MEMBER'),
    /** Projects the person joins on accept, so they can track right away. */
    projectIds: jsonb().$type<string[]>().notNull().default([]),
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().notNull(),
    expiresAt: tstz().notNull(),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.email)],
);
