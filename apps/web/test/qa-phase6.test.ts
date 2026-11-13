import { describe, expect, it } from 'vitest';
import { afterSignIn, homePath } from '../lib/home';
import { countOf } from '../lib/plural';
import { suggestedPeriod, unbilledOutside } from '../components/finance/invoice-period';
import { pendingInviteFor } from '../components/people/pending-invite';

/** QA audit 11 Nov 2026, Phase 6: navigation and wording. */
const org = (id: string) => ({ id }) as never;
const me = (orgs: string[], portals: string[] = []) => ({ organizations: orgs.map(org), client_portals: portals.map((access_id) => ({ access_id })) as never });

describe('homePath: where a signed-in person belongs', () => {
  it('the organization used last, else the first', () => {
    expect(homePath(me(['a', 'b']), 'b')).toBe('/o/b');
    expect(homePath(me(['a', 'b']), 'gone')).toBe('/o/a');
    expect(homePath(me(['a']), null)).toBe('/o/a');
  });

  it('a client viewer goes to their dashboards; someone with neither to the welcome page', () => {
    expect(homePath(me([], ['p1']), null)).toBe('/portal/p1');
    expect(homePath(me([], ['p1', 'p2']), null)).toBe('/portal');
    expect(homePath(me([]), null)).toBe('/welcome');
  });
});

describe('afterSignIn (BUG-06)', () => {
  it('follows next within the site', () => {
    expect(afterSignIn(me(['a']), '/invite?token=abc', null)).toBe('/invite?token=abc');
    expect(afterSignIn(me(['a']), '/o/a/timesheets', null)).toBe('/o/a/timesheets');
  });

  it('never leaves the site', () => {
    expect(afterSignIn(me(['a']), 'https://evil.example/', null)).toBe('/o/a');
    expect(afterSignIn(me(['a']), '/\\evil.example/phish', null)).toBe('/o/a');
  });

  it('a next that is itself a sign-in page goes home instead, so a signed-in person is not sent round in a circle', () => {
    expect(afterSignIn(me(['a']), '/login', null)).toBe('/o/a');
    expect(afterSignIn(me(['a']), '/login?next=%2Flogin', null)).toBe('/o/a');
    expect(afterSignIn(me(['a']), '/signup#x', null)).toBe('/o/a');
    expect(afterSignIn(me(['a']), null, null)).toBe('/o/a');
  });
});

describe('countOf (BUG-11)', () => {
  it('uses the singular for exactly one', () => {
    expect(countOf(1, 'manager')).toBe('1 manager');
    expect(countOf(0, 'manager')).toBe('0 managers');
    expect(countOf(2, 'member')).toBe('2 members');
    expect(countOf(1200, 'entry', 'entries')).toBe(`${(1200).toLocaleString()} entries`);
  });
});

describe('the new invoice period (C-10)', () => {
  const lastMonth = { from: '2026-10-01', to: '2026-10-31' };

  it('starts on the month of the latest approved time not yet invoiced', () => {
    expect(suggestedPeriod({ from: '2026-09-14', to: '2026-11-05' }, lastMonth)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(suggestedPeriod({ from: '2026-02-03', to: '2026-02-20' }, lastMonth)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('with nothing waiting, last month as before', () => {
    expect(suggestedPeriod({ from: null, to: null }, lastMonth)).toEqual(lastMonth);
    expect(suggestedPeriod(undefined, lastMonth)).toEqual(lastMonth);
  });

  it('points out approved time the chosen period leaves out', () => {
    const u = { from: '2026-09-14', to: '2026-11-05' };
    expect(unbilledOutside(u, '2026-11-01', '2026-11-30')).toBe(true);
    expect(unbilledOutside(u, '2026-09-01', '2026-11-30')).toBe(false);
    expect(unbilledOutside({ from: null, to: null }, '2026-11-01', '2026-11-30')).toBe(false);
  });
});

describe('pendingInviteFor (C-8)', () => {
  const pending = [
    { email: 'pat@example.com', expired: false },
    { email: 'old@example.com', expired: true },
  ];

  it('finds a pending invitation to the address, as the server compares it', () => {
    expect(pendingInviteFor(pending, '  Pat@Example.com ')).toBe(pending[0]);
  });

  it('ignores expired invitations, other addresses and an empty field', () => {
    expect(pendingInviteFor(pending, 'old@example.com')).toBeUndefined();
    expect(pendingInviteFor(pending, 'someone@example.com')).toBeUndefined();
    expect(pendingInviteFor(pending, '')).toBeUndefined();
    expect(pendingInviteFor(undefined, 'pat@example.com')).toBeUndefined();
  });
});
