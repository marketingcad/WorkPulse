import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/** The web app's product tour starts once for a new account; finishing or skipping it is remembered on the account. */
let t: Harness;
let admin: Client;
let other: Client;

beforeAll(async () => {
  t = await createHarness();
  let orgId: string;
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@tour.test'));
  ({ client: other } = await addMember(t, admin, orgId, 'Mia', 'mia@tour.test', 'TEAM_MANAGER'));
});
afterAll(() => t.close());

describe('product tour preference', () => {
  it('a new account has not seen the tour', async () => {
    expect((await admin.get('/me')).body.user.tour_done).toBe(false);
  });

  it('finishing or skipping it is remembered; it can be reset to show again', async () => {
    const done = await admin.patch('/me', { tour: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.user.tour_done).toBe(true);
    expect((await admin.get('/me')).body.user.tour_done).toBe(true);
    expect((await admin.patch('/me', { tour: 'reset' })).body.user.tour_done).toBe(false);
    await admin.patch('/me', { tour: 'done' });
  });

  it('is per person: one account finishing it does not hide it for another', async () => {
    expect((await other.get('/me')).body.user.tour_done).toBe(false);
  });

  it('changing the name or language leaves it alone; an unknown value is refused', async () => {
    expect((await admin.patch('/me', { name: 'Ada L.' })).body.user.tour_done).toBe(true);
    expect((await admin.patch('/me', { tour: 'later' })).status).toBe(400);
  });

  it('needs to be signed in', async () => {
    const anon = new (admin.constructor as new (h: Harness) => Client)(t);
    expect((await anon.patch('/me', { tour: 'done' })).status).toBe(401);
  });
});
