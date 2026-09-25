/** Local response shapes for finance endpoints (see packages/api/src/services/finance.ts). */

export type RateKind = 'BILL' | 'PAY';
export type RateScope = 'ORG' | 'CLIENT' | 'PROJECT' | 'WORKER' | 'PROJECT_WORKER';

export interface RateRow {
  id: string;
  kind: RateKind;
  scope: RateScope;
  scope_id: string | null;
  amount_minor: number;
  currency: string;
  effective_from: string;
  effective_to: string | null;
}

export interface AmountOwedRow {
  membership_id: string;
  worker_name: string;
  tracked_seconds: number;
  approved_seconds: number;
  approved_amount_minor: number;
  estimated_amount_minor: number;
  currency: string;
}

export type ExpenseStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';

export interface ExpenseRow {
  id: string;
  membership_id: string;
  worker_name: string;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  category: string;
  description: string | null;
  amount_minor: number;
  currency: string;
  spent_on: string;
  receipt_file_id: string | null;
  billable: boolean;
  reimbursable: boolean;
  status: ExpenseStatus;
  invoiced: boolean;
  created_at: string;
}

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID';

export interface InvoiceRow {
  id: string;
  number: string;
  client_id: string;
  client_name: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
}

export interface InvoiceLine {
  id: string;
  kind: 'TIME' | 'EXPENSE' | 'CUSTOM';
  description: string;
  quantity: number;
  unit_price_minor: number;
  tax_rate_bps: number;
  amount_minor: number;
  tax_minor: number;
}

export interface InvoiceDetail extends InvoiceRow {
  notes: string | null;
  sent_at: string | null;
  client: { name: string; email: string | null; address: string | null };
  lines: InvoiceLine[];
  payments: Array<{ payment_id: string; amount_minor: number; received_on: string; provider: string; provider_ref: string | null }>;
}

export interface InvoicePreview {
  client_id: string;
  client_name: string;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  /** approved entries for this client and period billed in another currency (left out) */
  other_currency_entries: number;
  lines: Array<{ kind: 'TIME' | 'EXPENSE' | 'CUSTOM'; description: string; quantity: number; unit_price_minor: number; amount_minor: number; tax_minor: number; entries: number }>;
}

export interface PaymentRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  provider: string;
  provider_ref: string | null;
  amount_minor: number;
  currency: string;
  received_on: string;
  status: string;
  note: string | null;
  allocations: Array<{ invoice_id: string; invoice_number: string; amount_minor: number }>;
}

export const PAYMENT_METHODS = [
  { value: 'manual', label: 'Manual' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'check', label: 'Check' },
] as const;

export function methodLabel(v: string): string {
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;
}

/** Parse a decimal money string ("12.50") into integer minor units; null when invalid. */
export function toMinor(v: string): number | null {
  const t = v.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function fromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function monthRange(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: end };
}
