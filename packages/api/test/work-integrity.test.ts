import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

// Clients, Projects and Tasks audit (October 2026), group 2: data integrity.
const H = 3600_000;

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let site: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-27T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@integrity.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@integrity.test'));
  site = (await admin.post(o('/projects'), { name: 'Site', member_ids: [waltId] })).body.id;
}, 60_000);
afterAll(() => t.close());

describe('W7: approving manual time checks the project again', () => {
  it('a request whose project was archived since cannot be approved, but can be rejected', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Short job', member_ids: [waltId] })).body.id;
    const req = await walt.post(o('/manual-time'), { project_id: p, started_at: '2026-10-26T09:00:00Z', ended_at: '2026-10-26T10:00:00Z', reason: 'phone call' });
    expect(req.status).toBe(201);
    await admin.post(o(`/projects/${p}/archive`));
    // Before the fix this was approved and created time on the archived project.
    const approve = await admin.post(o(`/manual-time/${req.body.id}/approve`), {});
    expect([approve.status, approve.body.code]).toEqual([422, 'manual_time_target_unavailable']);
    expect((await admin.post(o(`/manual-time/${req.body.id}/reject`), { comment: 'Project closed' })).status).toBe(204);
  });
});

describe('W8: archived projects', () => {
  it('take no new tasks and their tasks leave the task list', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Old site' })).body.id;
    const task = (await admin.post(o(`/projects/${p}/tasks`), { title: 'Leftover' })).body.id;
    await admin.post(o(`/projects/${p}/archive`));
    const create = await admin.post(o(`/projects/${p}/tasks`), { title: 'New on archived' });
    expect([create.status, create.body.code]).toEqual([422, 'project_archived']); // was 201
    const list = (await admin.get(o('/tasks?page=1&page_size=100'))).body.data as Array<{ id: string }>;
    expect(list.some((x) => x.id === task)).toBe(false); // was listed
    await admin.post(o(`/projects/${p}/restore`));
    expect(((await admin.get(o('/tasks?page=1&page_size=100'))).body.data as Array<{ id: string }>).some((x) => x.id === task)).toBe(true);
  });
});

describe('W10: people on tasks and projects', () => {
  it('only active members can be assigned or added, with a clear error', async () => {
    const { membershipId: gone } = await addMember(t, admin, orgId, 'Gus', 'gus@integrity.test');
    expect((await admin.del(o(`/workers/${gone}`))).status).toBe(204);
    const r1 = await admin.post(o(`/projects/${site}/tasks`), { title: 'For Gus', assignee_ids: [gone] });
    expect([r1.status, r1.body.errors?.[0]?.field]).toEqual([400, 'assignee_ids']);
    const r2 = await admin.post(o(`/projects/${site}/tasks`), { title: 'For nobody', assignee_ids: ['01a17a00-0000-7000-8000-000000000000'] });
    expect(r2.status).toBe(400); // was a 500 (database error)
    const r3 = await admin.patch(o(`/projects/${site}`), { member_ids: [waltId, gone] });
    expect([r3.status, r3.body.errors?.[0]?.field]).toEqual([400, 'member_ids']);
    const r4 = await admin.patch(o(`/projects/${site}`), { team_ids: ['01a17a00-0000-7000-8000-000000000001'] });
    expect([r4.status, r4.body.errors?.[0]?.field]).toEqual([400, 'team_ids']);
    expect((await admin.post(o(`/projects/${site}/tasks`), { title: 'For Walt', assignee_ids: [waltId] })).status).toBe(201);
  });
});

describe('W11: expenses', () => {
  it('need a project the person can see and that is in use, and the project’s own client', async () => {
    const acme = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
    const other = (await admin.post(o('/clients'), { name: 'Other' })).body.id;
    const acmeSite = (await admin.post(o('/projects'), { name: 'Acme site', client_id: acme, member_ids: [waltId] })).body.id;
    const notWalts = (await admin.post(o('/projects'), { name: 'Not Walt’s', client_id: other })).body.id;
    const base = { category: 'Travel', amount_minor: 2500, currency: 'USD', spent_on: '2026-10-26', billable: true };
    expect((await walt.post(o('/expenses'), { ...base, project_id: notWalts })).status).toBe(404);
    const mismatch = await walt.post(o('/expenses'), { ...base, project_id: acmeSite, client_id: other });
    expect([mismatch.status, mismatch.body.errors?.[0]?.field]).toEqual([400, 'client_id']);
    const ok = await walt.post(o('/expenses'), { ...base, project_id: acmeSite });
    expect(ok.status).toBe(201);
    await admin.post(o(`/projects/${acmeSite}/archive`));
    expect((await walt.post(o('/expenses'), { ...base, project_id: acmeSite })).status).toBe(400);
  });
});

describe('W12 and W13: task completion and restore', () => {
  it('a task created as done has a completion date', async () => {
    const r = await admin.post(o(`/projects/${site}/tasks`), { title: 'Already done', status: 'DONE' });
    expect(r.body.completed_at).toBe(t.clock.now.toISOString()); // was null
  });

  it('an archived task can be listed and restored, and is read-only until then', async () => {
    const task = (await admin.post(o(`/projects/${site}/tasks`), { title: 'Archive me' })).body.id;
    expect((await admin.del(o(`/tasks/${task}`))).status).toBe(204);
    const edit = await admin.patch(o(`/tasks/${task}`), { project_id: site, status: 'DONE' });
    expect([edit.status, edit.body.code]).toEqual([422, 'task_archived']);
    const archived = (await admin.get(o('/tasks?page=1&page_size=100&archived=true'))).body.data as Array<{ id: string; archived_at: string | null }>;
    expect(archived.find((x) => x.id === task)?.archived_at).toBeTruthy();
    expect((await walt.post(o(`/tasks/${task}/restore`))).status).toBe(403); // workers cannot
    expect((await admin.post(o(`/tasks/${task}/restore`))).status).toBe(204);
    expect((await admin.patch(o(`/tasks/${task}`), { project_id: site, status: 'DONE' })).status).toBe(200);
  });

  it('a task cannot be restored while its project is archived', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Paused' })).body.id;
    const task = (await admin.post(o(`/projects/${p}/tasks`), { title: 'Inside' })).body.id;
    await admin.del(o(`/tasks/${task}`));
    await admin.post(o(`/projects/${p}/archive`));
    const r = await admin.post(o(`/tasks/${task}/restore`));
    expect([r.status, r.body.code]).toEqual([422, 'project_archived']);
  });
});

describe('W16: the desktop app lists only tasks it can track', () => {
  it('leaves out tasks of projects on hold', async () => {
    const held = (await admin.post(o('/projects'), { name: 'On hold', member_ids: [waltId] })).body.id;
    const heldTask = (await admin.post(o(`/projects/${held}/tasks`), { title: 'Waiting', assignee_ids: [waltId] })).body.id;
    const liveTask = (await admin.post(o(`/projects/${site}/tasks`), { title: 'Live', assignee_ids: [waltId] })).body.id;
    await admin.patch(o(`/projects/${held}`), { status: 'ON_HOLD' });
    const { verifier, challenge } = pkce();
    const code = await walt.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'PC', platform: 'linux', agent_version: '0.1.9' } })).body.access_token;
    const mine = (await agent.get('/agent/me/tasks')).body as Array<{ id: string }>;
    expect(mine.some((x) => x.id === liveTask)).toBe(true);
    expect(mine.some((x) => x.id === heldTask)).toBe(false); // was listed, and refused when tracked
    void H;
  });
});
