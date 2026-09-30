'use client';
import { useEffect, useState } from 'react';
import type { ClientDto } from '@tallywork/contracts';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, cx, useToast } from '@tallywork/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ColorPicker, useOrgAction } from '@/components/workspace/shared';
import { fromMinor, toMinor } from '@/components/finance/types';
import { CURRENCIES, LANGUAGES, LogoEditor } from '@/components/workspace/logo-editor';

/** Create or edit a client. `onSaved` receives the saved client (e.g. to select it in a picker). */
export function ClientDialog({ client, open, onOpenChange, onSaved }: { client: ClientDto | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (c: ClientDto) => void }) {
  const org = useOrg();
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
  });
  const [f, setF] = useState(() => initial(client));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(initial(client));
    setOpenCount((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const rateField = (key: 'pay_rate' | 'bill_rate', field: 'pay_rate_minor' | 'bill_rate_minor') => {
    if (!canManageRates || f[key] === initial(client)[key]) return {};
    if (!f[key].trim()) return { [field]: null };
    const minor = toMinor(f[key]);
    if (minor === null) throw new ApiError(422, 'validation', 'Enter a valid amount', undefined, [{ field, message: 'Enter an amount like 75 or 75.50' }]);
    return { [field]: minor };
  };

  const save = async () => {
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
      };
      const saved = client ? await run<ClientDto>('PATCH', `/clients/${client.id}`, body) : await run<ClientDto>('POST', '/clients', body);
      const wasActive = client ? !client.archived_at : true;
      if (f.active !== wasActive) await run('POST', `/clients/${saved.id}/${f.active ? 'restore' : 'archive'}`);
      toast.success(client ? 'Client updated' : 'Client created');
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
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
            {client ? 'Save client' : 'Create client'}
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
                </>
              )}
            </div>
            {canReadRates && <p className="text-xs text-text-muted sm:col-span-2">Client rates apply from today. Project and worker rates still take precedence.</p>}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
