import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
/** A migration's `when` from the journal: what the migrator records as `created_at`. */
const journalWhen = (tag: string): number => {
  const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.find((e) => e.tag === tag)!.when;
};
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
    const when = journalWhen('0022_user_tour_done');
    // The migrator only runs migrations newer than the latest recorded one: drop this one and any after it.
    await h.db.execute(sql`delete from drizzle.__drizzle_migrations where created_at >= ${when}`);
    await h.db.execute(sql`update users set tour_done_at = null where id = ${id}`);

    await expect(h.migrate()).resolves.toBeUndefined();

    const row = (await rows<{ tour_done_at: string | null }>(sql`select tour_done_at from users where id = ${id}`))[0]!;
    expect(row.tour_done_at).not.toBeNull();
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = ${when}`))[0]!.n).toBe(1);
  });

  it('0023 (screenshot cleanup) succeeds again when its tables exist but it was not recorded, and keeps their data', async () => {
    const [org] = await rows<{ id: string }>(sql`select id from organizations limit 1`);
    const orgId = org?.id ?? newId();
    if (!org) await h.db.execute(sql`insert into organizations (id, name, slug, timezone, settings) values (${orgId}, 'Org', ${`org-${orgId}`}, 'UTC', '{}'::jsonb)`);
    await h.db.execute(sql`insert into screenshot_cleanup_settings (organization_id, retention_days) values (${orgId}, 14) on conflict (organization_id) do update set retention_days = 14`);
    const when = journalWhen('0023_screenshot_cleanup');
    // The migrator only runs migrations newer than the latest recorded one: drop this one and any after it.
    await h.db.execute(sql`delete from drizzle.__drizzle_migrations where created_at >= ${when}`);

    await expect(h.migrate()).resolves.toBeUndefined();

    expect((await rows<{ d: number }>(sql`select retention_days as d from screenshot_cleanup_settings where organization_id = ${orgId}`))[0]!.d).toBe(14);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = ${when}`))[0]!.n).toBe(1);
  });
});
