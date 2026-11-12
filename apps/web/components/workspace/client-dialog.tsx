'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientDto } from '@tallywork/contracts';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, cx, useToast } from '@tallywork/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { useRatePricingConfirm } from '@/components/finance/rate-pricing-confirm';
import { previewRatesFromBody } from '@/components/finance/rate-pricing';
import { ColorPicker, useOrgAction } from './basics';
import { RateNote, RateStartField } from '@/components/finance/rate-note';
import { fromMinor, toMinor } from '@/components/finance/types';
import { CURRENCIES, LANGUAGES, LogoEditor } from '@/components/workspace/logo-editor';

/** Create or edit a client. `onSaved` receives the saved client (e.g. to select it in a picker). */
export function ClientDialog({ client, open, onOpenChange, onSaved }: { client: ClientDto | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (c: ClientDto) => void }) {
  const org = useOrg();
  const router = useRouter();
  const run = useOrgAction();
  const toast = useToast();
  const canReadRates = org.can('rates:read');
  const canManageRates = org.can('rates:manage');
  const initial = (c: ClientDto | null) => ({
    name: c?.name ?? '',
    active: c ? !c.archived_at : true,
    color: c?.color ?? '',
    logo: c?.logo ?? '',
    contact_name: c?.contact_name ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    address: c?.address ?? '',
    document_language: c ? (c.document_language ?? '') : (org.organization.document_language ?? 'en'),
    currency: c?.currency ?? '',
    notes: c?.notes ?? '',
    pay_rate: c?.pay_rate_minor != null ? fromMinor(c.pay_rate_minor) : '',
    bill_rate: c?.bill_rate_minor != null ? fromMinor(c.bill_rate_minor) : '',
    /** first day the rates apply; '' = today */
    rates_from: '',
  });
  const [f, setF] = useState(() => initial(client));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // Set synchronously: two quick Enter presses both run before `busy` re-renders.
  const saving = useRef(false);
  // A new client saved by an earlier attempt (e.g. created, then archiving failed): a retry updates it.
  const created = useRef<ClientDto | null>(null);
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    created.current = null;
    setErr(null);
    setF(initial(client));
    setOpenCount((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const rateField = (key: 'pay_rate' | 'bill_rate', field: 'pay_rate_minor' | 'bill_rate_minor') => {
    // A start date sends the rates with it, so an unchanged amount can be moved to an earlier day.
    if (!canManageRates || (f[key] === initial(client)[key] && !(f.rates_from && f[key].trim()))) return {};
    if (!f[key].trim()) return { [field]: null };
    const minor = toMinor(f[key]);
    if (minor === null) throw new ApiError(422, 'validation', 'Enter a valid amount', undefined, [{ field, message: 'Enter an amount like 75 or 75.50' }]);
    return { [field]: minor };
  };

  const pricing = useRatePricingConfirm();

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: f.name,
        email: f.email.trim() || null,
        phone: f.phone || null,
        address: f.address || null,
        currency: f.currency || null,
        notes: f.notes || null,
        contact_name: f.contact_name.trim() || null,
        document_language: f.document_language || null,
        color: f.color || null,
        logo: f.logo || null,
        ...rateField('pay_rate', 'pay_rate_minor'),
        ...rateField('bill_rate', 'bill_rate_minor'),
        ...(canManageRates && f.rates_from ? { rate_effective_from: f.rates_from } : {}),
      };
      const existing = client ?? created.current;
      // Rates that would price approved time with no rate are confirmed first (BUG-08); a new client has none.
      if (!(await pricing.confirm(previewRatesFromBody(body, { scope: 'CLIENT', scopeId: existing?.id ?? null }, f.currency || org.organization.currency, todayIn(org.organization.timezone))))) return;
      const saved = existing ? await run<ClientDto>('PATCH', `/clients/${existing.id}`, body) : await run<ClientDto>('POST', '/clients', body);
      if (!client) created.current = saved;
      const wasActive = !saved.archived_at;
      if (f.active !== wasActive) await run('POST', `/clients/${saved.id}/${f.active ? 'restore' : 'archive'}`);
      // A new client's next step is its first project (for people who can create one).
      if (!client && org.can('projects:manage') && !saved.archived_at)
        toast.success(`${saved.name} was created. Add its first project so people can track time to it.`, { label: 'Add a project', onClick: () => router.push(`${org.base}/projects?client=${saved.id}&new=1`) });
      else toast.success(client ? 'Client updated' : 'Client created');
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const currencies = f.currency && !CURRENCIES.includes(f.currency) ? [f.currency, ...CURRENCIES] : CURRENCIES;
  const rateCurrency = f.currency || org.organization.currency;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={client ? 'Edit client' : 'New client'}
      width={720}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>
            {client && !client.archived_at && !f.active ? 'Archive client and its projects' : client ? 'Save client' : 'Create client'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void save();
        }}
      >
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Field label="Company / client name" htmlFor="cl-name" required error={err?.field('name')} className="min-w-48 flex-1">
            <Input id="cl-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={150} />
          </Field>
          <Checkbox label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-8" />
        </div>
        {/* Unticking Active archives the client and its projects: say so before Save does it. */}
        {client && !client.archived_at && !f.active && (
          <p role="alert" className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">
            Saving archives {client.name} and its {client.project_count === 1 ? 'project' : `${client.project_count} projects`}: no one can track time to them. Their time is kept, and restoring the client brings the projects back.
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[132px_1fr]">
          <div className="flex flex-col gap-4">
            <LogoEditor key={openCount} label="Client logo" value={f.logo} onChange={(logo) => setF((s) => ({ ...s, logo }))} name={f.name} color={f.color} error={err?.field('logo')} />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Colour</span>
              <ColorPicker label="Client colour" value={f.color} onChange={(color) => setF({ ...f, color })} />
            </div>
          </div>

          <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
            <Field label="Contact person" htmlFor="cl-contact" error={err?.field('contact_name')}>
              <Input id="cl-contact" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} maxLength={150} />
            </Field>
            <Field label="Contact email" htmlFor="cl-email" error={err?.field('email')}>
              <Input id="cl-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="billing@client.com" />
            </Field>
            <Field label="Phone number" htmlFor="cl-phone" error={err?.field('phone')}>
              <Input id="cl-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={50} />
            </Field>
            <Field label="Document language" htmlFor="cl-lang" error={err?.field('document_language')}>
              <Select id="cl-lang" value={f.document_language} onChange={(e) => setF({ ...f, document_language: e.target.value })}>
                <option value="">Not set</option>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Address" htmlFor="cl-address" error={err?.field('address')} className="sm:col-span-2">
              <Textarea id="cl-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={500} className="min-h-16" />
            </Field>
            <Field label="Notes" htmlFor="cl-notes" error={err?.field('notes')} className="sm:col-span-2">
              <Textarea id="cl-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} className="min-h-16" />
            </Field>

            <div className={cx('grid grid-cols-1 gap-3 sm:col-span-2', canReadRates && 'sm:grid-cols-3')}>
              <Field label="Currency" htmlFor="cl-currency" error={err?.field('currency')}>
                <Select id="cl-currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} className="tabular">
                  <option value="">{org.organization.currency} (workspace default)</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              {canReadRates && (
                <>
                  <Field label="Pay rate per hour" htmlFor="cl-pay" hint={`${rateCurrency} / hour, what you pay`} error={err?.field('pay_rate_minor')}>
                    <Input id="cl-pay" inputMode="decimal" value={f.pay_rate} disabled={!canManageRates} onChange={(e) => setF({ ...f, pay_rate: e.target.value })} placeholder="0.00" className="tabular" />
                  </Field>
                  <Field label="Bill rate per hour" htmlFor="cl-bill" hint={`${rateCurrency} / hour, what you charge`} error={err?.field('bill_rate_minor')}>
                    <Input id="cl-bill" inputMode="decimal" value={f.bill_rate} disabled={!canManageRates} onChange={(e) => setF({ ...f, bill_rate: e.target.value })} placeholder="0.00" className="tabular" />
                  </Field>
                  {canManageRates && <RateStartField id="cl-rates-from" value={f.rates_from} onChange={(rates_from) => setF({ ...f, rates_from })} emptyMeans="today" error={err?.field('rate_effective_from')} />}
                </>
              )}
            </div>
            {canReadRates && <RateNote scope="CLIENT" className="sm:col-span-2" />}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
      {pricing.dialog}
    </Dialog>
  );
}
