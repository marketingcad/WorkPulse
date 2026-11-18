import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let orgId: string;
let acme: string;
let globex: string;
let site: string;
let app: string;
let globexSite: string;
let loose: string;
let walt: { client: Client; membershipId: string };
let mia: { client: Client; membershipId: string };
let folderId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@folders.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@folders.test');
  mia = await addMember(t, admin, orgId, 'Mia', 'mia@folders.test', 'TEAM_MANAGER');
  acme = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  globex = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
  site = (await admin.post(o('/projects'), { name: 'Website', client_id: acme, member_ids: [walt.membershipId, mia.membershipId] })).body.id;
  app = (await admin.post(o('/projects'), { name: 'Mobile app', client_id: acme })).body.id;
  globexSite = (await admin.post(o('/projects'), { name: 'Globex site', client_id: globex, member_ids: [walt.membershipId] })).body.id;
  loose = (await admin.post(o('/projects'), { name: 'Internal tools' })).body.id;
});
afterAll(() => t.close());

describe('client folders are optional', () => {
  it('are off by default: the list is empty and nothing can be created', async () => {
    expect((await admin.get(o('/client-folders'))).body).toEqual({ enabled: false, folders: [] });
    const r = await admin.post(o('/client-folders'), { client_id: acme });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('client_folders_disabled');
  });

  it('only people who can update the organization turn them on', async () => {
    expect((await mia.client.patch(o(''), { settings: { clientFolders: true } })).status).toBe(403);
    expect((await walt.client.patch(o(''), { settings: { clientFolders: true } })).status).toBe(403);
    expect((await admin.patch(o(''), { settings: { clientFolders: 'yes' } })).status).toBe(400);
    expect((await admin.patch(o(''), { settings: { clientFolders: true } })).status).toBe(200);
    expect((await admin.get(o('/client-folders'))).body).toEqual({ enabled: true, folders: [] });
  });
});

describe('managing folders (System Admin)', () => {
  it('creates a folder for a client, named after it by default', async () => {
    const r = await admin.post(o('/client-folders'), { client_id: acme });
    expect(r.status).toBe(201);
    folderId = r.body.id;
    expect(r.body).toMatchObject({ client_id: acme, client_name: 'Acme', name: 'Acme', project_count: 2, active_project_count: 2, archived_at: null });
  });

  it('allows one folder per client', async () => {
    const r = await admin.post(o('/client-folders'), { client_id: acme, name: 'Again' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('folder_exists');
  });

  it('rejects an unknown or archived client', async () => {
    expect((await admin.post(o('/client-folders'), { client_id: '00000000-0000-7000-8000-000000000001' })).status).toBe(404);
    const old = (await admin.post(o('/clients'), { name: 'Old Co' })).body.id;
    await admin.post(o(`/clients/${old}/archive`));
    expect((await admin.post(o('/client-folders'), { client_id: old })).status).toBe(400);
  });

  it('validates the name', async () => {
    expect((await admin.patch(o(`/client-folders/${folderId}`), { name: '   ' })).status).toBe(400);
  });

  it('renames a folder without renaming the client', async () => {
    const r = await admin.patch(o(`/client-folders/${folderId}`), { name: 'Acme — retainers', description: 'Monthly work' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Acme — retainers', description: 'Monthly work', client_name: 'Acme' });
    expect((await admin.get(o('/clients'))).body.find((c: { id: string }) => c.id === acme).name).toBe('Acme');
  });

  it('lists the client’s projects in the folder, with details for the accordion', async () => {
    await admin.post(o(`/projects/${site}/tasks`), { title: 'Design', status: 'DONE' });
    await admin.post(o(`/projects/${site}/tasks`), { title: 'Build' });
    await admin.post(o(`/projects/${site}/tasks`), { title: 'Launch' });
    await admin.post(o(`/projects/${site}/milestones`), { title: 'Beta', due_date: '2026-12-01' });
    const r = await admin.get(o(`/client-folders/${folderId}`));
    expect(r.status).toBe(200);
    expect(r.body.can_manage).toBe(true);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Mobile app', 'Website']);
    const w = r.body.projects.find((p: { id: string }) => p.id === site);
    expect(w).toMatchObject({ status: 'ACTIVE', task_count: 3, tasks_done: 1, tasks_pending: 2, progress_pct: 33, milestone_count: 1, milestones_done: 0, team_count: 0, revision_count: 1 });
    expect(w.next_milestone).toMatchObject({ title: 'Beta', due_date: '2026-12-01' });
    expect(w.members.map((m: { name: string }) => m.name)).toEqual(['Mia', 'Walt']);
    expect(r.body.projects.find((p: { id: string }) => p.id === app).progress_pct).toBeNull();
  });

  it('archives a folder without archiving the client or its projects, and restores it', async () => {
    expect((await admin.post(o(`/client-folders/${folderId}/archive`))).status).toBe(204);
    expect((await admin.get(o('/client-folders'))).body.folders).toEqual([]);
    expect((await admin.get(o('/client-folders?include_archived=true'))).body.folders[0].archived_at).not.toBeNull();
    const client = (await admin.get(o('/clients'))).body.find((c: { id: string }) => c.id === acme);
    expect(client.archived_at).toBeNull();
    expect((await admin.get(o(`/projects/${site}`))).body.archived_at).toBeNull();
    expect((await admin.post(o(`/client-folders/${folderId}/projects`), { project_ids: [loose] })).status).toBe(422);
    expect((await admin.post(o(`/client-folders/${folderId}/restore`))).status).toBe(204);
    expect((await admin.get(o('/client-folders'))).body.folders).toHaveLength(1);
  });
});

describe('putting projects in a folder', () => {
  it('refuses a project that belongs to another client, and changes nothing', async () => {
    const r = await admin.post(o(`/client-folders/${folderId}/projects`), { project_ids: [loose, globexSite] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('project_has_other_client');
    expect((await admin.get(o(`/projects/${globexSite}`))).body.client_id).toBe(globex);
    expect((await admin.get(o(`/projects/${loose}`))).body.client_id).toBeNull();
  });

  it('gives a project without a client the folder’s client', async () => {
    const r = await admin.post(o(`/client-folders/${folderId}/projects`), { project_ids: [loose, site] });
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Internal tools', 'Mobile app', 'Website']);
    expect((await admin.get(o(`/projects/${loose}`))).body.client_id).toBe(acme);
  });

  it('creates a new project inside the folder through the usual project form', async () => {
    const r = await admin.post(o('/projects'), { name: 'SEO', client_id: acme });
    expect(r.status).toBe(201);
    expect((await admin.get(o(`/client-folders/${folderId}`))).body.projects.map((p: { name: string }) => p.name)).toContain('SEO');
  });

  it('rejects an unknown project', async () => {
    expect((await admin.post(o(`/client-folders/${folderId}/projects`), { project_ids: ['00000000-0000-7000-8000-000000000002'] })).status).toBe(404);
  });
});

describe('project revision history', () => {
  it('records each change with previous and new values, who made it and why', async () => {
    await admin.patch(o(`/projects/${site}`), { name: 'Website relaunch', status: 'ON_HOLD', change_reason: 'Client paused the launch' });
    await admin.patch(o(`/projects/${site}`), { status: 'ON_HOLD' }); // no real change: still a revision row, with no changed fields
    const r = await admin.get(o(`/projects/${site}/revisions`));
    expect(r.status).toBe(200);
    // created, added to folder (no change: already Acme's), renamed, re-saved
    expect(r.body.total).toBe(3);
    const [latest, renamed, created] = r.body.data;
    expect(latest.number).toBe(3);
    expect(latest.changes).toEqual([]);
    expect(renamed).toMatchObject({ number: 2, action: 'project.updated', actor_name: 'Ada', reason: 'Client paused the launch' });
    expect(renamed.changes).toEqual([
      { field: 'name', before: 'Website', after: 'Website relaunch', before_known: true },
      { field: 'status', before: 'ACTIVE', after: 'ON_HOLD', before_known: true },
    ]);
    expect(created).toMatchObject({ number: 1, action: 'project.created' });
  });

  it('is chronological on request, and pages', async () => {
    const r = await admin.get(o(`/projects/${site}/revisions?order=asc&page_size=2`));
    expect(r.body.data.map((x: { number: number }) => x.number)).toEqual([1, 2]);
    const p2 = await admin.get(o(`/projects/${site}/revisions?order=asc&page_size=2&page=2`));
    expect(p2.body.data.map((x: { number: number }) => x.number)).toEqual([3]);
  });

  it('records the folder move as a revision of the project, with the client names', async () => {
    const r = await admin.get(o(`/projects/${loose}/revisions`));
    expect(r.body.data[0]).toMatchObject({ reason: 'Added to the folder Acme — retainers', changes: [{ field: 'client_id', before: null, after: acme, before_known: true }] });
    expect(r.body.names[acme]).toBe('Acme');
  });

  it('names members in member changes', async () => {
    await admin.patch(o(`/projects/${app}`), { member_ids: [walt.membershipId] });
    const r = await admin.get(o(`/projects/${app}/revisions`));
    expect(r.body.data[0].changes).toEqual([{ field: 'member_ids', before: [], after: [walt.membershipId], before_known: true }]);
    expect(r.body.names[walt.membershipId]).toBe('Walt');
  });

  it('includes archive and restore, and leaves out time-entry and task changes', async () => {
    await admin.post(o(`/projects/${app}/archive`));
    await admin.post(o(`/projects/${app}/restore`));
    await admin.post(o(`/projects/${app}/tasks`), { title: 'Not a project revision' });
    const s = new Date(t.clock.now.getTime() - 3 * 3600_000);
    await admin.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: app, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 3600_000).toISOString(), reason: 'x' });
    const r = await admin.get(o(`/projects/${app}/revisions`));
    expect(r.body.data.map((x: { action: string }) => x.action)).toEqual(['project.restored', 'project.archived', 'project.updated', 'project.created']);
  });
});

describe('who sees what', () => {
  it('a manager sees only the folders and projects of their assigned work, and cannot manage folders', async () => {
    const list = await mia.client.get(o('/client-folders'));
    expect(list.status).toBe(200);
    expect(list.body.folders.map((f: { name: string }) => f.name)).toEqual(['Acme — retainers']);
    expect(list.body.folders[0].project_count).toBe(1);
    const detail = await mia.client.get(o(`/client-folders/${folderId}`));
    expect(detail.body.can_manage).toBe(false);
    expect(detail.body.projects.map((p: { id: string; revision_count: number | null }) => [p.id, p.revision_count])).toEqual([[site, null]]);
    expect((await mia.client.post(o('/client-folders'), { client_id: globex })).status).toBe(403);
    expect((await mia.client.patch(o(`/client-folders/${folderId}`), { name: 'x' })).status).toBe(403);
    expect((await mia.client.post(o(`/client-folders/${folderId}/archive`))).status).toBe(403);
    expect((await mia.client.post(o(`/client-folders/${folderId}/projects`), { project_ids: [site] })).status).toBe(403);
    expect((await mia.client.get(o(`/projects/${site}/revisions`))).status).toBe(403);
    expect((await mia.client.get(o(`/projects/${app}/revisions`))).status).toBe(404);
  });

  it('a worker sees only folders of clients they work for, with only their projects', async () => {
    const g = await admin.post(o('/client-folders'), { client_id: globex });
    const list = await walt.client.get(o('/client-folders'));
    // Walt is on Website and (since the member change above) Mobile app; not on Internal tools or SEO.
    expect(list.body.folders.map((f: { name: string; project_count: number }) => [f.name, f.project_count])).toEqual([
      ['Acme — retainers', 2],
      ['Globex', 1],
    ]);
    expect((await walt.client.get(o(`/client-folders/${g.body.id}`))).body.projects.map((p: { name: string }) => p.name)).toEqual(['Globex site']);
    expect((await walt.client.post(o('/client-folders'), { client_id: acme })).status).toBe(403);
    expect((await walt.client.get(o(`/projects/${site}/revisions`))).status).toBe(403);
  });

  it('someone with no project for a client gets 404 for its folder', async () => {
    const solo = await addMember(t, admin, orgId, 'Sol', 'sol@folders.test');
    expect((await solo.client.get(o('/client-folders'))).body.folders).toEqual([]);
    expect((await solo.client.get(o(`/client-folders/${folderId}`))).status).toBe(404);
  });

  it('a client portal viewer cannot reach folders or revisions', async () => {
    await admin.put(o(`/clients/${acme}/portal`), { enabled: true });
    const inv = await admin.post(o(`/clients/${acme}/portal/invitations`), { email: 'carla@acme.test', name: 'Carla' });
    const carla = new Client(t);
    const token = new URL(inv.body.invite_url).searchParams.get('token');
    expect((await carla.post('/portal/invitations/accept', { token, name: 'Carla', password: 'correct-horse-battery' })).status).toBe(200);
    expect((await carla.get(o('/client-folders'))).status).toBe(404);
    expect((await carla.get(o(`/client-folders/${folderId}`))).status).toBe(404);
    expect((await carla.get(o(`/projects/${site}/revisions`))).status).toBe(404);
  });

  it('another organization cannot see, change or fill this organization’s folders', async () => {
    const other = await signup(t, 'Olga', 'olga@other-folders.test');
    const op = (p: string) => `/orgs/${other.orgId}${p}`;
    await other.client.patch(op(''), { settings: { clientFolders: true } });
    expect((await other.client.get(op('/client-folders'))).body.folders).toEqual([]);
    expect((await other.client.get(op(`/client-folders/${folderId}`))).status).toBe(404);
    expect((await other.client.patch(op(`/client-folders/${folderId}`), { name: 'hijack' })).status).toBe(404);
    expect((await other.client.post(op('/client-folders'), { client_id: acme })).status).toBe(404);
    expect((await other.client.get(op(`/projects/${site}/revisions`))).status).toBe(404);
    const theirProject = (await other.client.post(op('/projects'), { name: 'Theirs' })).body.id;
    expect((await admin.post(o(`/client-folders/${folderId}/projects`), { project_ids: [theirProject] })).status).toBe(404);
    // and through this org's own URL, Olga is not a member
    expect((await other.client.get(o(`/client-folders/${folderId}`))).status).toBe(404);
  });
});

describe('turning folders off', () => {
  it('hides folders but keeps them, and leaves projects as they were', async () => {
    expect((await admin.patch(o(''), { settings: { clientFolders: false } })).status).toBe(200);
    expect((await admin.get(o('/client-folders'))).body).toEqual({ enabled: false, folders: [] });
    expect((await admin.get(o(`/client-folders/${folderId}`))).status).toBe(404);
    expect((await admin.get(o('/projects'))).body.map((p: { name: string }) => p.name)).toEqual(['Globex site', 'Internal tools', 'Mobile app', 'SEO', 'Website relaunch']);
    // revision history does not depend on folders
    expect((await admin.get(o(`/projects/${site}/revisions`))).status).toBe(200);
    expect((await admin.patch(o(''), { settings: { clientFolders: true } })).status).toBe(200);
    expect((await admin.get(o('/client-folders'))).body.folders.map((f: { name: string }) => f.name)).toEqual(['Acme — retainers', 'Globex']);
  });

  it('a deleted (never used) client takes its folder with it', async () => {
    const tmp = (await admin.post(o('/clients'), { name: 'Temp' })).body.id;
    const f = await admin.post(o('/client-folders'), { client_id: tmp });
    expect((await admin.del(o(`/clients/${tmp}`))).status).toBe(204);
    expect((await admin.get(o(`/client-folders/${f.body.id}`))).status).toBe(404);
  });

  it('writes folder changes to the audit log', async () => {
    const logs = (await admin.get(o('/audit-logs?action=client_folder.'))).body as Array<{ action: string }>;
    expect(new Set(logs.map((l) => l.action))).toEqual(new Set(['client_folder.created', 'client_folder.updated', 'client_folder.archived', 'client_folder.restored']));
  });
});
