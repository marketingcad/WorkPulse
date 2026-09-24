import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import { clients, organizations, tenantTables, withSystem, withTenant } from '../src/index';

let h: DbHandle;
const orgA = newId();
const orgB = newId();
const settings = { lateGraceMinutes: 5, durationFormat: 'hm' as const, budgetWarnPct: 80, requireDeviceApproval: false, enforceMfa: 'none' as const, sessionTtlHours: 336 };

beforeAll(async () => {
  h = createDb('pglite://memory');
  await h.migrate();
  await withSystem(h.db, async (tx) => {
    await tx.insert(organizations).values([
      { id: orgA, slug: 'a', name: 'A', settings },
      { id: orgB, slug: 'b', name: 'B', settings },
    ]);
  });
  await withTenant(h.db, orgA, (tx) => tx.insert(clients).values({ id: newId(), organizationId: orgA, name: 'Client of A' }));
  await withTenant(h.db, orgB, (tx) => tx.insert(clients).values({ id: newId(), organizationId: orgB, name: 'Client of B' }));
}, 60_000);

afterAll(() => h.close());

describe('row level security', () => {
  it('forces RLS on every tenant table', async () => {
    const rows = await h.db.execute<{ relname: string; relforcerowsecurity: boolean }>(
      sql`select relname, relforcerowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    );
    const list = (rows as unknown as { rows: Array<{ relname: string; relforcerowsecurity: boolean }> }).rows;
    const forced = new Set(list.filter((r) => r.relforcerowsecurity).map((r) => r.relname));
    for (const t of tenantTables()) expect(forced, t).toContain(t);
    expect(tenantTables().length).toBeGreaterThan(40);
  });

  it('only returns the current tenant rows even without a WHERE clause', async () => {
    const a = await withTenant(h.db, orgA, (tx) => tx.select().from(clients));
    expect(a.map((c) => c.name)).toEqual(['Client of A']);
    const b = await withTenant(h.db, orgB, (tx) => tx.select().from(clients));
    expect(b.map((c) => c.name)).toEqual(['Client of B']);
  });

  it('returns nothing outside a tenant context', async () => {
    const none = await h.db.select().from(clients);
    expect(none).toEqual([]);
  });

  it('rejects writing rows for another tenant', async () => {
    await expect(withTenant(h.db, orgA, (tx) => tx.insert(clients).values({ id: newId(), organizationId: orgB, name: 'smuggled' }))).rejects.toThrow();
  });

  it('system context sees all tenants', async () => {
    const all = await withSystem(h.db, (tx) => tx.select().from(clients));
    expect(all).toHaveLength(2);
  });
});
