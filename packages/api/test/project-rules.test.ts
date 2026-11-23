import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Projects, tasks and milestones (QA pass, feature 6).
 *
 * - BUG-80: restoring an archived project gave two active projects of one client the same name.
 * - BUG-81: an archived project's milestones could still be completed, edited and deleted (adding one
 *   was refused), and a completion counts toward goals and achievements.
 * - BUG-82: a task could be assigned to someone not on its project, who then never saw it.
 * - BUG-83: archiving something already archived (or restoring a task in use) wrote another audit row,
 *   and re-archiving a project moved its archive time, so restoring its client left it archived.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
type AuditRow = { action: string; target_id: string };
const auditFor = async (id: string) => {
  const b = (await admin.get<{ data: AuditRow[] } | AuditRow[]>(o(`/audit-logs?page=1&page_size=100`))).body;
  return (Array.isArray(b) ? b : b.data).filter((r) => r.target_id === id);
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@project-rules.test'));
}, 60_000);
afterAll(() => t.close());

describe('restoring a project (BUG-80)', () => {
  it('is refused while an active project of the same client has its name', async () => {
    const old = (await admin.post<{ id: string }>(o('/projects'), { name: 'Website' })).body.id;
    expect((await admin.post(o(`/projects/${old}/archive`))).status).toBe(204);
    expect((await admin.post(o('/projects'), { name: 'website ' })).status).toBe(201);
    const r = await admin.post<{ code: string }>(o(`/projects/${old}/restore`));
    expect([r.status, r.body?.code]).toEqual([409, 'duplicate_name']);
  });
});

describe('an archived project’s milestones (BUG-81)', () => {
  it('can’t be completed, edited or deleted', async () => {
    const p = (await admin.post<{ id: string }>(o('/projects'), { name: 'Shelved' })).body.id;
    const m = (await admin.post<{ id: string }>(o(`/projects/${p}/milestones`), { title: 'Beta', due_date: '2026-12-01' })).body.id;
    expect((await admin.post(o(`/projects/${p}/archive`))).status).toBe(204);
    expect((await admin.patch(o(`/milestones/${m}`), { completed: true })).status).toBe(422);
    expect((await admin.patch(o(`/milestones/${m}`), { title: 'Renamed' })).status).toBe(422);
    expect((await admin.del(o(`/milestones/${m}`))).status).toBe(422);
    // Restored, it works again.
    expect((await admin.post(o(`/projects/${p}/restore`))).status).toBe(204);
    expect((await admin.patch(o(`/milestones/${m}`), { completed: true })).status).toBe(200);
  });
});

describe('a task’s assignees (BUG-82)', () => {
  it('must be able to see the project', async () => {
    const p = (await admin.post<{ id: string }>(o('/projects'), { name: 'Tasks' })).body.id;
    const { client: wes, membershipId: wesId } = await addMember(t, admin, orgId, 'Wes', 'wes@project-rules.test');
    const outsider = await admin.post(o(`/projects/${p}/tasks`), { title: 'Do it', assignee_ids: [wesId] });
    expect(outsider.status).toBe(400);
    // On the project, the same assignment works and Wes sees the task.
    expect((await admin.patch(o(`/projects/${p}`), { member_ids: [wesId] })).status).toBe(200);
    const ok = await admin.post<{ id: string }>(o(`/projects/${p}/tasks`), { title: 'Do it', assignee_ids: [wesId] });
    expect(ok.status).toBe(201);
    expect((await wes.get<Array<{ id: string }>>(o('/tasks?mine=true'))).body.map((x) => x.id)).toContain(ok.body.id);
    // An org-wide admin can be assigned without being on it.
    const me = (await admin.get<{ organizations: Array<{ membership_id: string }> }>('/me')).body.organizations[0]!.membership_id;
    expect((await admin.post(o(`/projects/${p}/tasks`), { title: 'Review', assignee_ids: [me] })).status).toBe(201);
  });
});

describe('archiving twice (BUG-83)', () => {
  it('a task: one audit row each way', async () => {
    const p = (await admin.post<{ id: string }>(o('/projects'), { name: 'Twice' })).body.id;
    const id = (await admin.post<{ id: string }>(o(`/projects/${p}/tasks`), { title: 'Once' })).body.id;
    expect((await admin.del(o(`/tasks/${id}`))).status).toBe(204);
    expect((await admin.del(o(`/tasks/${id}`))).status).toBe(204);
    expect((await admin.post(o(`/tasks/${id}/restore`))).status).toBe(204);
    expect((await admin.post(o(`/tasks/${id}/restore`))).status).toBe(204);
    const rows = await auditFor(id);
    expect(rows.filter((r) => r.action === 'task.archived')).toHaveLength(1);
    expect(rows.filter((r) => r.action === 'task.restored')).toHaveLength(1);
  });

  it('a project archived with its client comes back with the client', async () => {
    const client = (await admin.post<{ id: string }>(o('/clients'), { name: 'Returning Co' })).body.id;
    const p = (await admin.post<{ id: string }>(o('/projects'), { name: 'Returning', client_id: client })).body.id;
    expect((await admin.post(o(`/clients/${client}/archive`))).status).toBe(204);
    expect((await admin.post(o(`/projects/${p}/archive`))).status).toBe(204);
    expect((await admin.post(o(`/clients/${client}/restore`))).status).toBe(204);
    expect((await admin.get<{ archived_at: string | null }>(o(`/projects/${p}`))).body.archived_at).toBeNull();
    expect((await auditFor(p)).filter((r) => r.action === 'project.archived')).toHaveLength(0);
  });
});
