import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import { assistantConversations, assistantMessages, memberships, organizations, roles, users, withSystem, withTenant } from '../src/index';

/** Assistant tables: forced RLS, same-tenant references and cascade deletes. */
let h: DbHandle;
const settings = { lateGraceMinutes: 5, durationFormat: 'hm' as const, budgetWarnPct: 80, requireDeviceApproval: false, enforceMfa: 'none' as const, sessionTtlHours: 336 };
const A = { org: newId(), role: newId(), user: newId(), member: newId(), conv: newId() };
const B = { org: newId(), role: newId(), user: newId(), member: newId() };

beforeAll(async () => {
  h = createDb('pglite://memory');
  await h.migrate();
  await withSystem(h.db, async (tx) => {
    await tx.insert(organizations).values([
      { id: A.org, slug: 'ai-a', name: 'A', settings },
      { id: B.org, slug: 'ai-b', name: 'B', settings },
    ]);
    await tx.insert(users).values([
      { id: A.user, email: 'a@ai.test', name: 'A', passwordHash: 'x' },
      { id: B.user, email: 'b@ai.test', name: 'B', passwordHash: 'x' },
    ]);
    for (const o of [A, B]) {
      await tx.insert(roles).values({ id: o.role, organizationId: o.org, key: 'WORKER', name: 'Worker' });
      await tx.insert(memberships).values({ id: o.member, organizationId: o.org, userId: o.user, roleId: o.role, status: 'ACTIVE' });
    }
  });
  await withTenant(h.db, A.org, async (tx) => {
    await tx.insert(assistantConversations).values({ id: A.conv, organizationId: A.org, membershipId: A.member, title: 'Hello' });
    await tx.insert(assistantMessages).values({ id: newId(), organizationId: A.org, conversationId: A.conv, role: 'user', content: 'hi' });
  });
}, 60_000);
afterAll(() => h.close());

describe('assistant tables', () => {
  it('have forced row-level security with a tenant policy', async () => {
    const r = (await h.db.execute(sql`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.relname in ('assistant_conversations', 'assistant_messages') order by c.relname`)) as unknown as {
      rows: Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;
    };
    expect(r.rows).toEqual([
      { relname: 'assistant_conversations', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'assistant_messages', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const p = (await h.db.execute(sql`select tablename from pg_policies where policyname = 'tenant_isolation' and tablename in ('assistant_conversations', 'assistant_messages') order by tablename`)) as unknown as { rows: Array<{ tablename: string }> };
    expect(p.rows.map((x) => x.tablename)).toEqual(['assistant_conversations', 'assistant_messages']);
  });

  it('only show the current tenant rows', async () => {
    expect(await withTenant(h.db, B.org, (tx) => tx.select().from(assistantConversations))).toEqual([]);
    expect(await withTenant(h.db, B.org, (tx) => tx.select().from(assistantMessages))).toEqual([]);
    expect(await withTenant(h.db, A.org, (tx) => tx.select().from(assistantConversations))).toHaveLength(1);
  });

  it('a message cannot point at another tenant’s conversation (composite foreign key)', async () => {
    await expect(withSystem(h.db, (tx) => tx.insert(assistantMessages).values({ id: newId(), organizationId: B.org, conversationId: A.conv, role: 'user', content: 'x' }))).rejects.toThrow();
    await expect(withTenant(h.db, B.org, (tx) => tx.insert(assistantMessages).values({ id: newId(), organizationId: B.org, conversationId: A.conv, role: 'user', content: 'x' }))).rejects.toThrow();
  });

  it('a conversation cannot belong to another tenant’s member', async () => {
    await expect(withSystem(h.db, (tx) => tx.insert(assistantConversations).values({ id: newId(), organizationId: B.org, membershipId: A.member, title: 'x' }))).rejects.toThrow();
  });

  it('a message role is user or assistant', async () => {
    await expect(withTenant(h.db, A.org, (tx) => tx.insert(assistantMessages).values({ id: newId(), organizationId: A.org, conversationId: A.conv, role: 'system' as never, content: 'x' }))).rejects.toThrow();
  });

  it('deleting a conversation deletes its messages', async () => {
    const conv = newId();
    await withTenant(h.db, A.org, async (tx) => {
      await tx.insert(assistantConversations).values({ id: conv, organizationId: A.org, membershipId: A.member, title: 'Temp' });
      await tx.insert(assistantMessages).values([
        { id: newId(), organizationId: A.org, conversationId: conv, role: 'user', content: 'q', navTargets: ['/o/x'] },
        { id: newId(), organizationId: A.org, conversationId: conv, role: 'assistant', content: 'a', toolCalls: [{ name: 't', args: {}, status: 'ok' }] },
      ]);
    });
    const count = async () => (await withTenant(h.db, A.org, (tx) => tx.select().from(assistantMessages))).filter((m) => m.conversationId === conv).length;
    expect(await count()).toBe(2);
    await withTenant(h.db, A.org, (tx) => tx.delete(assistantConversations).where(sql`${assistantConversations.id} = ${conv}`));
    expect(await count()).toBe(0);
    expect(await withTenant(h.db, A.org, (tx) => tx.select().from(assistantMessages))).toHaveLength(1);
  });
});
