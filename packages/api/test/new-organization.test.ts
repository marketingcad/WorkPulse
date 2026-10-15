import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// "New organization" from the organization switcher: POST /me/organizations.

let t: Harness;
let ada: Client;
let firstOrgId: string;
let walt: Client;

interface MeBody {
  organizations: Array<{ id: string; name: string; role_key: string; is_owner: boolean }>;
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: ada, orgId: firstOrgId } = await signup(t, 'Ada', 'ada@neworg.test', 'First Org'));
  ({ client: walt } = await addMember(t, ada, firstOrgId, 'Walt', 'walt@neworg.test'));
});
afterAll(() => t.close());

describe('creating another organization', () => {
  it('makes the signed-in person its owner and admin, with the chosen time zone and currency', async () => {
    const r = await ada.post<{ organization_id: string; membership_id: string }>('/me/organizations', { name: 'Second Org', timezone: 'Europe/Lisbon', currency: 'EUR' });
    expect(r.status).toBe(201);
    const id = r.body.organization_id;

    const me = await ada.get<MeBody>('/me');
    expect(me.body.organizations.map((o) => o.name).sort()).toEqual(['First Org', 'Second Org']);
    expect(me.body.organizations.find((o) => o.id === id)).toMatchObject({ role_key: 'SYSTEM_ADMIN', is_owner: true });

    const ctx = await ada.get<{ organization: { name: string; timezone: string; currency: string } }>(`/orgs/${id}`);
    expect(ctx.status).toBe(200);
    expect(ctx.body.organization).toMatchObject({ name: 'Second Org', timezone: 'Europe/Lisbon', currency: 'EUR' });
  });

  it('defaults to UTC and USD', async () => {
    const r = await ada.post<{ organization_id: string }>('/me/organizations', { name: 'Defaults Org' });
    expect(r.status).toBe(201);
    const ctx = await ada.get<{ organization: { timezone: string; currency: string } }>(`/orgs/${r.body.organization_id}`);
    expect(ctx.body.organization).toMatchObject({ timezone: 'UTC', currency: 'USD' });
  });

  it('starts empty and keeps the two organizations apart', async () => {
    expect((await ada.post(`/orgs/${firstOrgId}/clients`, { name: 'Only in the first' })).status).toBe(201);
    const id = (await ada.post<{ organization_id: string }>('/me/organizations', { name: 'Isolated Org' })).body.organization_id;

    const clients = await ada.get<unknown[]>(`/orgs/${id}/clients`);
    expect(clients.status).toBe(200);
    expect(clients.body).toEqual([]);
    const workers = await ada.get<Array<{ name: string }> | { data: Array<{ name: string }> }>(`/orgs/${id}/workers`);
    const names = (Array.isArray(workers.body) ? workers.body : workers.body.data).map((w) => w.name);
    expect(names).toEqual(['Ada']);

    // Members of the first organization get nothing from the new one.
    expect([403, 404]).toContain((await walt.get(`/orgs/${id}/clients`)).status);
    expect((await walt.get<MeBody>('/me')).body.organizations.map((o) => o.name)).toEqual(['First Org']);
  });

  it('refuses a missing name, an unknown time zone or currency, and anonymous requests', async () => {
    // Invalid input is a validation error (400); 422 is reserved for business rules.
    expect((await ada.post('/me/organizations', { name: '  ' })).status).toBe(400);
    expect((await ada.post('/me/organizations', { name: 'Bad TZ', timezone: 'Mars/Olympus_Mons' })).status).toBe(400);
    expect((await ada.post('/me/organizations', { name: 'Bad currency', currency: 'XYZW' })).status).toBe(400);
    expect((await new Client(t).post('/me/organizations', { name: 'Nobody' })).status).toBe(401);

    const me = await ada.get<MeBody>('/me');
    expect(me.body.organizations.map((o) => o.name)).not.toContain('Bad TZ');
    expect(me.body.organizations.map((o) => o.name)).not.toContain('Nobody');
  });
});
