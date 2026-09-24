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
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: tstz(),
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
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().notNull(),
    expiresAt: tstz().notNull(),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.email)],
);
