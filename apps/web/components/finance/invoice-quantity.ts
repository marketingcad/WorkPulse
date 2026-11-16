/**
 * An invoice line's quantity as stored and priced: hours to 4 decimals (domain `roundQuantity`).
 * QA audit BUG-29: hours were shown to 2 decimals (4.23 h) while the amount used 4 (4.2333 h), so
 * hours × rate did not give the amount on the line. Shows at least 2 decimals, at most 4, no trailing zeros.
 */
const HOURS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

export function invoiceQuantity(kind: string, quantity: number): string {
  return kind === 'TIME' ? `${HOURS.format(quantity)} h` : String(quantity);
}
