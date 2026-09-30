import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

const NOW = new Date('2026-09-23T20:00:00Z');
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const clientRates = async (id: string) =>
  ((await admin.get(o('/rates'))).body as Array<{ scope: string; scope_id: string; kind: string; amount_minor: number; effective_to: string | null }>).filter((r) => r.scope === 'CLIENT' && r.scope_id === id);

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@clients.test'));
});
afterAll(() => t.close());

describe('client profile', () => {
  let id: string;

  it('stores contact person, document language, colour, logo and client rates', async () => {
    const r = await admin.post(o('/clients'), {
      name: 'Acme',
      contact_name: 'Wile E. Coyote',
      email: 'ap@acme.test',
      document_language: 'es',
      color: '#2563eb',
      logo: LOGO,
      currency: 'EUR',
      pay_rate_minor: 4000,
      bill_rate_minor: 9500,
    });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ contact_name: 'Wile E. Coyote', document_language: 'es', color: '#2563eb', logo: LOGO, pay_rate_minor: 4000, bill_rate_minor: 9500 });
    const rates = await clientRates(id);
    expect(rates).toHaveLength(2);
    expect(rates.every((x) => x.effective_to === null)).toBe(true);
  });

  it('leaves rates alone when they are omitted or unchanged', async () => {
    expect((await admin.patch(o(`/clients/${id}`), { name: 'Acme Corp', currency: 'EUR', bill_rate_minor: 9500 })).status).toBe(200);
    expect(await clientRates(id)).toHaveLength(2);
  });

  it('clears a client rate with null', async () => {
    const r = await admin.patch(o(`/clients/${id}`), { name: 'Acme Corp', currency: 'EUR', pay_rate_minor: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pay_rate_minor: null, bill_rate_minor: 9500 });
  });

  it('counts the client’s active projects', async () => {
    await admin.post(o('/projects'), { name: 'Road Runner', client_id: id });
    await admin.post(o('/projects'), { name: 'Anvils', client_id: id });
    const list = (await admin.get(o('/clients'))).body as Array<{ id: string; project_count: number }>;
    expect(list.find((c) => c.id === id)?.project_count).toBe(2);
  });

  it('rejects an unknown language and a non-image logo', async () => {
    expect((await admin.post(o('/clients'), { name: 'X', document_language: 'xx' })).status).toBe(400);
    expect((await admin.post(o('/clients'), { name: 'X', logo: 'data:text/html;base64,PGgxPg==' })).status).toBe(400);
  });
});
