import { describe, expect, it } from 'vitest';
import { invoiceQuantity } from '../components/finance/invoice-quantity';

// QA audit 16 Nov 2026 (BUG-29): “4.23 h × $175.00 = $740.83” on the invoice page; the line is priced
// from 4.2333 h, so the hours must be shown as stored for the line to add up.
describe('invoice line quantity', () => {
  it('shows time to the 4 decimals it is priced at', () => {
    expect(invoiceQuantity('TIME', 4.2333)).toBe('4.2333 h');
    expect(invoiceQuantity('TIME', 0.4594)).toBe('0.4594 h');
    // 4.2333 × $175.00 = $740.83, the amount on the line.
    expect(Math.round(Number(invoiceQuantity('TIME', 4.2333).replace(' h', '')) * 17500)).toBe(74083);
  });

  it('keeps at least 2 decimals and drops trailing zeros beyond them', () => {
    expect(invoiceQuantity('TIME', 49)).toBe('49.00 h');
    expect(invoiceQuantity('TIME', 2.5)).toBe('2.50 h');
    expect(invoiceQuantity('TIME', 1.75)).toBe('1.75 h');
    expect(invoiceQuantity('TIME', 1234.5)).toBe('1234.50 h');
  });

  it('leaves other quantities as entered', () => {
    expect(invoiceQuantity('EXPENSE', 1)).toBe('1');
    expect(invoiceQuantity('CUSTOM', 3)).toBe('3');
    expect(invoiceQuantity('CUSTOM', 2.5)).toBe('2.5');
  });
});
