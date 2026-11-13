import { describe, expect, it } from 'vitest';
import { inviteInput, issueMessage, password, signupInput } from '@tallywork/contracts';
import { EMAIL_MESSAGE, dateOrderProblem, emailProblem, fieldError, passwordProblem, signupProblems } from '../lib/form-checks';

/**
 * QA audit, 11 Nov 2026 (BUG-05, BUG-10): forms sent malformed emails, reversed dates and short
 * passwords to the server. The browser checks are copies of the server's rules (the contracts root is
 * too heavy for pages), so these tests hold them to the server's own schemas and wording.
 */
const emails = ['not-an-email', 'bad-email', 'a@', '@b.co', 'a b@c.co', 'a..b@c.co', '.a@b.co', 'a@b', 'a@b.c', 'a@b.co', 'leomar+qa-worker1@murphyconsulting.us', 'Mia.Lee@example.com', "o'neil@x-y.example.org", `${'a'.repeat(250)}@b.co`];

describe('emailProblem matches the server', () => {
  it.each(emails)('%s', (e) => {
    const server = inviteInput.shape.email.safeParse(e);
    expect(emailProblem(e) === null).toBe(server.success);
  });

  it('with the server’s wording', () => {
    const server = inviteInput.shape.email.safeParse('not-an-email');
    expect(issueMessage(server.error!.issues[0] as never)).toBe(EMAIL_MESSAGE);
  });
});

describe('passwordProblem matches the server', () => {
  it.each([0, 9, 10, 200, 201])('a password of %i characters', (n) => {
    const v = 'x'.repeat(n);
    const server = password.safeParse(v);
    expect(passwordProblem(v)).toBe(server.success ? null : server.error.issues[0]!.message);
  });
});

describe('dateOrderProblem', () => {
  it('refuses an end before the start, with the server’s wording', () => {
    expect(dateOrderProblem('2026-12-31', '2026-01-01')).toBe('Must be on or after the start date');
  });

  it('allows the same day, a later end, or an empty date', () => {
    expect(dateOrderProblem('2026-01-01', '2026-01-01')).toBeNull();
    expect(dateOrderProblem('2026-01-01', '2026-02-01')).toBeNull();
    expect(dateOrderProblem('', '2026-01-01')).toBeNull();
    expect(dateOrderProblem('2026-01-01', '')).toBeNull();
  });
});

describe('fieldError', () => {
  it('is shaped like a server validation error, so forms show it on the field', () => {
    const e = fieldError('email', EMAIL_MESSAGE);
    expect([e.status, e.field('email')]).toEqual([422, EMAIL_MESSAGE]);
  });
});

describe('signupProblems matches the server (QA audit BUG-16)', () => {
  const ok = { name: 'Quinn Owner', email: 'quinn@example.com', password: 'x'.repeat(12), organization_name: '' };
  const cases: Array<[string, typeof ok]> = [
    ['a valid form', ok],
    ['an empty form', { name: '', email: '', password: '', organization_name: '' }],
    ['a blank name', { ...ok, name: '   ' }],
    ['a long name', { ...ok, name: 'n'.repeat(101) }],
    ['a malformed email', { ...ok, email: 'not-an-email' }],
    ['an email with spaces around it', { ...ok, email: '  quinn@example.com ' }],
    ['a short password', { ...ok, password: 'short' }],
    ['a long organization name', { ...ok, organization_name: 'o'.repeat(101) }],
    ['a blank organization name', { ...ok, organization_name: '   ' }],
  ];

  it.each(cases)('%s', (_label, f) => {
    // As the page sends it: trimmed name and email, an empty organization name left out.
    const sent = { name: f.name.trim(), email: f.email.trim(), password: f.password, organization_name: f.organization_name.trim() || undefined };
    // With the input kept, as the server's error map sees it: an empty field reads "This field is required".
    const server = signupInput.safeParse(sent, { reportInput: true });
    const expected = server.success ? [] : server.error.issues.map((i) => ({ field: String(i.path[0]), message: issueMessage(i as never) }));
    expect(signupProblems(f)).toEqual(expected);
  });
});
