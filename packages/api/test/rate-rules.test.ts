import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

/**
 * Rates and budgets (QA pass, feature 14).
 *
 * - BUG-57: the Rates page saved a bill rate for a client or project in another currency than the
 *   client's, so its time could never be invoiced.
 * - BUG-58: changing a client's currency checked only the rates in effect today (a rate starting next
 *   month in the old currency passed).
 * - BUG-59: saving a budget, even unchanged, reset its alerts, so they were sent again.
 */
const NOW = new Date('2026-11-20T06:00:00Z');
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const client = async (name: string, currency: string) => (await admin.post<{ id: string }>(o('/clients'), { name, currency })).body.id;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@rate-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('rates on a client in another currency', () => {
  it('a bill rate in another currency than the client’s is refused on the Rates page (BUG-57)', async () => {
    const euro = await client('Euro SA', 'EUR');
    const wrong = await admin.post(o('/rates'), { kind: 'BILL', scope: 'CLIENT', scope_id: euro, amount_minor: 5000, currency: 'USD', effective_from: '2026-11-20' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.title).toMatch(/EUR/);
    expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'CLIENT', scope_id: euro, amount_minor: 5000, currency: 'EUR', effective_from: '2026-11-20' })).status).toBeLessThan(300);
  });
});

describe('changing a client’s currency (BUG-58)', () => {
  it('is refused while a bill rate starting later is in the old currency', async () => {
    const c = await client('Future Ltd', 'USD');
    expect((await admin.post(o('/rates'), { kind: 'BILL', scope: 'CLIENT', scope_id: c, amount_minor: 7000, currency: 'USD', effective_from: '2026-12-01' })).status).toBeLessThan(300);
    const r = await admin.patch(o(`/clients/${c}`), { currency: 'EUR' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('rates_in_other_currency');
  });
});

describe('saving a budget (BUG-59)', () => {
  it('keeps its alerts unless something about it changed', async () => {
    const c = await client('Budget Co', 'USD');
    const budget = { subject_type: 'CLIENT', subject_id: c, kind: 'HOURS', amount: 3600 * 10, period: 'TOTAL', warn_pct: 80, include_non_billable: false };
    expect((await admin.put(o('/budgets'), budget)).status).toBe(200);
    // The warning was sent.
    await withSystem(t.h.db, (tx) => tx.execute(sql`update budgets set last_notified_level = 1 where subject_id = ${c}`));
    const level = async () => ((await withSystem(t.h.db, (tx) => tx.execute(sql`select last_notified_level as l from budgets where subject_id = ${c}`))) as unknown as { rows: Array<{ l: number }> }).rows[0]!.l;

    expect((await admin.put(o('/budgets'), budget)).status).toBe(200);
    expect(await level()).toBe(1);

    expect((await admin.put(o('/budgets'), { ...budget, amount: 3600 * 20 })).status).toBe(200);
    expect(await level()).toBe(0);
  });
});
