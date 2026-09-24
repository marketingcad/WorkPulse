import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Primary key: UUIDv7 generated in application code (packages/domain newId). */
export const pk = () => uuid().primaryKey();

/** Tenant column present on every organization-owned table (RLS key). */
export const orgId = () => uuid().notNull();

export const tstz = () => timestamp({ withTimezone: true, mode: 'date' });

export const timestamps = {
  createdAt: tstz().notNull().default(sql`now()`),
  updatedAt: tstz().notNull().default(sql`now()`),
};
