import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orgId, pk, tstz } from './_helpers';
import { users } from './identity';
import { clients } from './workforce';

/** Which parts of the client dashboard a client may see (per client; monitoring sections start off). */
export interface ClientPortalSections {
  hours: boolean;
  tasks: boolean;
  activity: boolean;
  screenshots: boolean;
  /** A short summary written by WorkPulse AI from the dashboard's delivery facts (opt-in). */
  ai_summary: boolean;
}
export const DEFAULT_PORTAL_SECTIONS: ClientPortalSections = { hours: true, tasks: true, activity: false, screenshots: false, ai_summary: false };

/**
 * The client's AI summary, written at most once a day per client (all of the client's portal users
 * share it). Only the latest day is kept.
 */
export const portalAiSummaries = pgTable(
  'portal_ai_summaries',
  {
    organizationId: orgId(),
    clientId: uuid().notNull(),
    day: text().notNull(),
    /** What the client was allowed to see when it was written: a change of scope rewrites it. */
    scope: text().notNull().default(''),
    /** PENDING while one request writes it (others get the plain summary), READY, or FAILED (retried after a pause). */
    status: text().notNull().default('READY'),
    text: text().notNull().default(''),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.clientId, t.day] }),
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
  ],
);

export const clientPortalSettings = pgTable(
  'client_portal_settings',
  {
    organizationId: orgId(),
    clientId: uuid().notNull(),
    enabled: boolean().notNull().default(false),
    sections: jsonb().$type<ClientPortalSections>().notNull().default(DEFAULT_PORTAL_SECTIONS),
    /** null = every project of the client (including ones added later) */
    projectIds: jsonb().$type<string[] | null>(),
    updatedBy: uuid(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.clientId] }),
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
  ],
);

/** One client viewer (a user account) with read-only access to one client's portal. Never a membership. */
export const clientPortalAccess = pgTable(
  'client_portal_access',
  {
    id: pk(),
    organizationId: orgId(),
    clientId: uuid().notNull(),
    email: text().notNull(),
    name: text(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    status: text().$type<'INVITED' | 'ACTIVE' | 'REVOKED'>().notNull().default('INVITED'),
    inviteTokenHash: text(),
    inviteExpiresAt: tstz(),
    /** membership id of the admin who invited */
    invitedBy: uuid(),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    lastViewedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
    uniqueIndex('client_portal_access_email_uq').on(t.organizationId, t.clientId, t.email),
    uniqueIndex('client_portal_access_token_uq').on(t.inviteTokenHash),
    index().on(t.userId),
  ],
);
