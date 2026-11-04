import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldLabel, issueMessage } from '@tallywork/contracts';
import { JSON_BODY_LIMIT } from '../src/app';
import { fromDatabaseError, parse } from '../src/lib/http';
import { Client, createHarness, signup, type Harness } from './harness';

// Input validation and feedback audit (30 October 2026), VF-xx in
// docs/audit/2026-10-30-validation-feedback-audit.md:
// VF-01 — validation messages are plain sentences, not zod's wording.
// VF-02/03 — invoices: due on or after issue; line quantity and price within what can be stored.
// VF-04 — PATCH on a pay group or time type changes only what it sends.
// VF-05 — malformed requests answer 400, not 500; database rule errors map to 4xx.
// VF-06 — report ranges: from ≤ to, at most 400 days.
// VF-07 — no API key that is already expired; unknown webhook events are a 400; payment references are trimmed.
// VF-08 — JSON bodies over the limit are refused with 413.

/** zod's built-in wording, which must not reach people. */
const RAW_VALIDATOR = /Too small|Too big|expected (string|number|int|object|array)|Invalid input|Invalid option|must match pattern|>=\s?\d|<=\s?\d/;

let t: Harness;
let admin: Client;
let orgId: string;
let membershipId: string;
let clientId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-02T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Vera', 'vera@vf.test'));
  membershipId = (await admin.get<Array<{ id: string }>>(o('/workers'))).body[0]!.id;
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
});
afterAll(async () => t.close());

describe('VF-01: readable validation messages', () => {
  it('maps zod issues to plain sentences and keeps messages set on the schema', () => {
    const schema = z.object({
      name: z.string().trim().min(1).max(5),
      amount: z.number().int().min(1).max(100_000_000),
      email: z.email(),
      on: z.iso.date(),
      kind: z.enum(['A', 'B']),
      ids: z.array(z.string()).min(1),
      password: z.string().min(10, 'Use at least 10 characters'),
    });
    const r = schema.safeParse({ name: ' ', amount: 1e9, email: 'x@', on: '2026-02-30', kind: 'C', ids: [], password: 'short' }, { error: issueMessage });
    const byField = Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), i.message]));
    expect(byField).toEqual({
      name: 'This field is required',
      amount: 'Enter 100,000,000 or less',
      email: 'Enter a valid email address, like name@example.com',
      on: 'Enter a real date (YYYY-MM-DD)',
      kind: 'Choose one of: A, B',
      ids: 'Choose at least one',
      password: 'Use at least 10 characters',
    });
    expect(schema.safeParse({}, { error: issueMessage }).error!.issues[0]!.message).toBe('This field is required');
    // An empty email is missing, not malformed.
    expect(z.email().safeParse('', { error: issueMessage }).error!.issues[0]!.message).toBe('This field is required');
  });

  it('labels a field path the way people read it', () => {
    expect(fieldLabel(['amount_minor'])).toBe('Amount');
    expect(fieldLabel(['start_date'])).toBe('Start date');
    expect(fieldLabel(['extra_lines', 0, 'quantity'])).toBe('Quantity (row 1)');
    expect(fieldLabel(['settings', 'ipAllowlist'])).toBe('IP allowlist');
    expect(fieldLabel(['token'])).toBeNull();
    expect(fieldLabel([])).toBeNull();
  });

  it('API errors keep exact field paths and use readable messages and titles', async () => {
    const samples = [
      await admin.post(o('/clients'), { name: ' ' }),
      await admin.post(o('/clients'), { name: 'c'.repeat(151) }),
      await admin.post(o('/expenses'), { category: 'Travel', amount_minor: 0, currency: 'USD', spent_on: '2026-10-01' }),
      await admin.post(o('/projects'), { name: 'Colour', color: 'red' }),
    ];
    for (const r of samples) {
      expect(r.status).toBe(400);
      expect(r.body.title).not.toMatch(RAW_VALIDATOR);
      for (const e of r.body.errors) expect(e.message).not.toMatch(RAW_VALIDATOR);
    }
    expect(samples[0]!.body).toMatchObject({ title: 'Name: This field is required', errors: [{ field: 'name', message: 'This field is required' }] });
    expect(samples[1]!.body.errors).toEqual([{ field: 'name', message: 'Use at most 150 characters' }]);
  });

  it('a malformed emailed link reads like an expired one', async () => {
    const anon = new Client(t);
    const reset = await anon.post('/auth/password/reset', { token: 'abc', password: 'long enough password' });
    expect(reset.body.title).toBe('This link is invalid or has expired');
    const invite = await anon.post('/auth/invitations/accept', { token: 'abc', name: 'X', password: 'long enough password' });
    expect(invite.body.title).toBe('This invitation is invalid or has expired');
  });

  it('parse() reports several problems in the title without hiding them', () => {
    try {
      parse(z.object({ a: z.string(), b: z.number() }), {});
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe('A: This field is required (and 1 more)');
    }
  });
});

describe('VF-02/03: invoices', () => {
  const invoice = (extra: object) => ({ client_id: clientId, period_start: '2026-10-01', period_end: '2026-10-31', issue_date: '2026-10-31', due_date: '2026-11-30', ...extra });

  it('refuses a due date before the issue date, for create and preview', async () => {
    for (const path of ['/invoices', '/invoices/preview']) {
      const r = await admin.post(o(path), invoice({ due_date: '2026-10-01', extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 100 }] }));
      expect(r.status, path).toBe(400);
      expect(r.body.errors).toEqual([{ field: 'due_date', message: 'The due date cannot be before the issue date' }]);
    }
    const ok = await admin.post(o('/invoices'), invoice({ due_date: '2026-10-31', extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 100 }] }));
    expect(ok.status).toBe(201);
  });

  it('refuses a line too large to store with a field error, and leaves no invoice behind', async () => {
    const before = (await admin.get<unknown[]>(o('/invoices'))).body.length;
    for (const line of [{ quantity: 1e9, unit_price_minor: 1e9 }, { quantity: 1e12, unit_price_minor: 1 }, { quantity: 1, unit_price_minor: 1e12 }]) {
      const r = await admin.post(o('/invoices'), invoice({ extra_lines: [{ description: 'Big', ...line }] }));
      expect(r.status, JSON.stringify(line)).toBe(400);
      expect(r.body.errors[0].field).toMatch(/^extra_lines\.0\.(quantity|unit_price_minor)$/);
    }
    expect((await admin.get<unknown[]>(o('/invoices'))).body.length).toBe(before);
    // The largest allowed line still saves.
    expect((await admin.post(o('/invoices'), invoice({ extra_lines: [{ description: 'Max', quantity: 100_000, unit_price_minor: 100_000_000 }] }))).status).toBe(201);
  });

  it('caps budget and payment amounts', async () => {
    const project = (await admin.post(o('/projects'), { name: 'Site', client_id: clientId })).body.id;
    expect((await admin.put(o('/budgets'), { subject_type: 'PROJECT', subject_id: project, kind: 'MONEY', amount: 1e13 })).status).toBe(400);
    expect((await admin.post(o('/payments'), { client_id: clientId, amount_minor: 1e13, currency: 'USD', received_on: '2026-10-01' })).status).toBe(400);
  });
});

describe('VF-04: PATCH changes only what it sends', () => {
  it('renaming a pay group keeps its members and their bank details', async () => {
    const pp = await admin.post(o('/payroll/profiles'), { name: 'Monthly', period: { type: 'monthly' }, currency: 'USD', is_default: true, member_ids: [membershipId] });
    expect(pp.status).toBe(201);
    expect((await admin.put(o(`/payroll/profiles/${pp.body.id}/members/${membershipId}/bank`), { type: 'bank', account_number: '12345678' })).status).toBe(200);
    const renamed = await admin.patch(o(`/payroll/profiles/${pp.body.id}`), { name: 'Monthly staff' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Monthly staff', currency: 'USD', is_default: true, period: { type: 'monthly' } });
    expect(renamed.body.members).toEqual([expect.objectContaining({ membership_id: membershipId, bank: expect.objectContaining({ account_last4: '5678' }) })]);
    // Sending the list still replaces it.
    const emptied = await admin.patch(o(`/payroll/profiles/${pp.body.id}`), { member_ids: [] });
    expect(emptied.body.members).toEqual([]);
  });

  it('a partial time type update keeps the other settings', async () => {
    const tt = await admin.post(o('/time-types'), { name: 'Overtime', short_name: 'OT', color: '#123456', pay_coefficient: 1.5, bill_coefficient: 2, not_billable: true });
    expect(tt.status).toBe(201);
    const r = await admin.patch(o(`/time-types/${tt.body.id}`), { name: 'Overtime (weekday)' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ name: 'Overtime (weekday)', short_name: 'OT', color: '#123456', pay_coefficient: 1.5, bill_coefficient: 2, not_billable: true });
  });
});

describe('VF-05: malformed requests and database rules', () => {
  it('answers 400 for an unknown scope or a non-multipart upload', async () => {
    const project = (await admin.post(o('/projects'), { name: 'Docs' })).body.id;
    expect((await admin.put(o('/policies/bogus/x'), {})).status).toBe(400);
    expect((await admin.del(o('/dashboard/layout?scope=bogus'))).status).toBe(400);
    const receipt = await admin.post(o('/files/receipts'), { a: 1 });
    expect(receipt).toMatchObject({ status: 400, body: { code: 'unsupported_media_type' } });
    expect((await admin.post(o(`/projects/${project}/documents`), { a: 1 })).status).toBe(400);
  });

  it('maps database rule errors to 4xx problems', () => {
    const wrapped = (code: string) => ({ message: 'Failed query', cause: { code } });
    expect(fromDatabaseError(wrapped('22003'))).toMatchObject({ category: 'validation', code: 'value_out_of_range' });
    expect(fromDatabaseError(wrapped('22001'))).toMatchObject({ category: 'validation', code: 'value_too_long' });
    expect(fromDatabaseError(wrapped('23502'))).toMatchObject({ category: 'validation', code: 'value_missing' });
    expect(fromDatabaseError(wrapped('23514'))).toMatchObject({ category: 'validation', code: 'value_not_allowed' });
    expect(fromDatabaseError(wrapped('23503'))).toMatchObject({ category: 'conflict', code: 'related_record_missing' });
    expect(fromDatabaseError(wrapped('40001'))).toBeNull();
  });
});

describe('VF-06: report ranges', () => {
  it('refuses a reversed or over-400-day range and keeps a valid one', async () => {
    const reversed = await admin.post(o('/reports/time-activity/query'), { from: '2026-12-31', to: '2026-01-01' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.errors).toEqual([{ field: 'to', message: 'Choose a start on or before the end' }]);
    expect((await admin.post(o('/reports/time-activity/query'), { from: '0001-01-01', to: '9999-12-31' })).status).toBe(400);
    expect((await admin.post(o('/reports/time-activity/export'), { from: '2020-01-01', to: '2026-01-01', format: 'CSV' })).status).toBe(400);
    expect((await admin.post(o('/reports/time-activity/query'), { from: '2025-10-01', to: '2026-10-31' })).status).toBe(200);
  });
});

describe('VF-07: small input slips', () => {
  it('refuses an API key that has already expired', async () => {
    const past = await admin.post(o('/api-keys'), { name: 'Old', scopes: ['read:time'], expires_at: '2026-11-01T00:00:00Z' });
    expect(past.status).toBe(400);
    expect(past.body.errors).toEqual([{ field: 'expires_at', message: 'Choose a date in the future' }]);
    expect((await admin.post(o('/api-keys'), { name: 'New', scopes: ['read:time'], expires_at: '2027-01-01T00:00:00Z' })).status).toBe(201);
  });

  it('answers 400, not 403, for webhook events that do not exist', async () => {
    const r = await admin.post(o('/webhooks'), { url: 'https://example.com/hook', events: ['made.up'] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual([{ field: 'events', message: 'Choose at least one supported event' }]);
  });

  it('treats a padded payment reference as the same reference', async () => {
    const pay = (ref: string) => admin.post(o('/payments'), { client_id: clientId, amount_minor: 100, currency: 'USD', received_on: '2026-10-01', provider: 'Manual', provider_ref: ref });
    const first = await pay('CHK-7');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ provider: 'manual', provider_ref: 'CHK-7' });
    expect((await pay('  CHK-7 ')).status).toBe(409);
    // A blank reference is no reference, so it never collides.
    expect((await pay('   ')).body).toMatchObject({ provider_ref: null });
    expect((await pay('')).status).toBe(201);
  });
});

describe('VF-08: request size', () => {
  it('refuses a JSON body over the limit with 413, before reading it', async () => {
    const r = await admin.post(o('/clients'), { name: 'Big', notes: 'x'.repeat(JSON_BODY_LIMIT) });
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ code: 'payload_too_large', title: 'This request is too large. Send less data at once.' });
    expect((await admin.post(o('/clients'), { name: 'Small', notes: 'x'.repeat(2000) })).status).toBe(201);
  });
});
