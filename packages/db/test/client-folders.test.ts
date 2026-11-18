import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import { clientFolders, clients, organizations, tenantTables, withSystem, withTenant } from '../src/index';

let h: DbHandle;
const orgA = newId();
const orgB = newId();
const clientA = newId();
const clientB = newId();
const settings = { lateGraceMinutes: 5, durationFormat: 'hm' as const, budgetWarnPct: 80, requireDeviceApproval: false, enforceMfa: 'none' as const, sessionTtlHours: 336 };

beforeAll(async () => {
  h = createDb('pglite://memory');
  await h.migrate();
  await withSystem(h.db, async (tx) => {
    await tx.insert(organizations).values([
      { id: orgA, slug: 'fa', name: 'A', settings },
      { id: orgB, slug: 'fb', name: 'B', settings },
    ]);
  });
  await withTenant(h.db, orgA, (tx) => tx.insert(clients).values({ id: clientA, organizationId: orgA, name: 'Acme' }));
  await withTenant(h.db, orgB, (tx) => tx.insert(clients).values({ id: clientB, organizationId: orgB, name: 'Bolt' }));
  await withTenant(h.db, orgA, (tx) => tx.insert(clientFolders).values({ id: newId(), organizationId: orgA, clientId: clientA, name: 'Acme folder' }));
}, 60_000);

afterAll(() => h.close());

describe('client_folders', () => {
  it('is a tenant table with forced row-level security', async () => {
    expect(tenantTables()).toContain('client_folders');
    const r = (await h.db.execute(sql`select relforcerowsecurity from pg_class where relname = 'client_folders'`)) as unknown as { rows: Array<{ relforcerowsecurity: boolean }> };
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('shows a folder only to its own organization', async () => {
    expect((await withTenant(h.db, orgA, (tx) => tx.select().from(clientFolders))).map((f) => f.name)).toEqual(['Acme folder']);
    expect(await withTenant(h.db, orgB, (tx) => tx.select().from(clientFolders))).toEqual([]);
    expect(await h.db.select().from(clientFolders)).toEqual([]);
  });

  it('cannot point at a client of another organization', async () => {
    // Inserting into org B a folder for org A's client fails the composite foreign key.
    await expect(withTenant(h.db, orgB, (tx) => tx.insert(clientFolders).values({ id: newId(), organizationId: orgB, clientId: clientA, name: 'stolen' }))).rejects.toThrow();
    // Writing a row for another tenant fails RLS.
    await expect(withTenant(h.db, orgA, (tx) => tx.insert(clientFolders).values({ id: newId(), organizationId: orgB, clientId: clientB, name: 'smuggled' }))).rejects.toThrow();
  });

  it('allows one folder per client', async () => {
    await expect(withTenant(h.db, orgA, (tx) => tx.insert(clientFolders).values({ id: newId(), organizationId: orgA, clientId: clientA, name: 'second' }))).rejects.toThrow();
  });

  it('goes away with its client', async () => {
    await withTenant(h.db, orgA, (tx) => tx.delete(clients).where(sql`${clients.id} = ${clientA}`));
    expect(await withTenant(h.db, orgA, (tx) => tx.select().from(clientFolders))).toEqual([]);
  });
});
