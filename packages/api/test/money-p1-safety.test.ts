import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Money audit (October 2026), P1 safety fixes:
// M9  — an expense submitted as not reimbursable cannot be reimbursed.
// M10 — a receipt backs one expense, of the person who uploaded it.
// M8  — payout (bank) detail changes are announced, and others reading them is audited.
// Payroll export — people with only paid time off are listed; unpaid leave is not counted.
let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let bea: Client;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function upload(who: Client): Promise<string> {
  const form = new FormData();
  form.append('file', new File(['%PDF-1.4 receipt'], 'receipt.pdf', { type: 'application/pdf' }));
  const r = await t.app.request(`/api/v1${o('/files/receipts')}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: who.cookie }, body: form });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
const expense = (receipt: string | null, extra: object = {}) => ({ category: 'Travel', amount_minor: 2500, currency: 'USD', spent_on: '2026-09-20', receipt_file_id: receipt, ...extra });
async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
const notes = async (who: Client) => ((await who.get(o('/notifications'))).body.data as Array<{ type: string; title: string }>).filter((n) => n.type === 'payroll.bank_details_changed');

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-05T20:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@moneyp1.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@moneyp1.test'));
  ({ client: bea } = await addMember(t, admin, orgId, 'Bea', 'bea@moneyp1.test'));
}, 60_000);
afterAll(() => t.close());

describe('M9: not-reimbursable expenses', () => {
  it('can be approved but not reimbursed (before the fix: 204 through the API)', async () => {
    const e = (await walt.post(o('/expenses'), expense(null, { reimbursable: false }))).body;
    expect((await admin.post(o(`/expenses/${e.id}/approve`))).status).toBe(204);
    const r = await admin.post(o(`/expenses/${e.id}/reimburse`));
    expect([r.status, r.body.code]).toEqual([422, 'expense_not_reimbursable']);
    // A reimbursable one still can, once.
    const ok = (await walt.post(o('/expenses'), expense(null))).body;
    await admin.post(o(`/expenses/${ok.id}/approve`));
    expect((await admin.post(o(`/expenses/${ok.id}/reimburse`))).status).toBe(204);
    expect((await admin.post(o(`/expenses/${ok.id}/reimburse`))).body.code).toBe('invalid_expense_transition');
  });
});

describe('M10: one receipt, one expense, by its uploader', () => {
  it('refuses a receipt already used, or uploaded by someone else', async () => {
    const receipt = await upload(walt);
    expect((await walt.post(o('/expenses'), expense(receipt))).status).toBe(201);
    const again = await walt.post(o('/expenses'), expense(receipt));
    expect([again.status, again.body.code]).toEqual([422, 'receipt_in_use']); // was 201: a second claim
    const other = await bea.post(o('/expenses'), expense(await upload(walt)));
    expect(other.status).toBe(404); // was 201: someone else's receipt
    expect((await bea.post(o('/expenses'), expense(await upload(bea)))).status).toBe(201);
  });
});

describe('M8: payout detail changes are announced', () => {
  let profileId: string;
  beforeAll(async () => {
    profileId = (await admin.post(o('/payroll/profiles'), { name: 'Monthly', period: { type: 'monthly' }, currency: 'USD', member_ids: [waltId] })).body.id;
  });

  it('a manager changing a member’s details tells the member in the app and by email', async () => {
    t.mailer.sent.length = 0;
    expect((await admin.put(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`), { type: 'bank', account_number: '12345678' })).status).toBe(200);
    expect((await notes(walt)).map((n) => n.title)).toEqual(['Your payout details were changed']);
    const mail = t.mailer.sent.filter((m) => m.to === 'walt@moneyp1.test');
    expect(mail.map((m) => m.subject)).toEqual(['Your payout details were changed']);
    expect(mail[0]!.text).not.toContain('12345678');
  });

  it('a member changing their own details tells the payroll managers', async () => {
    expect((await walt.put(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`), { type: 'bank', account_number: '87654321' })).status).toBe(200);
    expect((await notes(admin)).map((n) => n.title)).toContain('Walt changed their payout details');
    expect((await notes(walt))).toHaveLength(1); // no notice to themselves
  });

  it('someone else opening the full details is audited; the member opening their own is not', async () => {
    const count = async () => (await asOwner<{ n: number }>(sql`select count(*)::int n from audit_logs where organization_id = ${orgId} and action = 'payroll.bank_details_viewed'`))[0]!.n;
    const before = await count();
    expect((await admin.get(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`))).body.account_number).toBe('87654321');
    expect(await count()).toBe(before + 1);
    await walt.get(o(`/payroll/profiles/${profileId}/members/${waltId}/bank`));
    expect(await count()).toBe(before + 1);
  });
});

describe('payroll export and time off', () => {
  it('lists someone with only paid time off, and leaves unpaid leave out', async () => {
    const { client: lea, membershipId: leaId } = await addMember(t, admin, orgId, 'Lea', 'lea@moneyp1.test');
    const policy = async (name: string, paid: boolean) => (await admin.post(o('/time-off/policies'), { name, paid, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false })).body.id;
    expect((await lea.post(o('/time-off/requests'), { policy_id: await policy('Vacation P1', true), start_date: '2026-09-14', end_date: '2026-09-15' })).status).toBe(201);
    expect((await lea.post(o('/time-off/requests'), { policy_id: await policy('Unpaid P1', false), start_date: '2026-09-21', end_date: '2026-09-21' })).status).toBe(201);
    const rep = (await admin.post(o('/reports/payroll/query'), { from: '2026-09-01', to: '2026-09-30', membership_ids: [leaId] })).body;
    // Before: no row at all (no tracked time); with tracked time, the unpaid day was counted too.
    expect(rep.rows.map((r: { worker: string; time_off_hours: number }) => [r.worker, r.time_off_hours])).toEqual([['Lea', 16]]);
  });
});
