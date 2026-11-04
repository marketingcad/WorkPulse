import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, signup, type Harness } from './harness';

/**
 * Server-Timing reports the database work behind a signed-in request (round trips are what make a
 * far-away database slow). It is never sent to anonymous callers: on sign-in a query count could
 * tell whether an account exists.
 */
let t: Harness;
let admin: Client;
let orgId: string;

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@timing.test'));
});
afterAll(() => t.close());

const DB_TIMING = /^db;dur=\d+;desc="(\d+) queries, \d+ new connections"$/;

describe('Server-Timing', () => {
  it('reports the queries behind a signed-in request', async () => {
    const res = await admin.get(`/orgs/${orgId}`);
    expect(res.status).toBe(200);
    const header = res.headers.get('server-timing') ?? '';
    expect(header).toMatch(DB_TIMING);
    // Session lookup, tenant transaction, organization and actor: never zero.
    expect(Number(header.match(DB_TIMING)![1])).toBeGreaterThan(3);
  });

  it('is not sent to anonymous callers, including a failed sign-in', async () => {
    const anon = new Client(t);
    expect((await anon.get('/health')).headers.get('server-timing')).toBeNull();
    expect((await anon.get('/me')).headers.get('server-timing')).toBeNull();
    const login = await anon.post('/auth/login', { email: 'nobody@timing.test', password: 'not-the-password' });
    expect(login.status).toBe(401);
    expect(login.headers.get('server-timing')).toBeNull();
  });
});
