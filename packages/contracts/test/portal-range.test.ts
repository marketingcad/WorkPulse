import { describe, expect, it } from 'vitest';
import { portalRangeInput } from '../src/inputs';
import { PORTAL_MAX_RANGE_DAYS, portalRangeProblem } from '../src/limits';

// The client portal's date fields check a period before asking the server (BUG-22): the check must say
// exactly what the server would refuse, no more and no less.
const cases: Array<[string, string, ReturnType<typeof portalRangeProblem>]> = [
  ['2026-11-01', '2026-11-30', null],
  ['2026-11-19', '2026-11-19', null],
  ['2026-08-18', '2026-11-19', null], // 93 days: the longest allowed
  ['2026-08-17', '2026-11-19', 'too_long'], // 94 days
  ['2026-11-20', '2026-11-19', 'order'],
  ['', '2026-11-19', 'missing'], // a cleared field
  ['2026-11-01', '', 'missing'],
  ['2026-13-01', '2026-11-19', 'missing'],
  ['19/11/2026', '2026-11-19', 'missing'],
];

describe('portalRangeProblem', () => {
  it.each(cases)('%s → %s: %s', (from, to, problem) => {
    expect(portalRangeProblem({ from, to })).toBe(problem);
  });

  it('agrees with the server schema on every case', () => {
    for (const [from, to, problem] of cases) expect(portalRangeInput.safeParse({ from, to }).success, `${from}..${to}`).toBe(problem === null);
  });

  it('allows up to the documented maximum', () => {
    expect(PORTAL_MAX_RANGE_DAYS).toBe(93);
  });
});
