import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';
import { parseRange, TUTORIAL_PREFIX } from '../src/services/help-tutorial';

let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let worker: Client;
let otherAdmin: Client;
let otherOrgId: string;
const o = (p: string, org = orgId) => `/orgs/${org}${p}`;

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const MANIFEST = {
  title: 'WorkPulse Complete Tutorial',
  chapters: [
    { n: 1, title: 'Welcome to WorkPulse', seconds: 104, video: 'ch01-a1b2c3.mp4', captions: 'ch01-a1b2c3.vtt', poster: 'ch01-a1b2c3.jpg' },
    { n: 2, title: 'Getting started', seconds: 156.5, video: 'ch02-d4e5f6.mp4', captions: null, poster: null },
  ],
};

async function publish(manifest: unknown = MANIFEST) {
  await t.storage.put(`${TUTORIAL_PREFIX}/manifest.json`, Buffer.from(JSON.stringify(manifest)), 'application/json');
  await t.storage.put(`${TUTORIAL_PREFIX}/ch01-a1b2c3.mp4`, VIDEO, 'video/mp4');
  await t.storage.put(`${TUTORIAL_PREFIX}/ch01-a1b2c3.vtt`, Buffer.from('WEBVTT\n'), 'text/vtt');
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@tutorial.test'));
  ({ client: manager } = await addMember(t, admin, orgId, 'Max', 'max@tutorial.test', 'TEAM_MANAGER'));
  ({ client: worker } = await addMember(t, admin, orgId, 'Walt', 'walt@tutorial.test'));
  ({ client: otherAdmin, orgId: otherOrgId } = await signup(t, 'Oto', 'oto@other.test'));
});
afterAll(() => t.close());
beforeEach(() => t.storage.objects.clear());

describe('Help Center video tutorial', () => {
  it('is null for an admin until a tutorial is published', async () => {
    const r = await admin.get(o('/help/tutorial'));
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  it('lists the published chapters for a system admin', async () => {
    await publish();
    const r = await admin.get(o('/help/tutorial'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual(MANIFEST);
  });

  it('streams a chapter video whole, and the requested bytes for a Range request', async () => {
    await publish();
    const whole = await t.app.request(`/api/v1${o('/help/tutorial/files/ch01-a1b2c3.mp4')}`, { headers: { Cookie: admin.cookie } });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(whole.headers.get('content-length')).toBe('1000');
    expect(whole.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(VIDEO);

    const part = await t.app.request(`/api/v1${o('/help/tutorial/files/ch01-a1b2c3.mp4')}`, { headers: { Cookie: admin.cookie, Range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(part.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await part.arrayBuffer())).toEqual(VIDEO.subarray(100, 200));

    const tail = await t.app.request(`/api/v1${o('/help/tutorial/files/ch01-a1b2c3.mp4')}`, { headers: { Cookie: admin.cookie, Range: 'bytes=990-' } });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000');
  });

  it('serves captions as WebVTT', async () => {
    await publish();
    const r = await admin.get(o('/help/tutorial/files/ch01-a1b2c3.vtt'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(r.body).toBe('WEBVTT\n');
  });

  it('serves only tutorial file names, never other storage keys', async () => {
    await publish();
    await t.storage.put(`org/${orgId}/receipts/r.jpg`, Buffer.from('secret'), 'image/jpeg');
    for (const name of ['manifest.json', '..%2F..%2Forg%2F' + orgId + '%2Freceipts%2Fr.jpg', 'ch01.exe', '.mp4', 'CH01.MP4']) {
      expect((await admin.get(o(`/help/tutorial/files/${name}`))).status, name).toBe(404);
    }
    expect((await admin.get(o('/help/tutorial/files/ch99-missing.mp4'))).status).toBe(404);
  });

  it('is closed to team managers and workers', async () => {
    await publish();
    for (const c of [manager, worker]) {
      expect((await c.get(o('/help/tutorial'))).status).toBe(403);
      expect((await c.get(o('/help/tutorial/files/ch01-a1b2c3.mp4'))).status).toBe(403);
    }
  });

  it('is closed to an admin of another organization through this one, and open through their own', async () => {
    await publish();
    expect([403, 404]).toContain((await otherAdmin.get(o('/help/tutorial'))).status);
    expect([403, 404]).toContain((await otherAdmin.get(o('/help/tutorial/files/ch01-a1b2c3.mp4'))).status);
    expect((await otherAdmin.get(o('/help/tutorial', otherOrgId))).body).toEqual(MANIFEST);
  });

  it('opens to a custom role only when it may change the organization', async () => {
    await publish();
    const viewerRole = (await admin.post(o('/roles'), { name: 'Viewer', grants: { 'budgets:read': 'org', 'members:read': 'org' } })).body;
    const settingsRole = (await admin.post(o('/roles'), { name: 'Org settings', grants: { 'org:update': 'org', 'members:read': 'org' } })).body;
    const invite = async (email: string, role_id: string) => {
      const inv = await admin.post(o('/invitations'), { email, name: email, role_id });
      const c = new Client(t);
      await c.post('/auth/invitations/accept', { token: new URL(inv.body.invite_url).searchParams.get('token'), name: email, password: 'correct-horse-battery' });
      return c;
    };
    expect((await (await invite('vi@tutorial.test', viewerRole.id)).get(o('/help/tutorial'))).status).toBe(403);
    expect((await (await invite('se@tutorial.test', settingsRole.id)).get(o('/help/tutorial'))).status).toBe(200);
  });

  it('treats an unreadable manifest as not published', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await publish({ title: 'x', chapters: [{ n: 1, title: 'Bad', seconds: 1, video: '../../org/x.mp4', captions: null, poster: null }] });
      expect((await admin.get(o('/help/tutorial'))).body).toBeNull();
      await t.storage.put(`${TUTORIAL_PREFIX}/manifest.json`, Buffer.from('not json'), 'application/json');
      expect((await admin.get(o('/help/tutorial'))).body).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('parseRange', () => {
  it('reads single byte ranges and ignores the rest', () => {
    expect(parseRange('bytes=0-')).toEqual({ start: 0, end: undefined });
    expect(parseRange('bytes=5-9')).toEqual({ start: 5, end: 9 });
    expect(parseRange(undefined)).toBeUndefined();
    expect(parseRange('bytes=-500')).toBeUndefined();
    expect(parseRange('bytes=0-1,5-9')).toBeUndefined();
    expect(parseRange('bytes=9-5')).toBeUndefined();
    expect(parseRange('items=0-5')).toBeUndefined();
  });
});
