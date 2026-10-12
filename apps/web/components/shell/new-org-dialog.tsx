'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Field, Input, Select } from '@tallywork/ui';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { CURRENCIES, browserTimeZone, timeZones } from '@/components/settings/options';

/** Create a new organization from inside the app (same request as /welcome), then switch to it. */
export function NewOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const zones = useMemo(() => timeZones(timezone), [timezone]);

  // Start from a clean form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName('');
    setTimezone(browserTimeZone());
    setCurrency('USD');
    setError(null);
    setLoading(false);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ organization_id: string }>('/me/organizations', {
        method: 'POST',
        body: { name: name.trim(), timezone, currency },
      });
      try {
        localStorage.setItem('tw.lastOrg', r.organization_id);
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: ['me'] });
      onOpenChange(false);
      router.push(`/o/${r.organization_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', t('shell.newOrg.error')));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !loading && onOpenChange(o)}
      title={t('shell.newOrg.title')}
      description={t('shell.newOrg.description')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={loading}>
            {t('shell.newOrg.cancel')}
          </Button>
          <Button type="submit" form="new-org-form" variant="primary" loading={loading} disabled={!name.trim()}>
            {t('shell.newOrg.create')}
          </Button>
        </>
      }
    >
      <form id="new-org-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t('shell.newOrg.name')} htmlFor="new-org-name" error={error?.field('name')} required>
          <Input id="new-org-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" autoFocus />
        </Field>
        <Field label={t('shell.newOrg.timezone')} htmlFor="new-org-tz" hint={t('shell.newOrg.timezoneHint')} error={error?.field('timezone')}>
          <Select id="new-org-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('shell.newOrg.currency')} htmlFor="new-org-cur" hint={t('shell.newOrg.currencyHint')} error={error?.field('currency')}>
          <Select id="new-org-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {error && !error.errors?.length && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {error.title}
          </p>
        )}
      </form>
    </Dialog>
  );
}
