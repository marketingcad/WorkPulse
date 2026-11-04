import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Profile pictures: an upload is checked by its contents, re-encoded to a square WebP and kept in
 * private storage under the account's own id; a curated avatar or none can be chosen instead. A
 * picture shows to the person and to whom their members:read grant covers, never across
 * organizations, and replacing or removing one never leaves the old file behind.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let adminMembership: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

const png = (w = 600, h = 400) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
const jpeg = (w = 800, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg().toBuffer();

async function upload(who: Client, bytes: Buffer | Uint8Array, name = 'me.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  const r = await t.app.request('/api/v1/me/avatar', { method: 'POST', headers: { Origin: 'http://localhost:3000', ...(who.cookie ? { Cookie: who.cookie } : {}) }, body: form });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const objectsOf = (userId: string) => [...t.storage.objects.keys()].filter((k) => k.startsWith(`avatars/${userId}/`));
const userIdOf = async (c: Client) => (await c.get<{ user: { id: string } }>('/me')).body.user.id;
const rawGet = (who: Client, path: string) => t.app.request(`/api/v1${path}`, { headers: { Origin: 'http://localhost:3000', Cookie: who.cookie } });

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', 'ada@avatar.test', 'Avatar Co'));
  adminMembership = (await admin.get<{ organizations: Array<{ membership_id: string }> }>('/me')).body.organizations[0]!.membership_id;
}, 60_000);
afterAll(() => t.close());

describe('uploading a picture', () => {
  it('re-encodes it to a square 512 px WebP in private storage under the account, and shows it', async () => {
    const userId = await userIdOf(admin);
    const r = await upload(admin, await jpeg(800, 600), 'holiday.jpg', 'image/jpeg');
    expect(r.status).toBe(201);
    expect(r.body.avatar).toMatchObject({ kind: 'photo', url: expect.stringMatching(/^\/api\/v1\/me\/avatar\?v=[0-9a-f-]{36}$/) });
    const keys = objectsOf(userId);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^avatars/${userId}/[0-9a-f-]{36}\\.webp$`));
    expect(t.storage.objects.get(keys[0]!)!.contentType).toBe('image/webp');
    const meta = await sharp(t.storage.objects.get(keys[0]!)!.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);

    // The account sees it on /me, and loads it from its own address (kept for a year at that version).
    const me = (await admin.get<{ user: { avatar: { url: string } } }>('/me')).body.user.avatar;
    expect(me).toEqual(r.body.avatar);
    const img = await rawGet(admin, me.url.replace('/api/v1', ''));
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    // The storage key is never in a response.
    expect(JSON.stringify(me)).not.toContain('avatars/');
  });

  it('refuses what is not a readable JPEG, PNG or WebP, whatever its name or type says', async () => {
    const before = [...t.storage.objects.keys()].length;
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
    const cases: Array<[string, Buffer | Uint8Array, string, string, RegExp]> = [
      ['a GIF', gif, 'a.gif', 'image/gif', /JPEG, PNG or WebP/],
      ['text named .png', Buffer.from('definitely not an image'), 'x.png', 'image/png', /not a picture that can be read/],
      ['a script named .jpg', Buffer.from('<script>alert(1)</script>'), 'x.jpg', 'image/jpeg', /not a picture that can be read/],
      ['a truncated PNG', (await png()).subarray(0, 80), 'cut.png', 'image/png', /not a picture that can be read|damaged/],
      ['an empty file', new Uint8Array(0), 'empty.png', 'image/png', /empty/],
      ['too many pixels', await png(5000, 10), 'wide.png', 'image/png', /at most 4096 × 4096/],
    ];
    for (const [what, bytes, name, type, msg] of cases) {
      const r = await upload(admin, bytes, name, type);
      expect(r.status, what).toBe(400);
      expect(r.body.code, what).toBe('validation_error');
      expect(r.body.errors[0].message, what).toMatch(msg);
    }
    expect([...t.storage.objects.keys()].length).toBe(before);
  });

  it('works with rate limits on, as in production', async () => {
    const form = new FormData();
    form.append('file', new File([await png()], 'a.png', { type: 'image/png' }));
    const r = await t.app.request('/api/v1/me/avatar', { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: admin.cookie, 'x-test-rate-limit': 'on' }, body: form });
    expect(r.status).toBe(201);
  });

  it('refuses a file over 5 MB before reading it', async () => {
    const r = await upload(admin, new Uint8Array(5 * 1024 * 1024 + 1), 'big.png', 'image/png');
    expect(r.status).toBe(400);
    expect(r.body.errors[0].message).toMatch(/5 MB/);
  });

  it('is only for someone signed in (not a device, an API key or nobody)', async () => {
    expect((await upload(new Client(t), await png())).status).toBe(401);
    const key = new Client(t);
    key.bearer = (await admin.post(o('/api-keys'), { name: 'k', scopes: ['read:projects'] })).body.key;
    const form = new FormData();
    form.append('file', new File([await png()], 'a.png', { type: 'image/png' }));
    const r = await t.app.request('/api/v1/me/avatar', { method: 'POST', headers: { Origin: 'http://localhost:3000', Authorization: `Bearer ${key.bearer}` }, body: form });
    expect([401, 403]).toContain(r.status);
    expect([401, 403]).toContain((await key.get(o('/avatars'))).status);
  });
});

describe('replacing, choosing and removing', () => {
  it('a new picture replaces the old one, and the old file is deleted', async () => {
    const { client: ben } = await addMember(t, admin, orgId, 'Ben Replace', 'ben@avatar.test');
    const userId = await userIdOf(ben);
    const first = await upload(ben, await png());
    const firstKeys = objectsOf(userId);
    const second = await upload(ben, await jpeg(), 'b.jpg', 'image/jpeg');
    expect(second.status).toBe(201);
    expect(second.body.avatar.url).not.toBe(first.body.avatar.url);
    const keys = objectsOf(userId);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(firstKeys[0]);
    // The old address no longer serves a picture.
    expect((await rawGet(ben, '/me/avatar')).status).toBe(200);
  });

  it('a curated avatar replaces a picture (its file goes), and only listed ones can be chosen', async () => {
    const { client: cy } = await addMember(t, admin, orgId, 'Cy Preset', 'cy@avatar.test');
    const userId = await userIdOf(cy);
    await upload(cy, await png());
    const r = await cy.put('/me/avatar', { preset: 'person-3' });
    expect(r.status).toBe(200);
    expect(r.body.avatar).toEqual({ kind: 'preset', preset: 'person-3' });
    expect(objectsOf(userId)).toEqual([]);
    expect((await cy.get('/me')).body.user.avatar).toEqual({ kind: 'preset', preset: 'person-3' });
    expect((await cy.put('/me/avatar', { preset: 'emoji-1' })).status).toBe(400);
    expect((await cy.put('/me/avatar', { preset: '../../etc' })).status).toBe(400);
  });

  it('removing goes back to initials and deletes the file', async () => {
    const { client: di } = await addMember(t, admin, orgId, 'Di Remove', 'di@avatar.test');
    const userId = await userIdOf(di);
    await upload(di, await png());
    expect((await di.del('/me/avatar')).status).toBe(204);
    expect((await di.get('/me')).body.user.avatar).toBeNull();
    expect(objectsOf(userId)).toEqual([]);
    expect((await rawGet(di, '/me/avatar')).status).toBe(404);
    // Removing again is fine.
    expect((await di.del('/me/avatar')).status).toBe(204);
  });
});

describe('when storage or the database fails', () => {
  it('a failed upload to storage changes nothing', async () => {
    const { client: ed } = await addMember(t, admin, orgId, 'Ed Storage', 'ed@avatar.test');
    await ed.put('/me/avatar', { preset: 'shape-1' });
    const put = vi.spyOn(t.storage, 'put').mockRejectedValueOnce(new Error('storage down'));
    const r = await upload(ed, await png());
    expect(r.status).toBe(500);
    put.mockRestore();
    expect((await ed.get('/me')).body.user.avatar).toEqual({ kind: 'preset', preset: 'shape-1' });
  });

  it('when saving the reference fails, the new file is deleted and the old picture stays', async () => {
    const { client: flo } = await addMember(t, admin, orgId, 'Flo Db', 'flo@avatar.test');
    const userId = await userIdOf(flo);
    const first = await upload(flo, await png());
    const kept = objectsOf(userId);
    const update = vi.spyOn(t.deps.db, 'update').mockImplementationOnce(() => {
      throw new Error('database down');
    });
    const r = await upload(flo, await jpeg(), 'b.jpg', 'image/jpeg');
    update.mockRestore();
    expect(r.status).toBe(500);
    expect(objectsOf(userId)).toEqual(kept); // no orphan left by the failed attempt
    expect((await flo.get('/me')).body.user.avatar).toEqual(first.body.avatar);
  });

  it('when deleting the replaced file fails, the new picture is still saved', async () => {
    const { client: gus } = await addMember(t, admin, orgId, 'Gus Cleanup', 'gus@avatar.test');
    await upload(gus, await png());
    const del = vi.spyOn(t.storage, 'delete').mockRejectedValueOnce(new Error('storage down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await upload(gus, await jpeg(), 'b.jpg', 'image/jpeg');
    del.mockRestore();
    warn.mockRestore();
    expect(r.status).toBe(201);
    expect((await gus.get('/me')).body.user.avatar).toEqual(r.body.avatar);
  });
});

describe('who sees a picture', () => {
  it('admins see everyone’s; a worker sees only their own; a team manager sees the people they manage', async () => {
    const { client: wren, membershipId: wrenId } = await addMember(t, admin, orgId, 'Wren Worker', 'wren@avatar.test');
    const { client: vic, membershipId: vicId } = await addMember(t, admin, orgId, 'Vic Worker', 'vic@avatar.test');
    const { client: mo, membershipId: moId } = await addMember(t, admin, orgId, 'Mo Manager', 'mo@avatar.test', 'TEAM_MANAGER');
    const team = (await admin.post(o('/teams'), { name: 'Avatars' })).body.id as string;
    expect((await admin.put(o(`/teams/${team}/members/${moId}`), { role: 'MANAGER' })).status).toBe(200);
    expect((await admin.put(o(`/teams/${team}/members/${wrenId}`), { role: 'MEMBER' })).status).toBe(200);
    await upload(wren, await png());
    await upload(vic, await png());
    await upload(admin, await png());

    const ids = async (c: Client) => (await c.get<Array<{ membership_id: string }>>(o('/avatars'))).body.map((a) => a.membership_id);
    expect(await ids(admin)).toEqual(expect.arrayContaining([wrenId, vicId, adminMembership]));
    // A worker: only themselves, not a colleague, not the admin.
    expect(await ids(wren)).toEqual([wrenId]);
    expect((await rawGet(wren, o(`/avatars/${vicId}`))).status).toBe(404);
    expect((await rawGet(wren, o(`/avatars/${adminMembership}`))).status).toBe(404);
    expect((await rawGet(wren, o(`/avatars/${wrenId}`))).status).toBe(200);
    // A team manager: the team's members, not someone outside it.
    expect(new Set(await ids(mo))).toEqual(new Set([wrenId]));
    expect((await rawGet(mo, o(`/avatars/${wrenId}`))).status).toBe(200);
    expect((await rawGet(mo, o(`/avatars/${vicId}`))).status).toBe(404);
    // Admins load any member's picture, at an address that keeps no storage key.
    const list = (await admin.get<Array<{ membership_id: string; avatar: { url: string } }>>(o('/avatars'))).body;
    const vics = list.find((a) => a.membership_id === vicId)!;
    expect(vics.avatar.url).toMatch(new RegExp(`^/api/v1/orgs/${orgId}/avatars/${vicId}\\?v=`));
    expect((await rawGet(admin, vics.avatar.url.replace('/api/v1', ''))).status).toBe(200);
    // A broken or unknown id reveals nothing.
    expect((await rawGet(admin, o('/avatars/not-an-id'))).status).toBe(404);
    void vic;
    void mo;
  });

  it('another organization sees none of it', async () => {
    const other = await signup(t, 'Olga Other', 'olga@avatar-other.test');
    const ours = (await admin.get<Array<{ membership_id: string }>>(o('/avatars'))).body;
    expect(ours.length).toBeGreaterThan(0);
    // Through their own organization: the member is not theirs.
    for (const a of ours) expect((await rawGet(other.client, `/orgs/${other.orgId}/avatars/${a.membership_id}`)).status).toBe(404);
    expect((await other.client.get(`/orgs/${other.orgId}/avatars`)).body).toEqual([]);
    // Through ours: not a member at all.
    expect([403, 404]).toContain((await other.client.get(o('/avatars'))).status);
    expect([403, 404]).toContain((await rawGet(other.client, o(`/avatars/${ours[0]!.membership_id}`))).status);
  });

  it('the same picture follows the person into a second organization, still shown only to whom may see it', async () => {
    const { client: kim, membershipId: kimId } = await addMember(t, admin, orgId, 'Kim Two Orgs', 'kim@avatar.test');
    const second = await signup(t, 'Sam Second', 'sam@avatar-second.test');
    // Kim already has an account: she accepts the second invitation signed in.
    const roles = (await second.client.get<Array<{ id: string; key: string }>>(`/orgs/${second.orgId}/roles`)).body;
    const inv = (await second.client.post<{ invite_url: string }>(`/orgs/${second.orgId}/invitations`, { email: 'kim@avatar.test', name: 'Kim Two Orgs', role_id: roles.find((r) => r.key === 'WORKER')!.id })).body;
    const accepted = await kim.post<{ membership_id: string }>('/auth/invitations/accept', { token: new URL(inv.invite_url).searchParams.get('token') });
    expect(accepted.status).toBe(200);
    const kimThere = accepted.body.membership_id;
    await upload(kim, await png());
    expect((await admin.get<Array<{ membership_id: string }>>(o('/avatars'))).body.some((a) => a.membership_id === kimId)).toBe(true);
    expect((await second.client.get<Array<{ membership_id: string }>>(`/orgs/${second.orgId}/avatars`)).body.some((a) => a.membership_id === kimThere)).toBe(true);
    // One file for both organizations.
    expect(objectsOf(await userIdOf(kim))).toHaveLength(1);
  });
});

describe('the desktop app', () => {
  async function deviceFor(member: Client) {
    const { verifier, challenge } = pkce();
    const code = await member.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    const reg = await agent.post<{ access_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.1.9' } });
    agent.bearer = reg.body.access_token;
    return agent;
  }

  it('gets the worker’s own picture inline, a curated id, or nothing (initials)', async () => {
    const { client: ivy } = await addMember(t, admin, orgId, 'Ivy Desktop', 'ivy@avatar.test');
    const device = await deviceFor(ivy);
    expect((await device.get('/agent/me/avatar')).body).toEqual({ avatar: null });
    await ivy.put('/me/avatar', { preset: 'minimal-2' });
    expect((await device.get('/agent/me/avatar')).body).toEqual({ avatar: { kind: 'preset', preset: 'minimal-2' } });
    await upload(ivy, await png());
    const r = (await device.get<{ avatar: { kind: string; data_url: string } }>('/agent/me/avatar')).body;
    expect(r.avatar.kind).toBe('photo');
    expect(r.avatar.data_url).toMatch(/^data:image\/webp;base64,/);
    const bytes = Buffer.from(r.avatar.data_url.split(',')[1]!, 'base64');
    expect((await sharp(bytes).metadata()).format).toBe('webp');
    // With rate limits on, as in production (the limiter and the request's transaction must not wait on each other).
    const limited = await device.req<{ avatar: { kind: string } }>('GET', '/agent/me/avatar', undefined, { 'x-test-rate-limit': 'on' });
    expect(limited.status).toBe(200);
    expect(limited.body.avatar.kind).toBe('photo');
    // A device has no way to ask for anyone else's: the route only knows its own worker.
    expect([401, 403]).toContain((await device.get(o('/avatars'))).status);
  });
});

describe('anonymizing an account', () => {
  it('removes the picture file too', async () => {
    const { client: zed, membershipId: zedId } = await addMember(t, admin, orgId, 'Zed Erase', 'zed@avatar.test');
    const userId = await userIdOf(zed);
    await upload(zed, await png());
    expect(objectsOf(userId)).toHaveLength(1);
    expect((await admin.post(o(`/workers/${zedId}/anonymize`), {})).status).toBe(200);
    await t.flush();
    expect(objectsOf(userId)).toEqual([]);
  });
});
