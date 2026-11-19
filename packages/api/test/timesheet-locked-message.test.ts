import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Time can't be added to a period whose timesheet is submitted or approved. The refusal told everyone
 * to "reopen it", but only approvers can reopen a timesheet: a worker was told to do something they
 * cannot (QA round 6, BUG-23). Now a worker is told to ask their manager.
 */
const NOW = new Date('2026-11-18T15:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
let walt: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const hourOn = (date: string) => ({ started_at: `${date}T15:00:00.000Z`, ended_at: `${date}T16:00:00.000Z` });

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@locked-message.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@locked-message.test');
  projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [walt.membershipId] })).body.id;
  expect((await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: projectId, ...hourOn('2026-11-10'), reason: 'fixture' })).status).toBe(201);
  const ts = await walt.client.post(o('/timesheets/submit'), { date: '2026-11-10' });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
}, 60_000);
afterAll(() => t.close());

describe('time asked for in an approved period', () => {
  it('tells a worker to ask their manager, not to reopen it themselves', async () => {
    const r = await walt.client.post(o('/manual-time'), { project_id: projectId, ...hourOn('2026-11-11'), reason: 'forgot the timer' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('timesheet_locked');
    expect(r.body.title).toBe('The timesheet for this period is approved; ask your manager to reopen it, then try again');
  });

  it('tells someone who can approve it to reopen it', async () => {
    const r = await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: projectId, ...hourOn('2026-11-11'), reason: 'correction' });
    expect(r.status).toBe(422);
    expect(r.body.title).toBe('The timesheet for this period is approved; reopen it before changing its time');
  });
});
