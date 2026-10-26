import { describe, expect, it } from 'vitest';
import { toMinor } from '../components/finance/types';

/** Money audit M7: a comma used as a decimal point was dropped, so "12,50" became 1,250.00. */
describe('toMinor', () => {
  it('reads plain and thousands-separated amounts', () => {
    expect(toMinor('75')).toBe(7500);
    expect(toMinor('75.5')).toBe(7550);
    expect(toMinor('0.29')).toBe(29);
    expect(toMinor(' 1,000.00 ')).toBe(100000);
    expect(toMinor('1,250')).toBe(125000);
    expect(toMinor('12,345,678.90')).toBe(1234567890);
  });

  it('refuses a decimal comma instead of multiplying the amount', () => {
    expect(toMinor('12,50')).toBeNull(); // was 125000
    expect(toMinor('1,5')).toBeNull(); // was 1500
    expect(toMinor('1,0000')).toBeNull();
    expect(toMinor('1,000,00')).toBeNull();
  });

  it('refuses negatives, letters, too many decimals and empty input', () => {
    for (const v of ['-5', 'abc', '1.234', '.5', '', ',100']) expect(toMinor(v)).toBeNull();
  });
});
