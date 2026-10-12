import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Invitations that place the person on teams (with a team role) and projects. Accepting applies
 * them to new and returning members alike, so a Team manager is useful from their first sign-in.
 */
const PASSWORD = 'correct-horse-battery';

let t: Harness;
let admin: Client;
let orgId: string;
let roles: Record<string, string>;
let waltId: string;
let beaId: string;
let teamId: string;
let siteId: string;
let appId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

async function accept(url: string, name: string): Promise<{ client: Client; membershipId: string }> {
  const client = new Client(t);
  const r = await client.post('/auth/invitations/accept', { token: tokenOf(url), name, password: PASSWORD });
  expect(r.status).toBe(200);
  return { client, membershipId: r.body.membership_id };
}

const teamMembers = async () => (await admin.get(o('/teams'))).body.find((x: { id: string }) => x.id === teamId).members as Array<{ membership_id: string; role: string }>;
const projectIdsOf = async (c: Client) => (await c.get(o('/me/assignments'))).body.map((a: { project_id: string }) => a.project_id).sort();

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@invite.test'));
  roles = Object.fromEntries((await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body.map((r) => [r.key, r.id]));
  ({ membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@invite.test'));
  ({ membershipId: beaId } = await addMember(t, admin, orgId, 'Bea', 'bea@invite.test'));
  teamId = (await admin.post(o('/teams'), { name: 'Design' })).body.id;
  expect((await admin.put(o(`/teams/${teamId}/members/${waltId}`), { role: 'MEMBER' })).status).toBeLessThan(300);
  siteId = (await admin.post(o('/projects'), { name: 'Website', member_ids: [] })).body.id;
  appId = (await admin.post(o('/projects'), { name: 'Mobile App', member_ids: [] })).body.id;
});
afterAll(() => t.close());

describe('inviting onto teams and projects', () => {
  it('makes an invited Team manager the manager of their team, with its people in scope', async () => {
    const inv = await admin.post(o('/invitations'), { email: 'mia@invite.test', name: 'Mia', role_id: roles.TEAM_MANAGER, team_ids: [teamId], team_role: 'MANAGER', project_ids: [siteId, appId, siteId] });
    expect(inv.status).toBe(201);
    const { client: mia, membershipId: miaId } = await accept(inv.body.invite_url, 'Mia');

    expect(await teamMembers()).toContainEqual(expect.objectContaining({ membership_id: miaId, role: 'MANAGER' }));
    expect(await projectIdsOf(mia)).toEqual([siteId, appId].sort());
    // Team scope now covers Walt (on her team) but not Bea.
    const seen = (await mia.get(o('/workers'))).body.map((w: { id: string }) => w.id);
    expect(seen).toContain(waltId);
    expect(seen).not.toContain(beaId);
  });

  it('adds an invited Worker as a plain team member by default', async () => {
    const inv = await admin.post(o('/invitations'), { email: 'wes@invite.test', role_id: roles.WORKER, team_ids: [teamId], project_ids: [appId] });
    const { client: wes, membershipId: wesId } = await accept(inv.body.invite_url, 'Wes');
    expect(await teamMembers()).toContainEqual(expect.objectContaining({ membership_id: wesId, role: 'MEMBER' }));
    expect(await projectIdsOf(wes)).toEqual([appId]);
  });

  it('records the team role in the audit log only when teams were chosen', async () => {
    await admin.post(o('/invitations'), { email: 'nora@invite.test', role_id: roles.WORKER, team_role: 'MANAGER' });
    const logs = (await admin.get(o('/audit-logs?action=invitation.created'))).body;
    const rows: Array<{ after: { email: string; team_role?: string; teams: number; projects: number } }> = Array.isArray(logs) ? logs : logs.data;
    expect(rows.find((r) => r.after.email === 'mia@invite.test')!.after).toMatchObject({ teams: 1, team_role: 'MANAGER', projects: 2 });
    expect(rows.find((r) => r.after.email === 'nora@invite.test')!.after).toMatchObject({ teams: 0, projects: 0 });
    expect(rows.find((r) => r.after.email === 'nora@invite.test')!.after.team_role).toBeUndefined();
  });
});

describe('what an invitation may point at', () => {
  it('refuses teams and projects from another workspace', async () => {
    const { client: other, orgId: otherOrg } = await signup(t, 'Oz', 'oz@invite.test');
    const foreignTeam = (await other.post(`/orgs/${otherOrg}/teams`, { name: 'Elsewhere' })).body.id;
    const foreignProject = (await other.post(`/orgs/${otherOrg}/projects`, { name: 'Elsewhere', member_ids: [] })).body.id;
    const team = await admin.post(o('/invitations'), { email: 'x1@invite.test', role_id: roles.WORKER, team_ids: [teamId, foreignTeam] });
    expect(team.status).toBe(400);
    expect(team.body.errors).toContainEqual(expect.objectContaining({ field: 'team_ids' }));
    const project = await admin.post(o('/invitations'), { email: 'x2@invite.test', role_id: roles.WORKER, project_ids: [foreignProject] });
    expect(project.status).toBe(400);
    expect(project.body.errors).toContainEqual(expect.objectContaining({ field: 'project_ids' }));
  });

  it('refuses archived projects and unknown team roles', async () => {
    const old = (await admin.post(o('/projects'), { name: 'Old site', member_ids: [] })).body.id;
    expect((await admin.post(o(`/projects/${old}/archive`), {})).status).toBeLessThan(300);
    const r = await admin.post(o('/invitations'), { email: 'x3@invite.test', role_id: roles.WORKER, project_ids: [old] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toContainEqual(expect.objectContaining({ field: 'project_ids' }));
    expect((await admin.post(o('/invitations'), { email: 'x4@invite.test', role_id: roles.WORKER, team_ids: [teamId], team_role: 'OWNER' })).status).toBe(400);
  });

  it('is only for people who manage members', async () => {
    const walt = new Client(t);
    await walt.post('/auth/login', { email: 'walt@invite.test', password: PASSWORD });
    expect((await walt.post(o('/invitations'), { email: 'x5@invite.test', role_id: roles.WORKER, team_ids: [teamId], team_role: 'MANAGER' })).status).toBe(403);
  });
});

describe('re-inviting', () => {
  it('replaces a pending invitation, so only the newest link works', async () => {
    const first = await admin.post(o('/invitations'), { email: 'rae@invite.test', role_id: roles.WORKER, project_ids: [siteId] });
    const second = await admin.post(o('/invitations'), { email: 'rae@invite.test', role_id: roles.WORKER, project_ids: [appId] });
    expect((await new Client(t).post('/auth/invitations/accept', { token: tokenOf(first.body.invite_url), name: 'Rae', password: PASSWORD })).status).toBe(422);
    const { client: rae } = await accept(second.body.invite_url, 'Rae');
    expect(await projectIdsOf(rae)).toEqual([appId]);
  });

  it('promotes a returning member to the invited team role and adds projects without duplicates', async () => {
    const roleBefore = (await teamMembers()).find((m) => m.membership_id === waltId)!.role;
    expect(roleBefore).toBe('MEMBER');
    expect((await admin.patch(o(`/workers/${waltId}`), { status: 'SUSPENDED' })).status).toBe(200);
    const inv = await admin.post(o('/invitations'), { email: 'walt@invite.test', role_id: roles.TEAM_MANAGER, team_ids: [teamId], team_role: 'MANAGER', project_ids: [siteId] });
    expect(inv.status).toBe(201);
    // Walt already has an account, so he accepts while signed in.
    const walt = new Client(t);
    await walt.post('/auth/login', { email: 'walt@invite.test', password: PASSWORD });
    const r = await walt.post('/auth/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(r.status).toBe(200);
    expect(r.body.membership_id).toBe(waltId);

    const mine = (await teamMembers()).filter((m) => m.membership_id === waltId);
    expect(mine).toEqual([expect.objectContaining({ role: 'MANAGER' })]);
    expect(await projectIdsOf(walt)).toEqual([siteId]);
    const w = (await admin.get(o(`/workers/${waltId}`))).body;
    expect(w).toMatchObject({ status: 'ACTIVE', role_key: 'TEAM_MANAGER' });
  });

  it('refuses to invite someone who is already an active member', async () => {
    const r = await admin.post(o('/invitations'), { email: 'bea@invite.test', role_id: roles.WORKER, team_ids: [teamId] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('already_member');
  });
});
