import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { email, personName } from '@tallywork/contracts';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Form validation audit (20 Nov 2026): what the API accepts when it is called directly, without the
 * web forms' own checks.
 */

describe('email', () => {
  it('accepts real addresses, trimming accidental spaces', () => {
    for (const v of ['user@gmail.com', 'john.doe@yahoo.com', 'user@example.com.ph', "o'neil+tag@sub.example.co"]) expect(email.parse(v)).toBe(v);
    expect(email.parse('  ada@example.com ')).toBe('ada@example.com');
  });
  it('refuses incomplete or malformed addresses', () => {
    for (const v of ['usergmail.com', 'user@', '@gmail.com', 'user@gmail', 'user.com', 'a b@example.com', '', '   ']) expect(email.safeParse(v).success, v).toBe(false);
  });
});

describe('person names', () => {
  it('accepts names from many languages and with punctuation names use', () => {
    for (const v of ['Ada Lovelace', 'José Álvarez', "Seán O'Brien", 'Mary-Jane Watson', 'Nguyễn Văn An', '李小龙', 'Мария', 'محمد', 'Martin Luther King Jr.', 'QA Worker 2']) expect(personName().parse(v)).toBe(v);
  });
  it('refuses names with no letters, markup and symbols, and whitespace alone', () => {
    for (const v of ['12345', '   ', '<script>alert(1)</script>', 'Ada@home', 'Bob#1', '{{name}}', '---']) expect(personName().safeParse(v).success, v).toBe(false);
  });
});

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-20T15:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@input-validation.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@input-validation.test'));
});
afterAll(() => t.close());

describe('API requests', () => {
  it('signs up with a padded email, and refuses a name of digits', async () => {
    const bad = await new Client(t).post('/auth/signup', { name: '12345', email: 'num@input-validation.test', password: 'long-enough-password' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0]).toMatchObject({ field: 'name', message: 'A name needs at least one letter' });
    const ok = await new Client(t).post('/auth/signup', { name: 'Zoë', email: '  zoe@input-validation.test  ', password: 'long-enough-password' });
    expect(ok.status).toBe(201);
  });

  it('refuses markup as a display name', async () => {
    const r = await admin.patch('/me', { name: '<img src=x onerror=alert(1)>' });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].field).toBe('name');
  });

  it('refuses a birth date in the future or before 1900, and accepts a past one', async () => {
    expect((await admin.patch(o(`/workers/${waltId}/details`), { birth_date: '2026-11-20' })).body.errors?.[0]).toMatchObject({ field: 'birth_date' });
    expect((await admin.patch(o(`/workers/${waltId}/details`), { birth_date: '1899-12-31' })).body.errors?.[0]).toMatchObject({ field: 'birth_date' });
    expect((await admin.patch(o(`/workers/${waltId}/details`), { birth_date: '1990-05-01', first_name: 'Walter' })).status).toBe(200);
  });

  it('refuses an invalid personal email', async () => {
    expect((await admin.patch(o(`/workers/${waltId}/details`), { personal_email: 'walt@home' })).status).toBe(400);
  });

  it('checks a project end date sent alone against the saved start date', async () => {
    const p = (await admin.post(o('/projects'), { name: 'Dated', start_date: '2026-10-01' })).body.id;
    const r = await admin.patch(o(`/projects/${p}`), { end_date: '2026-09-01' });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].field).toBe('end_date');
    expect((await admin.patch(o(`/projects/${p}`), { end_date: '2026-12-01' })).status).toBe(200);
    expect((await admin.patch(o(`/projects/${p}`), { start_date: '2027-01-01' })).status).toBe(400); // after the saved end
  });

  it("checks a worker's date left sent alone against the saved start date", async () => {
    expect((await admin.patch(o(`/workers/${waltId}`), { start_date: '2026-06-01' })).status).toBe(200);
    expect((await admin.patch(o(`/workers/${waltId}`), { end_date: '2026-05-01' })).status).toBe(400);
  });

  it('needs a comment to reject manual time', async () => {
    const project = (await admin.post(o('/projects'), { name: 'Manual', member_ids: [waltId] })).body.id;
    const req = await walt.post(o('/manual-time'), { project_id: project, started_at: '2026-11-19T13:00:00Z', ended_at: '2026-11-19T14:00:00Z', reason: 'Forgot the timer' });
    expect(req.status).toBe(201);
    const id = req.body.id ?? req.body.request?.id;
    const bare = await admin.post(o(`/manual-time/${id}/reject`), {});
    expect(bare.status).toBe(400);
    expect(bare.body.errors[0].field).toBe('comment');
    expect((await admin.post(o(`/manual-time/${id}/reject`), { comment: '   ' })).status).toBe(400);
    expect((await admin.post(o(`/manual-time/${id}/reject`), { comment: 'Wrong project' })).status).toBe(204);
  });

  it('refuses a goal target that would be stored as 0', async () => {
    const r = await admin.post(o('/performance/goals'), { title: 'Tasks', subject_type: 'ORG', metric: 'TASKS_COMPLETED', target: 0.4, start_date: '2026-11-01', end_date: '2026-11-30' });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].field).toBe('target');
  });
});
