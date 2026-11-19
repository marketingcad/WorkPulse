import { toMinor } from './types';

export interface ExtraLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
}

/** The server's limits for a custom line (invoiceCreateInput). */
const MAX_QUANTITY = 100_000;
const MAX_UNIT_PRICE_MINOR = 100_000_000;

export interface ExtraLineErrors {
  description?: string;
  quantity?: string;
  unitPrice?: string;
}

/**
 * What is wrong with one custom invoice line, in words (it used to show only a red border, and the
 * Next button went grey without saying why). Same rules as the API: a description, a quantity of
 * zero or more, and a price of zero or more with at most two decimals.
 */
export function extraLineErrors(l: ExtraLineInput): ExtraLineErrors {
  const e: ExtraLineErrors = {};
  if (!l.description.trim()) e.description = 'Describe the item.';
  // A plain decimal number: Number() also read "0x10" and "1e3" (form validation audit, 20 Nov 2026).
  const qtyText = l.quantity.trim();
  const qty = Number(qtyText);
  if (qtyText === '') e.quantity = 'Enter a quantity.';
  else if (/^-/.test(qtyText)) e.quantity = 'Use zero or more.';
  else if (!/^\d+(\.\d+)?$/.test(qtyText)) e.quantity = 'Use a number, e.g. 1 or 2.5.';
  else if (qty > MAX_QUANTITY) e.quantity = 'Use a quantity up to 100,000.';
  const price = l.unitPrice.trim();
  if (price === '') e.unitPrice = 'Enter a price.';
  else if (/^-/.test(price)) e.unitPrice = 'Prices cannot be negative: invoices have no discount lines. To give a discount, lower the client’s rate, or explain it in the notes.';
  else if (toMinor(price) === null) e.unitPrice = 'Use an amount like 150 or 1,250.50.';
  else if (toMinor(price)! > MAX_UNIT_PRICE_MINOR) e.unitPrice = 'Use a price up to 1,000,000.00.';
  return e;
}
