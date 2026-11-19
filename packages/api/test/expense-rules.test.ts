import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Expenses (QA pass, feature 15): the rules an expense follows from submission to reimbursement.
 *
 * - BUG-35: an expense dated in the future was accepted.
 * - BUG-36: a billable expense with no project or client was accepted, and could never reach an invoice.
 * - BUG-37: submitting an expense answered 201 with no body once 1,000 newer expenses were visible.
 * - The decision rules (which status can move to which, team scope, never your own) had no tests.
 */
const NOW = new Date('2026-11-20T03:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let walt: { client: Client; membershipId: string };
let mia: { client: Client; membershipId: string };
let otto: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const expense = (extra: Record<string, unknown> = {}) => ({ category: 'Taxi', amount_minor: 2500, currency: 'USD', spent_on: '2026-11-18', ...extra });

async function submitted(by: Client = walt.client) {
  const r = await by.post<{ id: string }>(o('/expenses'), expense());
  expect(r.status).toBe(201);
  return r.body.id;
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@expense-rules.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@expense-rules.test');
  otto = await addMember(t, admin, orgId, 'Otto', 'otto@expense-rules.test');
  mia = await addMember(t, admin, orgId, 'Mia', 'mia@expense-rules.test', 'TEAM_MANAGER');
  const team = (await admin.post(o('/teams'), { name: 'Field' })).body.id as string;
  expect((await admin.put(o(`/teams/${team}/members/${mia.membershipId}`), { role: 'MANAGER' })).status).toBe(200);
  expect((await admin.put(o(`/teams/${team}/members/${walt.membershipId}`), { role: 'MEMBER' })).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

describe('the date of an expense', () => {
  it('cannot be in the future (BUG-35)', async () => {
    const r = await walt.client.post(o('/expenses'), expense({ spent_on: '2026-11-25' }));
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'spent_on' })]));
  });

  it('can be today anywhere on Earth, whatever the organization’s zone', async () => {
    // 03:00 UTC on the 20th is already the 20th in Kiritimati (UTC+14) but the 19th in the Americas.
    expect((await walt.client.post(o('/expenses'), expense({ spent_on: '2026-11-20' }))).status).toBe(201);
    expect((await walt.client.post(o('/expenses'), expense({ spent_on: '2026-11-21' }))).status).toBe(400);
  });
});

describe('a billable expense', () => {
  it('needs a project or client to bill (BUG-36)', async () => {
    const r = await walt.client.post(o('/expenses'), expense({ billable: true }));
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'project_id' })]));
  });

  it('is accepted with a project that has a client', async () => {
    const client = (await admin.post(o('/clients'), { name: 'Acme', currency: 'USD' })).body.id as string;
    const project = (await admin.post(o('/projects'), { name: 'Acme site', client_id: client, member_ids: [walt.membershipId] })).body.id as string;
    expect((await walt.client.post(o('/expenses'), expense({ billable: true, project_id: project }))).status).toBe(201);
  });
});

describe('who decides, and from which status', () => {
  it('approve, reimburse, then nothing more', async () => {
    const id = await submitted();
    expect((await admin.post(o(`/expenses/${id}/reimburse`), {})).status).toBe(422);
    expect((await admin.post(o(`/expenses/${id}/approve`), {})).status).toBe(204);
    expect((await admin.post(o(`/expenses/${id}/approve`), {})).status).toBe(422);
    expect((await admin.post(o(`/expenses/${id}/reimburse`), {})).status).toBe(204);
    expect((await admin.post(o(`/expenses/${id}/reimburse`), {})).status).toBe(422);
    expect((await admin.post(o(`/expenses/${id}/reject`), { reason: 'Too late to reject' })).status).toBe(422);
  });

  it('a rejected expense cannot be reimbursed', async () => {
    const id = await submitted();
    expect((await admin.post(o(`/expenses/${id}/reject`), { reason: 'No receipt' })).status).toBe(204);
    expect((await admin.post(o(`/expenses/${id}/reimburse`), {})).status).toBe(422);
  });

  it('a team manager decides for their team only, never for themselves', async () => {
    const inTeam = await submitted(walt.client);
    const outside = await submitted(otto.client);
    const own = await submitted(mia.client);
    expect((await mia.client.post(o(`/expenses/${inTeam}/approve`), {})).status).toBe(204);
    expect([403, 404]).toContain((await mia.client.post(o(`/expenses/${outside}/approve`), {})).status);
    expect((await mia.client.post(o(`/expenses/${own}/approve`), {})).status).toBe(403);
  });

  it('a worker decides nothing', async () => {
    const id = await submitted(otto.client);
    expect([403, 404]).toContain((await walt.client.post(o(`/expenses/${id}/approve`), {})).status);
  });
});

describe('submitting in a busy organization (BUG-37)', () => {
  it('answers with the new expense, even with more than 1,000 newer ones', async () => {
    await withSystem(t.h.db, async (tx) => {
      await tx.execute(sql`
        insert into expenses (id, organization_id, membership_id, category, amount_minor, currency, spent_on)
        select gen_random_uuid(), ${orgId}::uuid, ${otto.membershipId}::uuid, 'Bulk', 100, 'USD', '2026-11-19'
        from generate_series(1, 1005)`);
    });
    const r = await admin.post<{ id: string; category: string; spent_on: string }>(o('/expenses'), expense({ category: 'Old receipt', spent_on: '2026-01-05' }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ category: 'Old receipt', spent_on: '2026-01-05' });
    expect(r.body.id).toBeTruthy();
  });
});
