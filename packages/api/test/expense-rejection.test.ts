import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Rejecting an expense says why (UX remediation, phase 4): the reason is required, the member sees
 * it with who rejected it and when, it stays after a later approval, and it is in the audit log.
 * Approving and reimbursing need no reason.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;
const today = () => t.clock.now.toISOString().slice(0, 10);
type Row = { id: string; status: string; rejection_reason: string | null; rejected_by_name: string | null; rejected_at: string | null };

async function newExpense(category: string) {
  const r = await worker.post<{ id: string }>(o('/expenses'), { category, amount_minor: 2500, currency: 'USD', spent_on: today() });
  expect(r.status).toBe(201);
  return r.body.id;
}
const mine = async (id: string) => {
  const b = (await worker.get<{ data: Row[] } | Row[]>(o('/expenses?page=1&page_size=100'))).body;
  return (Array.isArray(b) ? b : b.data).find((e) => e.id === id)!;
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', 'ada@expenses.test'));
  ({ client: worker } = await addMember(t, admin, orgId, 'Walt Worker', 'walt@expenses.test'));
}, 60_000);
afterAll(() => t.close());

describe('expense rejection reasons', () => {
  it('needs a reason to reject, and the member sees it with who and when', async () => {
    const id = await newExpense('Taxi');
    expect((await admin.post(o(`/expenses/${id}/reject`), {})).status).toBe(400);
    expect((await admin.post(o(`/expenses/${id}/reject`), { reason: '  ' })).status).toBe(400);
    expect((await mine(id)).status).toBe('SUBMITTED');

    expect((await admin.post(o(`/expenses/${id}/reject`), { reason: 'The receipt is missing: add it and submit again.' })).status).toBe(204);
    const e = await mine(id);
    expect(e).toMatchObject({ status: 'REJECTED', rejection_reason: 'The receipt is missing: add it and submit again.', rejected_by_name: 'Ada Admin' });
    expect(e.rejected_at).toBeTruthy();
    // And is told, with the reason.
    await t.flush();
    const n = (await worker.get<{ data: Array<{ title: string; body: string | null }> }>(o('/notifications'))).body.data;
    expect(n.find((x) => x.title === 'Your expense was rejected')?.body).toBe('“The receipt is missing: add it and submit again.”');
  });

  it('approving and reimbursing need no reason; the earlier rejection stays as history', async () => {
    const id = await newExpense('Hotel');
    expect((await admin.post(o(`/expenses/${id}/reject`), { reason: 'Wrong project' })).status).toBe(204);
    expect((await admin.post(o(`/expenses/${id}/approve`))).status).toBe(204);
    expect((await admin.post(o(`/expenses/${id}/reimburse`))).status).toBe(204);
    expect(await mine(id)).toMatchObject({ status: 'REIMBURSED', rejection_reason: 'Wrong project' });
  });

  it('is in the audit log with the reason', async () => {
    const id = await newExpense('Parking');
    await admin.post(o(`/expenses/${id}/reject`), { reason: 'Personal trip' });
    const logs = (await admin.get<{ data: Array<{ action: string; target_id: string; after: { reason?: string } | null }> } | Array<{ action: string; target_id: string; after: { reason?: string } | null }>>(o('/audit-logs'))).body;
    const entry = (Array.isArray(logs) ? logs : logs.data).find((l) => l.action === 'expense.rejected' && l.target_id === id);
    expect(entry?.after?.reason).toBe('Personal trip');
  });

  it('cannot be rejected by the member themselves, or from another organization', async () => {
    const id = await newExpense('Lunch');
    expect((await worker.post(o(`/expenses/${id}/reject`), { reason: 'trying' })).status).toBe(403);
    const other = await signup(t, 'Olga', 'olga@expenses-other.test');
    expect((await other.client.post(`/orgs/${other.orgId}/expenses/${id}/reject`, { reason: 'not mine' })).status).toBe(404);
    expect((await mine(id)).status).toBe('SUBMITTED');
  });
});
