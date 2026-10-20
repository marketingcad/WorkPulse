import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import { users, withSystem } from '../src/index';

/**
 * Migrations must be safe to run again. Production once had the users.tour_done_at column before
 * migration 0022 was recorded, and a plain ADD COLUMN failed the deploy.
 */
let h: DbHandle;

beforeAll(async () => {
  // As the owner, like the migrate script: the app's own role cannot read the migrations table.
  h = createDb('pglite://memory', { runAsAppRole: false });
  await h.migrate();
}, 60_000);
afterAll(() => h.close());

/** Rows of a raw query (the driver returns { rows }, which the shared Db type does not spell out). */
const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const tracked = async () => (await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]!.n;

describe('migrations', () => {
  it('running them again changes nothing', async () => {
    const before = await tracked();
    await h.migrate();
    expect(await tracked()).toBe(before);
  });

  it('0022 succeeds when the column already exists but the migration was not recorded, and marks existing accounts as having seen the tour', async () => {
    const id = newId();
    await withSystem(h.db, (tx) => tx.insert(users).values({ id, email: `old-${id}@example.test`, name: 'Existing user', passwordHash: 'x' }));
    // The production state: column present, its migration not in the tracking table.
    const last = (await rows<{ id: number; created_at: string }>(sql`select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`))[0]!;
    await h.db.execute(sql`delete from drizzle.__drizzle_migrations where id = ${last.id}`);
    await h.db.execute(sql`update users set tour_done_at = null where id = ${id}`);

    await expect(h.migrate()).resolves.toBeUndefined();

    const row = (await rows<{ tour_done_at: string | null }>(sql`select tour_done_at from users where id = ${id}`))[0]!;
    expect(row.tour_done_at).not.toBeNull();
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = ${last.created_at}`))[0]!.n).toBe(1);
  });
});
