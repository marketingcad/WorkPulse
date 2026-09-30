import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

const NOW = new Date('2026-09-23T20:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let bea: Client;
let euroClient: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function upload(c: Client, path: string, name: string, type: string, content: string) {
  const form = new FormData();
  form.set('file', new File([content], name, { type }));
  const res = await t.app.request(`/api/v1${path}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: c.cookie }, body: form });
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@projects.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@projects.test'));
  ({ client: bea } = await addMember(t, admin, orgId, 'Bea', 'bea@projects.test'));
  euroClient = (await admin.post(o('/clients'), { name: 'Euro GmbH', currency: 'EUR' })).body.id;
});
afterAll(() => t.close());

describe('project details', () => {
  it('stores short name, dates, estimate and project rates in the client currency', async () => {
    const r = await admin.post(o('/projects'), {
      name: 'Website',
      client_id: euroClient,
      member_ids: [waltId],
      short_name: 'WEB',
      start_date: '2026-09-01',
      end_date: '2026-12-31',
      estimate_seconds: 10 * 8 * 3600,
      estimate_unit: 'DAYS',
      pay_rate_minor: 3000,
      bill_rate_minor: 9000,
    });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    expect(r.body).toMatchObject({ short_name: 'WEB', start_date: '2026-09-01', end_date: '2026-12-31', estimate_seconds: 288000, estimate_unit: 'DAYS', currency: 'EUR', pay_rate_minor: 3000, bill_rate_minor: 9000 });
    const rates = ((await admin.get(o('/rates'))).body as Array<{ scope: string; scope_id: string; currency: string }>).filter((x) => x.scope === 'PROJECT' && x.scope_id === projectId);
    expect(rates.map((x) => x.currency)).toEqual(['EUR', 'EUR']);
  });

  it('keeps unrelated fields when patching', async () => {
    const r = await admin.patch(o(`/projects/${projectId}`), { description: 'Relaunch' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ short_name: 'WEB', estimate_unit: 'DAYS', description: 'Relaunch', bill_rate_minor: 9000 });
  });

  it('rejects an end date before the start date', async () => {
    expect((await admin.patch(o(`/projects/${projectId}`), { start_date: '2026-10-01', end_date: '2026-09-01' })).status).toBe(400);
  });

  it('reports billable and total time', async () => {
    const s = new Date('2026-09-22T13:00:00Z');
    await admin.post(o('/manual-time'), { membership_id: waltId, project_id: projectId, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 3600_000).toISOString(), reason: 'x' });
    await admin.post(o('/manual-time'), { membership_id: waltId, project_id: projectId, started_at: new Date(s.getTime() + 2 * 3600_000).toISOString(), ended_at: new Date(s.getTime() + 3 * 3600_000).toISOString(), reason: 'x', billable: false });
    await t.flush();
    expect((await admin.get(o(`/projects/${projectId}`))).body).toMatchObject({ tracked_seconds: 7200, billable_seconds: 3600 });
  });

  it('does not let members set project rates', async () => {
    expect((await walt.patch(o(`/projects/${projectId}`), { bill_rate_minor: 1 })).status).toBe(403);
  });
});

describe('project documents', () => {
  let docId: string;

  it('uploads a document and lists it with the uploader', async () => {
    const r = await upload(admin, o(`/projects/${projectId}/documents`), '../Brief "v2".pdf', 'application/pdf', '%PDF-1.4 test');
    expect(r.status).toBe(201);
    docId = r.body.id;
    expect(r.body).toMatchObject({ name: 'Brief v2.pdf', content_type: 'application/pdf', uploaded_by_name: 'Ada' });
    expect((await admin.get(o(`/projects/${projectId}/documents`))).body).toHaveLength(1);
  });

  it('refuses types that could run in the browser', async () => {
    expect((await upload(admin, o(`/projects/${projectId}/documents`), 'x.html', 'text/html', '<script>alert(1)</script>')).body.code).toBe('file_type');
    expect((await upload(admin, o(`/projects/${projectId}/documents`), 'x.svg', 'image/svg+xml', '<svg/>')).body.code).toBe('file_type');
  });

  it('serves the file to project members with safe headers', async () => {
    const res = await t.app.request(`/api/v1${o(`/projects/${projectId}/documents/${docId}`)}`, { headers: { Cookie: walt.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(await res.text()).toBe('%PDF-1.4 test');
    const dl = await t.app.request(`/api/v1${o(`/projects/${projectId}/documents/${docId}?download=1`)}`, { headers: { Cookie: walt.cookie } });
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it('hides documents from people outside the project and blocks uploads by members', async () => {
    expect((await bea.get(o(`/projects/${projectId}/documents`))).status).toBe(404);
    expect((await upload(walt, o(`/projects/${projectId}/documents`), 'a.txt', 'text/plain', 'hi')).status).toBe(403);
  });

  it('deletes a document and its stored file', async () => {
    const before = t.storage.objects.size;
    expect((await admin.del(o(`/projects/${projectId}/documents/${docId}`))).status).toBe(204);
    expect(t.storage.objects.size).toBe(before - 1);
    expect((await admin.get(o(`/projects/${projectId}/documents`))).body).toHaveLength(0);
  });
});
