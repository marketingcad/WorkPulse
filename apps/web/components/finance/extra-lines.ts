import { toMinor } from './types';

export interface ExtraLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
}

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
  const qty = Number(l.quantity);
  if (l.quantity.trim() === '') e.quantity = 'Enter a quantity.';
  else if (!Number.isFinite(qty)) e.quantity = 'Use a number, e.g. 1 or 2.5.';
  else if (qty < 0) e.quantity = 'Use zero or more.';
  const price = l.unitPrice.trim();
  if (price === '') e.unitPrice = 'Enter a price.';
  else if (/^-/.test(price)) e.unitPrice = 'Prices cannot be negative: invoices have no discount lines. To give a discount, lower the client’s rate, or explain it in the notes.';
  else if (toMinor(price) === null) e.unitPrice = 'Use an amount like 150 or 1,250.50.';
  return e;
}
