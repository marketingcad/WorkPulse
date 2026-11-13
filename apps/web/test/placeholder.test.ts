import { describe, expect, it } from 'vitest';
import { keepPreviousWhen, pathParam } from '../lib/placeholder';

/**
 * QA audit, 11 Nov 2026 (BUG-03): Members › Former members showed the current members, under
 * "Date left", for 2–4 seconds after the tab was opened. The previous list is now kept only while
 * paging or searching within the same tab.
 */
const key = (path: string) => ({ queryKey: ['org', 'o1', path] });
const rows = { data: [{ name: 'Boss Leomar' }], total: 1 };

describe('keepPreviousWhen', () => {
  const formerTab = keepPreviousWhen<typeof rows>((p) => (pathParam(p, 'view') ?? 'current') === 'former');

  it('drops the current members when switching to Former (the bug)', () => {
    expect(formerTab(rows, key('/workers?view=current&page=1'))).toBeUndefined();
  });

  it('keeps the rows while paging or searching within the same tab', () => {
    expect(formerTab(rows, key('/workers?view=former&page=1'))).toBe(rows);
    expect(formerTab(rows, key('/workers?view=former&q=ann&page=2'))).toBe(rows);
  });

  it('has nothing to keep on the first load', () => {
    expect(formerTab(undefined, undefined)).toBeUndefined();
    expect(formerTab(rows, { queryKey: ['org', 'o1', null] })).toBeUndefined();
  });
});

describe('pathParam', () => {
  it('reads a query parameter, or null', () => {
    expect(pathParam('/workers?view=former&page=2', 'view')).toBe('former');
    expect(pathParam('/workers?page=2', 'view')).toBeNull();
    expect(pathParam('/workers', 'view')).toBeNull();
  });
});
