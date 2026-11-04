import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable, type PgDatabase, type PgQueryResultHKT, type PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './schema/index';

export { schema };
export * from './schema/index';
export { withQueryStats, currentQueryStats, type QueryStats } from './query-stats';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the root db or a transaction. */
export type Executor = Db | Tx;

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Tables without organization_id or that must be readable before a tenant is known. */
const RLS_EXEMPT = new Set(['organizations', 'users', 'user_sessions', 'mfa_factors', 'email_tokens', 'device_auth_codes', 'idempotency_keys', 'rate_limit_buckets']);

export function tenantTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableName(value);
    if (RLS_EXEMPT.has(name)) continue;
    // With `casing: 'snake_case'` the TS key is the source of the column name.
    if ('organizationId' in getTableColumns(value)) names.push(name);
  }
  return names.sort();
}

/**
 * Idempotently enable + FORCE row-level security on every tenant table.
 * Rows are visible only when `app.org_id` matches, or inside systemTx (app.bypass_rls = on).
 */
export async function applyRls(db: Executor): Promise<void> {
  const predicate = `(current_setting('app.bypass_rls', true) = 'on' or organization_id = nullif(current_setting('app.org_id', true), '')::uuid)`;
  for (const table of tenantTables()) {
    await db.execute(sql.raw(`alter table "${table}" enable row level security`));
    await db.execute(sql.raw(`alter table "${table}" force row level security`));
    await db.execute(sql.raw(`drop policy if exists tenant_isolation on "${table}"`));
    await db.execute(sql.raw(`create policy tenant_isolation on "${table}" using ${predicate} with check ${predicate}`));
  }
}

/** Run `fn` in a transaction scoped to one organization (RLS enforced). */
export async function withTenant<T>(db: Db, organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true), set_config('app.bypass_rls', 'off', true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` bypassing tenant RLS. Only for identity lookups (login, token exchange)
 * and cross-org system jobs. Every caller must be explicit about why.
 */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true), set_config('app.org_id', '', true)`);
    return fn(tx);
  });
}
