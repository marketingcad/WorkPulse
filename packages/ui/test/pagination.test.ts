import { describe, expect, it } from 'vitest';
import { pageItems } from '../src';

describe('pageItems', () => {
  it('lists every page when they all fit', () => {
    expect(pageItems(0, 1)).toEqual([0]);
    expect(pageItems(2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageItems(6, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('elides the far end near the start', () => {
    expect(pageItems(0, 20)).toEqual([0, 1, 2, 3, 4, 'gap', 19]);
    expect(pageItems(3, 20)).toEqual([0, 1, 2, 3, 4, 'gap', 19]);
  });

  it('elides both sides in the middle', () => {
    expect(pageItems(4, 20)).toEqual([0, 'gap', 3, 4, 5, 'gap', 19]);
    expect(pageItems(10, 20)).toEqual([0, 'gap', 9, 10, 11, 'gap', 19]);
    expect(pageItems(15, 20)).toEqual([0, 'gap', 14, 15, 16, 'gap', 19]);
  });

  it('elides the near end close to the last page', () => {
    expect(pageItems(16, 20)).toEqual([0, 'gap', 15, 16, 17, 18, 19]);
    expect(pageItems(19, 20)).toEqual([0, 'gap', 15, 16, 17, 18, 19]);
  });

  it('always contains the current, first and last page, in order, with a stable length', () => {
    for (let pages = 1; pages <= 30; pages++) {
      for (let page = 0; page < pages; page++) {
        const items = pageItems(page, pages);
        const nums = items.filter((i): i is number => i !== 'gap');
        expect(nums).toContain(page);
        expect(nums[0]).toBe(0);
        expect(nums.at(-1)).toBe(pages - 1);
        expect([...nums].sort((a, b) => a - b)).toEqual(nums);
        expect(items.length).toBe(Math.min(pages, 7));
      }
    }
  });
});
