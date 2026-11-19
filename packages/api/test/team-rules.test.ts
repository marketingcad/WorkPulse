import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Teams (QA pass, feature 4).
 *
 * - BUG-38: an archived team could still be changed. Adding someone to it gave them its projects again
 *   (the project links were kept), and renaming it answered with no body.
 * - BUG-39: archiving a team that is missing or already archived answered 204 and wrote an audit row.
 * - BUG-40: someone who had left the organization could be put back on a team.
 * - BUG-41: accepting an invitation added the person to a team archived since it was sent.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let walt: { client: Client; membershipId: string };
let otto: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;

const visibleProjects = async (c: Client) => ((await c.get<Array<{ id: string }>>(o('/projects'))).body ?? []).map((p) => p.id);
type AuditRow = { action: string; target_id: string; before: unknown };
const auditFor = async (id: string) => {
  const b = (await admin.get<{ data: AuditRow[] } | AuditRow[]>(o(`/audit-logs?page=1&page_size=100`))).body;
  return (Array.isArray(b) ? b : b.data).filter((r) => r.target_id === id);
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@team-rules.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@team-rules.test');
  otto = await addMember(t, admin, orgId, 'Otto', 'otto@team-rules.test');
}, 60_000);
afterAll(() => t.close());

async function teamOnProject(name: string) {
  const team = (await admin.post<{ id: string }>(o('/teams'), { name })).body.id;
  const project = (await admin.post<{ id: string }>(o('/projects'), { name: `${name} project`, team_ids: [team] })).body.id;
  return { team, project };
}

describe('an archived team', () => {
  it('can’t be given members again, so nobody regains its projects (BUG-38)', async () => {
    const { team, project } = await teamOnProject('Night shift');
    expect((await admin.put(o(`/teams/${team}/members/${walt.membershipId}`), { role: 'MEMBER' })).status).toBe(200);
    expect(await visibleProjects(walt.client)).toContain(project);

    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    expect(await visibleProjects(walt.client)).not.toContain(project);

    expect((await admin.put(o(`/teams/${team}/members/${walt.membershipId}`), { role: 'MEMBER' })).status).toBe(404);
    expect(await visibleProjects(walt.client)).not.toContain(project);
  });

  it('is no longer listed on its projects', async () => {
    const { team, project } = await teamOnProject('Weekend crew');
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    const p = (await admin.get<{ team_ids: string[] }>(o(`/projects/${project}`))).body;
    expect(p.team_ids ?? []).not.toContain(team);
    // Saving the project as it is works (the archived team made it fail with "Unknown or archived team").
    expect((await admin.patch(o(`/projects/${project}`), { team_ids: p.team_ids ?? [] })).status).toBe(200);
  });

  it('can’t be renamed', async () => {
    const { team } = await teamOnProject('Old name');
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    expect((await admin.patch(o(`/teams/${team}`), { name: 'New name' })).status).toBe(404);
  });

  it('is archived once: again, or a team that does not exist, is 404 with no audit row (BUG-39)', async () => {
    const { team } = await teamOnProject('Twice');
    expect((await admin.put(o(`/teams/${team}/members/${otto.membershipId}`), { role: 'MANAGER' })).status).toBe(200);
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(404);
    const ghost = '01900000-0000-7000-8000-000000000041';
    expect((await admin.del(o(`/teams/${ghost}`))).status).toBe(404);
    expect(await auditFor(ghost)).toHaveLength(0);
    // The one archive is recorded with who was on the team.
    const archived = (await auditFor(team)).filter((r) => r.action === 'team.archived');
    expect(archived).toHaveLength(1);
    expect(JSON.stringify(archived[0]!.before)).toContain(otto.membershipId);
  });
});

describe('who can be on a team', () => {
  it('not someone who has left the organization (BUG-40)', async () => {
    const leaver = await addMember(t, admin, orgId, 'Lee', 'lee@team-rules.test');
    const team = (await admin.post<{ id: string }>(o('/teams'), { name: 'Leavers' })).body.id;
    expect((await admin.del(o(`/workers/${leaver.membershipId}`))).status).toBeLessThan(300);
    const r = await admin.put(o(`/teams/${team}/members/${leaver.membershipId}`), { role: 'MEMBER' });
    expect(r.status).toBe(422);
  });
});

describe('an invitation to a team archived since (BUG-41)', () => {
  it('adds the person to the organization, not to the archived team', async () => {
    const team = (await admin.post<{ id: string }>(o('/teams'), { name: 'Gone soon' })).body.id;
    const roles = (await admin.get<Array<{ id: string; key: string }>>(o('/roles'))).body;
    const inv = await admin.post<{ invite_url: string }>(o('/invitations'), { email: 'nia@team-rules.test', name: 'Nia', role_id: roles.find((r) => r.key === 'WORKER')!.id, team_ids: [team] });
    expect(inv.status).toBe(201);
    expect((await admin.del(o(`/teams/${team}`))).status).toBe(204);
    const token = new URL(inv.body.invite_url).searchParams.get('token');
    const accepted = await new Client(t).post<{ membership_id: string }>('/auth/invitations/accept', { token, name: 'Nia', password: 'correct-horse-battery' });
    expect(accepted.status).toBeLessThan(300);
    // Still archived and still empty: the archived team gained nobody.
    expect((await admin.put(o(`/teams/${team}/members/${accepted.body.membership_id}`), { role: 'MEMBER' })).status).toBe(404);
    const memberships = (await admin.get<Array<{ id: string; members: Array<{ membership_id: string }> }>>(o('/teams'))).body;
    expect(memberships.find((x) => x.id === team)).toBeUndefined();
  });
});
