'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ClientDto } from '@tallywork/contracts';
import { Button, Dialog, Field, Input, Select, fmtDate, fmtMoney, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { PAYMENT_METHODS, fromMinor, toMinor, type InvoiceRow, type PaymentRow } from './types';

interface Body {
  client_id: string | null;
  amount_minor: number;
  currency: string;
  received_on: string;
  provider: string;
  provider_ref: string | null;
  note: string | null;
  allocations: Array<{ invoice_id: string; amount_minor: number }>;
}

const isOpen = (i: InvoiceRow) => i.status !== 'DRAFT' && i.status !== 'VOID' && i.balance_minor > 0;

/**
 * Record a payment. With `invoice`, the whole payment is allocated to that invoice.
 * Without it, the user picks a client and splits the payment across that client's open invoices.
 */
export function RecordPaymentDialog({ open, onOpenChange, invoice }: { open: boolean; onOpenChange: (o: boolean) => void; invoice?: InvoiceRow }) {
  const org = useOrg();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [method, setMethod] = useState('manual');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiError | null>(null);

  const clientsQ = useOrgQuery<ClientDto[]>(open && !invoice ? '/clients' : null);
  // Only the client's open invoices, filtered by the server (not the newest 1000 of all their invoices).
  const invoicesQ = useOrgQuery<InvoiceRow[]>(open && !invoice && clientId ? `/invoices${qs({ client_id: clientId, status: 'OPEN' })}` : null);
  // Oldest first: by due date, then issue date, then invoice number (invoices due the same day are
  // otherwise paid newest first).
  const openInvoices = useMemo(
    () => (invoicesQ.data ?? []).filter(isOpen).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.issue_date.localeCompare(b.issue_date) || a.number.localeCompare(b.number, undefined, { numeric: true })),
    [invoicesQ.data],
  );
  // The client's billing currency when it has no open invoice (FE-B7: not the organization's by default).
  const clientCurrency = clientsQ.data?.find((c) => c.id === clientId)?.currency;
  const currency = invoice?.currency ?? openInvoices[0]?.currency ?? clientCurrency ?? org.organization.currency;
  const payable = openInvoices.filter((i) => i.currency === currency);

  // Depend on primitives so a background refetch of the invoice does not reset the form.
  const invClient = invoice?.client_id;
  const invBalance = invoice?.balance_minor;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setReceivedOn(todayIn(org.organization.timezone));
    setMethod('manual');
    setReference('');
    setNote('');
    setAlloc({});
    setClientId(invClient ?? '');
    setAmount(invBalance !== undefined ? fromMinor(invBalance) : '');
  }, [open, invClient, invBalance, org.organization.timezone]);

  const m = useOrgMutation<Body, PaymentRow>('POST', '/payments');

  const autoAllocate = () => {
    let left = toMinor(amount) ?? 0;
    const next: Record<string, string> = {};
    for (const i of payable) {
      if (left <= 0) break;
      const a = Math.min(left, i.balance_minor);
      next[i.id] = fromMinor(a);
      left -= a;
    }
    setAlloc(next);
  };

  const allocations = invoice
    ? [{ invoice_id: invoice.id, amount_minor: toMinor(amount) ?? 0 }]
    : payable.map((i) => ({ invoice_id: i.id, amount_minor: toMinor(alloc[i.id] ?? '') ?? 0 })).filter((a) => a.amount_minor > 0);
  const allocated = allocations.reduce((s, a) => s + a.amount_minor, 0);
  const amountMinor = toMinor(amount);
  const overAllocated = amountMinor !== null && allocated > amountMinor;

  const submit = async () => {
    setErr(null);
    if (!amountMinor || amountMinor < 1) {
      setErr(new ApiError(422, 'validation', 'Enter an amount', undefined, [{ field: 'amount_minor', message: 'Enter an amount greater than zero' }]));
      return;
    }
    try {
      await m.mutateAsync({
        client_id: invoice?.client_id ?? (clientId || null),
        amount_minor: amountMinor,
        currency,
        received_on: receivedOn,
        provider: method,
        provider_ref: reference.trim() || null,
        note: note.trim() || null,
        allocations,
      });
      toast.success('Payment recorded');
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description={invoice ? `Applied to invoice ${invoice.number} · balance ${fmtMoney(invoice.balance_minor, invoice.currency)}` : 'Record money received and apply it to open invoices.'}
      width={invoice ? 480 : 620}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending} disabled={overAllocated}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!invoice && (
          <Field label="Client" htmlFor="pay-client" className="sm:col-span-2">
            <Select id="pay-client" value={clientId} onChange={(e) => (setClientId(e.target.value), setAlloc({}))}>
              <option value="">No client (unallocated)</option>
              {clientsQ.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={`Amount (${currency})`} htmlFor="pay-amount" required error={err?.field('amount_minor')}>
          <Input id="pay-amount" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Received on" htmlFor="pay-date" required error={err?.field('received_on')}>
          <Input id="pay-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="pay-ref" hint="Transfer ID, check number…" error={err?.field('provider_ref')}>
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Note" htmlFor="pay-note" className="sm:col-span-2" error={err?.field('note')}>
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>

      {!invoice && clientId && (
        <div className="mt-4 rounded-sm border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted/60 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Allocate to open invoices</span>
            <Button size="xs" variant="ghost" onClick={autoAllocate} disabled={!payable.length || !amountMinor}>
              Oldest first
            </Button>
          </div>
          {invoicesQ.isLoading ? (
            <p className="px-3 py-3 text-sm text-text-muted">Loading invoices…</p>
          ) : payable.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-muted">This client has no open invoices in {currency}. The payment will be recorded unallocated.</p>
          ) : (
            <ul className="divide-y divide-border">
              {payable.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.number}</div>
                    <div className="text-xs text-text-muted">
                      Due {fmtDate(i.due_date)} · balance <span className="tabular">{fmtMoney(i.balance_minor, i.currency)}</span>
                    </div>
                  </div>
                  <Input
                    aria-label={`Amount for ${i.number}`}
                    inputMode="decimal"
                    className="tabular w-28 text-right"
                    placeholder="0.00"
                    value={alloc[i.id] ?? ''}
                    onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t border-border px-3 py-2 text-xs">
            <span className="text-text-muted">Allocated</span>
            <span className={overAllocated ? 'tabular font-semibold text-danger' : 'tabular font-semibold'}>
              {fmtMoney(allocated, currency)} of {fmtMoney(amountMinor ?? 0, currency)}
            </span>
          </div>
          {overAllocated && (
            <p role="alert" className="px-3 pb-2 text-xs text-danger">
              Allocations exceed the payment amount.
            </p>
          )}
        </div>
      )}
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
