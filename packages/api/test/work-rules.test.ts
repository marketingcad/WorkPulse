import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// Clients, Projects and Tasks audit (October 2026): the business rules decided for W2, W5, W6, W9 and
// duplicate names.
const H = 3600_000;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function adminTime(membershipId: string, projectId: string, startIso: string, ms = H, extra: object = {}) {
  const s = new Date(startIso);
  const r = await admin.post(o('/manual-time'), { membership_id: membershipId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + ms).toISOString(), reason: 'fixture', ...extra });
  expect(r.status).toBe(201);
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-27T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@rules2.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@rules2.test'));
}, 60_000);
afterAll(() => t.close());

describe('W2: a project that moves to another client', () => {
  it('shows the new client only the work done after the move', async () => {
    t.clock.set(new Date('2026-10-20T12:00:00Z'));
    const a =(await admin.post(o('/clients'), { name: 'Old Co' })).body.id;
    const b = (await admin.post(o('/clients'), { name: 'New Co' })).body.id;
    const p = (await admin.post(o('/projects'), { name: 'Shared site', client_id: a, member_ids: [waltId] })).body.id;
    const before = (await admin.post(o(`/projects/${p}/tasks`), { title: 'Done for Old Co', status: 'DONE' })).body.id;
    await adminTime(waltId, p, '2026-10-20T09:00:00Z', 3 * H); // work for Old Co
    t.clock.set(new Date('2026-10-22T12:00:00Z'));
    expect((await admin.patch(o(`/projects/${p}`), { client_id: b })).status).toBe(200);
    const after = (await admin.post(o(`/projects/${p}/tasks`), { title: 'For New Co' })).body.id;
    t.clock.set(new Date('2026-10-23T12:00:00Z'));
    await adminTime(waltId, p, '2026-10-23T08:00:00Z', H); // work for New Co
    await t.flush();
    await admin.put(o(`/clients/${b}/portal`), { enabled: true, sections: { hours: true, tasks: true } });
    const view = (await admin.get(o(`/clients/${b}/portal/preview?from=2026-10-01&to=2026-10-31`))).body;
    // Before the fix: 4 h, including Old Co's 3 h, and Old Co's finished task.
    expect(view.totals.tracked_seconds + view.totals.manual_seconds).toBe(3600);
    expect(view.tasks.map((x: { id: string }) => x.id)).toEqual([after]);
    expect(view.tasks.some((x: { id: string }) => x.id === before)).toBe(false);
  });
});

describe('W5: archiving a client', () => {
  it('archives its projects too, and restoring brings back exactly those', async () => {
    const c = (await admin.post(o('/clients'), { name: 'Closing Co' })).body.id;
    const live = (await admin.post(o('/projects'), { name: 'Live', client_id: c, member_ids: [waltId] })).body.id;
    const old = (await admin.post(o('/projects'), { name: 'Already closed', client_id: c })).body.id;
    t.clock.set(new Date('2026-10-24T12:00:00Z'));
    await admin.post(o(`/projects/${old}/archive`));
    t.clock.set(new Date('2026-10-25T12:00:00Z'));
    expect((await admin.post(o(`/clients/${c}/archive`))).status).toBe(204);
    expect((await admin.get(o(`/projects/${live}`))).body.archived_at).not.toBeNull();
    // No new time on it (before the fix the timer started).
    expect((await walt.post(o('/tracking/start'), { project_id: live })).status).toBe(404);
    // No new project for an archived client.
    const attach = await admin.post(o('/projects'), { name: 'New for closed', client_id: c });
    expect([attach.status, attach.body.errors?.[0]?.field]).toEqual([400, 'client_id']);
    // A project of an archived client cannot be restored on its own.
    const alone = await admin.post(o(`/projects/${live}/restore`));
    expect([alone.status, alone.body.code]).toEqual([422, 'client_archived']);
    // Restore: the projects archived with it come back; the one closed before stays closed.
    expect((await admin.post(o(`/clients/${c}/restore`))).status).toBe(204);
    expect((await admin.get(o(`/projects/${live}`))).body.archived_at).toBeNull();
    expect((await admin.get(o(`/projects/${old}`))).body.archived_at).not.toBeNull();
  });
});

describe('W6: someone removed and invited back', () => {
  it('starts with only what the new invitation gives, not their old projects and tasks', async () => {
    const { client: rae, membershipId: raeId } = await addMember(t, admin, orgId, 'Rae', 'rae@rules2.test');
    const old = (await admin.post(o('/projects'), { name: 'Rae old project', member_ids: [raeId] })).body.id;
    const task = (await admin.post(o(`/projects/${old}/tasks`), { title: 'Rae task', assignee_ids: [raeId] })).body.id;
    expect((await admin.del(o(`/workers/${raeId}`))).status).toBe(204);
    expect((await admin.get(o(`/projects/${old}`))).body.member_ids).not.toContain(raeId);

    const roles = (await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>;
    const inv = await admin.post(o('/invitations'), { email: 'rae@rules2.test', name: 'Rae', role_id: roles.find((r) => r.key === 'WORKER')!.id });
    const token = new URL(inv.body.invite_url).searchParams.get('token')!;
    expect((await rae.post('/auth/invitations/accept', { token })).status).toBe(200);
    // Before the fix both came back silently.
    expect((await admin.get(o(`/projects/${old}`))).body.member_ids).not.toContain(raeId);
    const tasks = (await admin.get(o(`/projects/${old}/tasks`))).body as Array<{ id: string; assignee_ids: string[] }>;
    expect(tasks.find((x) => x.id === task)?.assignee_ids).toEqual([]);
  });

  it('a member who is still active keeps their projects when they accept another invitation', async () => {
    const { client: kim, membershipId: kimId } = await addMember(t, admin, orgId, 'Kim', 'kim@rules2.test');
    const mine = (await admin.post(o('/projects'), { name: 'Kim project', member_ids: [kimId] })).body.id;
    const roles = (await admin.get(o('/roles'))).body as Array<{ id: string; key: string }>;
    const inv = await admin.post(o('/invitations'), { email: 'kim@rules2.test', name: 'Kim', role_id: roles.find((r) => r.key === 'WORKER')!.id });
    if (inv.status === 201) {
      const token = new URL(inv.body.invite_url).searchParams.get('token')!;
      await kim.post('/auth/invitations/accept', { token });
    }
    expect((await admin.get(o(`/projects/${mine}`))).body.member_ids).toContain(kimId);
  });
});

describe('W9: currency changes', () => {
  it('are refused while rates in the old currency are in use, and allowed once they are changed', async () => {
    const c = (await admin.post(o('/clients'), { name: 'Dollar Co', currency: 'USD' })).body.id;
    const p = (await admin.post(o('/projects'), { name: 'Dollar site', client_id: c, bill_rate_minor: 10000 })).body.id;
    const r1 = await admin.patch(o(`/clients/${c}`), { currency: 'EUR' });
    expect([r1.status, r1.body.code]).toEqual([422, 'rates_in_other_currency']); // was accepted: time then uninvoiceable
    // End the project's rate (or set it again in EUR), then the change goes through.
    expect((await admin.patch(o(`/projects/${p}`), { bill_rate_minor: null })).status).toBe(200);
    expect((await admin.patch(o(`/clients/${c}`), { currency: 'EUR' })).status).toBe(200);
  });

  it('moving a project to a client in another currency is refused while its rates are in the old one', async () => {
    const usd = (await admin.post(o('/clients'), { name: 'US Co', currency: 'USD' })).body.id;
    const eur = (await admin.post(o('/clients'), { name: 'EU Co', currency: 'EUR' })).body.id;
    const p = (await admin.post(o('/projects'), { name: 'Moving site', client_id: usd, bill_rate_minor: 9000 })).body.id;
    const r = await admin.patch(o(`/projects/${p}`), { client_id: eur });
    expect([r.status, r.body.code]).toEqual([422, 'rates_in_other_currency']);
    // Moving and setting the rate in the new currency together works.
    expect((await admin.patch(o(`/projects/${p}`), { client_id: eur, bill_rate_minor: 8500 })).status).toBe(200);
  });
});

describe('duplicate names', () => {
  it('two active clients cannot share a name; an archived one does not count', async () => {
    const first = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
    const dup = await admin.post(o('/clients'), { name: '  globex ' });
    expect([dup.status, dup.body.code]).toEqual([409, 'duplicate_name']);
    await admin.post(o(`/clients/${first}/archive`));
    expect((await admin.post(o('/clients'), { name: 'Globex' })).status).toBe(201);
  });

  it('two active projects of the same client cannot share a name; another client may use it', async () => {
    const c1 = (await admin.post(o('/clients'), { name: 'Initech' })).body.id;
    const c2 = (await admin.post(o('/clients'), { name: 'Umbrella' })).body.id;
    expect((await admin.post(o('/projects'), { name: 'Website', client_id: c1 })).status).toBe(201);
    const dup = await admin.post(o('/projects'), { name: 'WEBSITE', client_id: c1 });
    expect([dup.status, dup.body.code]).toEqual([409, 'duplicate_name']);
    expect((await admin.post(o('/projects'), { name: 'Website', client_id: c2 })).status).toBe(201);
  });
});
