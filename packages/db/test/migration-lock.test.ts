import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATION_LOCK_KEY, withMigrationLock } from '../src/client';

/** Mimics Postgres advisory locks across connections: a second locker waits until unlock. */
function fakeServer() {
  let held: Promise<void> | null = null;
  let release: (() => void) | null = null;
  const log: string[] = [];
  const conn = (name: string) => ({
    async query(text: string, params?: unknown[]) {
      expect(params).toEqual([MIGRATION_LOCK_KEY]);
      if (text.includes('pg_advisory_lock')) {
        while (held) await held;
        held = new Promise<void>((r) => (release = r));
        log.push(`${name}:lock`);
      } else if (text.includes('pg_advisory_unlock')) {
        log.push(`${name}:unlock`);
        const r = release;
        held = null;
        release = null;
        r?.();
      }
      return { rows: [] };
    },
  });
  return { conn, log };
}

describe('withMigrationLock', () => {
  it('serialises concurrent migrations so the second never overlaps the first', async () => {
    const { conn, log } = fakeServer();
    const migrate = (name: string) => async () => {
      log.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 20));
      log.push(`${name}:end`);
    };
    await Promise.all([
      withMigrationLock(conn('a') as never, migrate('a')),
      withMigrationLock(conn('b') as never, migrate('b')),
    ]);
    expect(log).toEqual(['a:lock', 'a:start', 'a:end', 'a:unlock', 'b:lock', 'b:start', 'b:end', 'b:unlock']);
  });

  it('releases the lock when the migration fails, and rethrows', async () => {
    const { conn, log } = fakeServer();
    await expect(
      withMigrationLock(conn('a') as never, async () => {
        throw new Error('relation "eod_reports" already exists');
      }),
    ).rejects.toThrow('already exists');
    await withMigrationLock(conn('b') as never, async () => undefined);
    expect(log).toEqual(['a:lock', 'a:unlock', 'b:lock', 'b:unlock']);
  });

  it('issues SQL that Postgres accepts and leaves no lock behind', async () => {
    const pglite = new PGlite();
    try {
      const result = await withMigrationLock(pglite as never, async () => {
        const held = await pglite.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
        return held.rows[0]?.n;
      });
      expect(result).toBe(1);
      const after = await pglite.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
      expect(after.rows[0]?.n).toBe(0);
    } finally {
      await pglite.close();
    }
  });
});
