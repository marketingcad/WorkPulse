import { describe, expect, it } from 'vitest';
import { checkCatalog, uiEn } from '../src';

describe('uiEn catalog', () => {
  it('has a non-empty string for every key', () => {
    for (const [key, value] of Object.entries(uiEn)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('is consistent with itself (keys and placeholders)', () => {
    expect(checkCatalog(uiEn, uiEn)).toEqual([]);
  });
});
