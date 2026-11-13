import { monthRange } from './types';

/** GET /invoices/unbilled: the first and last day of a client's approved time not yet invoiced. */
export interface UnbilledRange {
  from: string | null;
  to: string | null;
}

/**
 * The period a new invoice starts on (QA audit 11 Nov 2026, C-10): the month of the client's latest
 * approved time not yet invoiced. Always defaulting to last month found nothing to invoice when the
 * approved time was this month's. With nothing waiting, last month, as before.
 */
export function suggestedPeriod(unbilled: UnbilledRange | undefined, fallback: { from: string; to: string }): { from: string; to: string } {
  return unbilled?.to ? monthRange(unbilled.to) : fallback;
}

/** Approved, uninvoiced time outside the chosen period, which this invoice would leave out. */
export function unbilledOutside(unbilled: UnbilledRange | undefined, start: string, end: string): boolean {
  return !!unbilled?.from && !!unbilled.to && (unbilled.from < start || unbilled.to > end);
}
