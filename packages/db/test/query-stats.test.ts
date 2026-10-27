import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/client';
import { currentQueryStats, withQueryStats } from '../src/query-stats';

/** Per-request database counters: each statement is a round trip, which is what makes a far-away database slow. */
describe('query stats', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = createDb('pglite://memory', { runAsAppRole: false });
    await h.db.execute(sql`select 1`);
  });
  afterAll(() => h.close());

  it('counts each statement made inside the block', async () => {
    const stats = await withQueryStats(async (s) => {
      await h.db.execute(sql`select 1`);
      await h.db.execute(sql`select 2`);
      return { ...s };
    });
    expect(stats.queries).toBe(2);
    expect(stats.ms).toBeGreaterThanOrEqual(0);
  });

  it('counts the statements of a transaction', async () => {
    const stats = await withQueryStats(async (s) => {
      await h.db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        await tx.execute(sql`select 2`);
        await tx.execute(sql`select 3`);
      });
      return { ...s };
    });
    expect(stats.queries).toBeGreaterThanOrEqual(3);
  });

  it('keeps concurrent blocks apart and counts nothing outside them', async () => {
    const [a, b] = await Promise.all([
      withQueryStats(async (s) => {
        await h.db.execute(sql`select 1`);
        return { ...s };
      }),
      withQueryStats(async (s) => {
        for (let i = 0; i < 3; i++) await h.db.execute(sql`select 1`);
        return { ...s };
      }),
    ]);
    expect([a.queries, b.queries]).toEqual([1, 3]);
    expect(currentQueryStats()).toBeUndefined();
    await expect(h.db.execute(sql`select 1`)).resolves.toBeDefined();
  });
});
