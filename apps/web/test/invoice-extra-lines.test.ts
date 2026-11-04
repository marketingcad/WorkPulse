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
