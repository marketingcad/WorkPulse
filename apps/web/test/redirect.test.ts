import { describe, expect, it } from 'vitest';
import { sameOriginPath } from '../lib/redirect';

/** After sign-in the app follows `?next=` only within its own site (open-redirect regression). */
const ORIGIN = 'https://app.example';
const bs = String.fromCharCode(92);

describe('sameOriginPath', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(sameOriginPath('/o/123/timesheets?date=2026-10-01#top', ORIGIN)).toBe('/o/123/timesheets?date=2026-10-01#top');
    expect(sameOriginPath('/invite?token=abc', ORIGIN)).toBe('/invite?token=abc');
  });

  it('refuses anything that leaves the site', () => {
    for (const next of ['//evil.example', `/${bs}evil.example`, `/${bs}/evil.example`, '/\t/evil.example', 'https://evil.example/', 'javascript:alert(1)', 'evil.example'])
      expect(sameOriginPath(next, ORIGIN), JSON.stringify(next)).toBeNull();
  });

  it('ignores a missing value', () => {
    expect(sameOriginPath(null, ORIGIN)).toBeNull();
    expect(sameOriginPath('', ORIGIN)).toBeNull();
  });
});
