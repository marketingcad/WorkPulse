import { describe, expect, it } from 'vitest';
import { extraLineErrors } from '../components/finance/extra-lines';

/** Custom invoice lines say what is wrong instead of only turning red (UX remediation, phase 4). */
describe('extraLineErrors', () => {
  const ok = { description: 'Setup fee', quantity: '1', unitPrice: '1,250.50' };

  it('accepts a complete line, including a zero price', () => {
    expect(extraLineErrors(ok)).toEqual({});
    expect(extraLineErrors({ ...ok, unitPrice: '0' })).toEqual({});
  });

  it('names every blank field', () => {
    expect(extraLineErrors({ description: ' ', quantity: '', unitPrice: '' })).toEqual({ description: 'Describe the item.', quantity: 'Enter a quantity.', unitPrice: 'Enter a price.' });
  });

  it('explains that discounts cannot be negative lines, and what to do instead', () => {
    expect(extraLineErrors({ ...ok, unitPrice: '-50' }).unitPrice).toMatch(/cannot be negative.*lower the client’s rate/);
  });

  it('rejects malformed numbers with an example', () => {
    expect(extraLineErrors({ ...ok, quantity: 'two' }).quantity).toBe('Use a number, e.g. 1 or 2.5.');
    expect(extraLineErrors({ ...ok, quantity: '-1' }).quantity).toBe('Use zero or more.');
    expect(extraLineErrors({ ...ok, unitPrice: '12.345' }).unitPrice).toBe('Use an amount like 150 or 1,250.50.');
  });
});

/** Form validation audit, 20 Nov 2026: the server's limits, and quantities Number() read but people did not mean. */
describe('extraLineErrors limits', () => {
  const ok = { description: 'Setup', quantity: '1', unitPrice: '100' };
  it('refuses hex and exponent quantities and values over the server limits', () => {
    expect(extraLineErrors({ ...ok, quantity: '0x10' }).quantity).toBe('Use a number, e.g. 1 or 2.5.');
    expect(extraLineErrors({ ...ok, quantity: '1e3' }).quantity).toBe('Use a number, e.g. 1 or 2.5.');
    expect(extraLineErrors({ ...ok, quantity: '-1' }).quantity).toBe('Use zero or more.');
    expect(extraLineErrors({ ...ok, quantity: '100001' }).quantity).toBe('Use a quantity up to 100,000.');
    expect(extraLineErrors({ ...ok, unitPrice: '1,000,000.01' }).unitPrice).toBe('Use a price up to 1,000,000.00.');
  });
  it('accepts the largest values the server takes', () => {
    expect(extraLineErrors({ ...ok, quantity: '100000', unitPrice: '1,000,000.00' })).toEqual({});
    expect(extraLineErrors({ ...ok, quantity: '2.5' })).toEqual({});
  });
});
