import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_FOLDER, applyRls, schema, type Db } from './index';

export const APP_ROLE = 'tallywork_app';

/**
 * The application never queries as the table owner / superuser: owners and roles
 * with BYPASSRLS skip row-level security. Every connection switches to APP_ROLE.
 */
const ENSURE_APP_ROLE_SQL = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
      create role ${APP_ROLE} nologin nosuperuser nobypassrls;
    end if;
  end $$;
  grant ${APP_ROLE} to current_user;
  grant usage on schema public to ${APP_ROLE};
  grant select, insert, update, delete on all tables in schema public to ${APP_ROLE};
`;

export interface DbHandle {
  db: Db;
  kind: 'pg' | 'pglite';
  /** Apply migrations + RLS + app role grants (runs as the owner). */
  migrate(): Promise<void>;
  close(): Promise<void>;
  pool?: pg.Pool;
}

/**
 * DATABASE_URL forms:
 *  - postgres://...        → node-postgres pool (Neon in production)
 *  - pglite://memory       → in-memory PGlite (tests)
 *  - pglite://./.pglite    → file-backed PGlite (zero-setup local dev)
 */
export function createDb(url: string, opts: { runAsAppRole?: boolean } = {}): DbHandle {
  const runAsAppRole = opts.runAsAppRole ?? true;
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    if (target !== 'memory') mkdirSync(path.dirname(target), { recursive: true });
    const client = target === 'memory' ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema, casing: 'snake_case' }) as unknown as Db;
    const ready = (async () => {
      if (!runAsAppRole) return;
      const r = await client.query<{ exists: boolean }>(`select exists(select 1 from pg_roles where rolname = '${APP_ROLE}') as exists`);
      if (r.rows[0]?.exists) await client.exec(`set role ${APP_ROLE}`);
    })();
    return {
      db,
      kind: 'pglite',
      async migrate() {
        await ready;
        await client.exec('reset role');
        await migratePglite(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
        await applyRls(db);
        await client.exec(ENSURE_APP_ROLE_SQL);
        if (runAsAppRole) await client.exec(`set role ${APP_ROLE}`);
      },
      close: () => client.close(),
    };
  }

  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 5_000 });
  if (runAsAppRole) {
    pool.on('connect', (c) => {
      // Fail loudly (connection error) rather than silently running with bypass rights.
      c.query(`set role ${APP_ROLE}`).catch((e: unknown) => c.emit('error', e as Error));
    });
  }
  const db = drizzlePg(pool, { schema, casing: 'snake_case' }) as unknown as Db;
  return {
    db,
    kind: 'pg',
    pool,
    async migrate() {
      const ownerPool = new pg.Pool({ connectionString: url, max: 1 });
      try {
        const ownerDb = drizzlePg(ownerPool, { schema, casing: 'snake_case' });
        await migratePg(ownerDb, { migrationsFolder: MIGRATIONS_FOLDER });
        await applyRls(ownerDb as unknown as Db);
        await ownerPool.query(ENSURE_APP_ROLE_SQL);
      } finally {
        await ownerPool.end();
      }
    },
    close: () => pool.end(),
  };
}
