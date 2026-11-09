import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@tallywork/db';
import { notify } from '../src/services/notify';
import { actorCtx, createHarness, signup, type Client, type Harness } from './harness';

/** Notifications carry a fixed priority from their type; nothing is hidden and every one stays unread. */
let t: Harness;
let orgId: string;
let ada: Client;

beforeAll(async () => {
  t = await createHarness();
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@np.test'));
  const me = await actorCtx(t, 'ada@np.test', orgId);
  await withTenant(t.deps.db, orgId, async (tx) => {
    await notify(tx, t.deps, orgId, [me.actor.membershipId], { type: 'budget.exceeded', title: 'Website is over budget', body: null, link: '/finance/budgets' });
    await notify(tx, t.deps, orgId, [me.actor.membershipId], { type: 'timesheet.submitted', title: 'Walt submitted a timesheet', body: null, link: '/timesheets/approvals' });
    await notify(tx, t.deps, orgId, [me.actor.membershipId], { type: 'timesheet.approved', title: 'Your timesheet was approved', body: null, link: null });
  });
});
afterAll(() => t.close());

describe('notification priority', () => {
  it('each notification says how urgent it is, and all of them count as unread', async () => {
    const r = await ada.get<{ data: Array<{ type: string; priority: string }>; unread: number }>(`/orgs/${orgId}/notifications`);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.data.map((n) => [n.type, n.priority]));
    expect(by).toEqual({ 'budget.exceeded': 'critical', 'timesheet.submitted': 'important', 'timesheet.approved': 'info' });
    expect(r.body.unread).toBe(3);
  });
});
