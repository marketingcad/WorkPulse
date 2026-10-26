import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { DeepPartial, TrackingPolicy } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';
import { memberships, organizations } from './identity';

export const teams = pgTable(
  'teams',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [unique('teams_org_id_uq').on(t.organizationId, t.id), index().on(t.organizationId)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    organizationId: orgId(),
    teamId: uuid().notNull(),
    membershipId: uuid().notNull(),
    role: text().$type<'MANAGER' | 'MEMBER'>().notNull().default('MEMBER'),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.membershipId] }),
    foreignKey({ columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    index().on(t.membershipId),
  ],
);

export const clients = pgTable(
  'clients',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    email: text(),
    phone: text(),
    address: text(),
    currency: text(),
    notes: text(),
    contactName: text(),
    /** BCP 47 language for invoices and other documents sent to the client */
    documentLanguage: text(),
    color: text(),
    /** small square image as a data: URL (resized client-side before upload) */
    logo: text(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [unique('clients_org_id_uq').on(t.organizationId, t.id), index().on(t.organizationId, t.archivedAt)],
);

export const clientContacts = pgTable('client_contacts', {
  id: pk(),
  organizationId: orgId(),
  clientId: uuid().notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  email: text(),
  phone: text(),
  role: text(),
  isPrimary: boolean().notNull().default(false),
  ...timestamps,
});

export const projects = pgTable(
  'projects',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid(),
    /** when the project got its current client (null: from the start). A client sees the project's work only from then on. */
    clientSince: tstz(),
    name: text().notNull(),
    description: text(),
    color: text().notNull().default('#4B4FC4'),
    status: text().$type<'ACTIVE' | 'ON_HOLD' | 'COMPLETED'>().notNull().default('ACTIVE'),
    billableDefault: boolean().notNull().default(true),
    /** short code shown in tight places (timer, reports), e.g. "WEB" */
    shortName: text(),
    startDate: text(),
    endDate: text(),
    /** planned effort; the unit only changes how it is entered and shown (a day = the org's working hours per day) */
    estimateSeconds: integer(),
    estimateUnit: text().$type<'HOURS' | 'DAYS'>().notNull().default('HOURS'),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('projects_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }),
    index().on(t.organizationId, t.status),
    index().on(t.organizationId, t.clientId),
  ],
);

/** Files attached to a project (briefs, contracts, specs). The bytes live in object storage. */
export const projectDocuments = pgTable(
  'project_documents',
  {
    id: pk(),
    organizationId: orgId(),
    projectId: uuid().notNull(),
    fileId: uuid().notNull(),
    name: text().notNull(),
    contentType: text().notNull(),
    bytes: integer().notNull(),
    uploadedBy: uuid(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.projectId)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    organizationId: orgId(),
    projectId: uuid().notNull(),
    membershipId: uuid().notNull(),
    role: text().$type<'MANAGER' | 'MEMBER'>().notNull().default('MEMBER'),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.membershipId] }),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    index().on(t.membershipId),
  ],
);

export const projectTeams = pgTable(
  'project_teams',
  {
    organizationId: orgId(),
    projectId: uuid().notNull(),
    teamId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.teamId] }),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }).onDelete('cascade'),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    organizationId: orgId(),
    projectId: uuid().notNull(),
    title: text().notNull(),
    description: text(),
    status: text().$type<'TODO' | 'IN_PROGRESS' | 'DONE'>().notNull().default('TODO'),
    priority: text().$type<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>().notNull().default('MEDIUM'),
    dueDate: text(),
    estimateSeconds: integer(),
    completedAt: tstz(),
    externalRef: jsonb().$type<{ provider: string; id: string; url?: string }>(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('tasks_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
    index().on(t.organizationId, t.projectId, t.status),
  ],
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    organizationId: orgId(),
    taskId: uuid().notNull(),
    membershipId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.membershipId] }),
    foreignKey({ columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    index().on(t.membershipId),
  ],
);

export const trackingPolicies = pgTable(
  'tracking_policies',
  {
    id: pk(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    scopeType: text().$type<'ORG' | 'TEAM' | 'WORKER'>().notNull(),
    scopeId: uuid().notNull(),
    version: integer().notNull().default(1),
    doc: jsonb().$type<DeepPartial<TrackingPolicy>>().notNull(),
    updatedBy: uuid(),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.scopeType, t.scopeId)],
);

export const policyAcks = pgTable(
  'policy_acks',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    /** hash of the effective policy the worker acknowledged */
    policyHash: text().notNull(),
    deviceId: uuid(),
    acknowledgedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.organizationId, t.membershipId)],
);

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    name: text().notNull(),
    platform: text().$type<'windows' | 'macos' | 'linux'>().notNull(),
    osVersion: text(),
    agentVersion: text(),
    capabilities: jsonb().$type<Record<string, boolean | string>>().notNull().default({}),
    status: text().$type<'PENDING' | 'ACTIVE' | 'OFFLINE' | 'REVOKED'>().notNull().default('ACTIVE'),
    publicKey: text(),
    lastSeenAt: tstz(),
    lastSyncAt: tstz(),
    clockSkewMs: integer().notNull().default(0),
    revokedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('devices_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete('cascade'),
    index().on(t.organizationId, t.status),
    index().on(t.membershipId),
  ],
);

export const deviceCredentials = pgTable(
  'device_credentials',
  {
    id: pk(),
    organizationId: orgId(),
    deviceId: uuid().notNull().references(() => devices.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    refreshTokenHash: text().notNull().unique(),
    expiresAt: tstz().notNull(),
    usedAt: tstz(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.familyId)],
);

/** Short-lived one-time codes used by the desktop PKCE login. */
export const deviceAuthCodes = pgTable('device_auth_codes', {
  id: pk(),
  codeHash: text().notNull().unique(),
  codeChallenge: text().notNull(),
  userId: uuid().notNull(),
  organizationId: uuid().notNull(),
  membershipId: uuid().notNull(),
  expiresAt: tstz().notNull(),
  usedAt: tstz(),
  createdAt: tstz().notNull().default(sql`now()`),
});
