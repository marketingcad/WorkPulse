'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { MeDto } from '@tallywork/contracts';
import { Button, Field, Input, Select } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiError, api } from '@/lib/api';
import { CURRENCIES, browserTimeZone, timeZones } from '@/components/settings/options';

export default function WelcomePage() {
  const router = useRouter();
  const meQ = useQuery<MeDto, ApiError>({ queryKey: ['me'], queryFn: () => api<MeDto>('/me'), retry: false });
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => setTimezone(browserTimeZone()), []);
  const zones = useMemo(() => timeZones(timezone), [timezone]);
  const orgs = meQ.data?.organizations ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ organization_id: string }>('/me/organizations', { method: 'POST', body: { name: name.trim(), timezone, currency } });
      try {
        localStorage.setItem('tw.lastOrg', r.organization_id);
      } catch {
        /* ignore */
      }
      router.replace(`/o/${r.organization_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Could not create the organization'));
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={orgs.length ? 'Create another organization' : 'Set up your organization'}
      subtitle={meQ.data ? `Signed in as ${meQ.data.user.email}. You will be the owner and first admin.` : 'You will be the owner and first admin.'}
      footer={
        orgs.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span>Or open an existing organization:</span>
            {orgs.map((o) => (
              <Link key={o.id} href={`/o/${o.id}`} className="font-medium text-interactive hover:underline">
                {o.name} <span className="font-normal text-text-muted">· {o.role_name}</span>
              </Link>
            ))}
          </div>
        ) : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Organization name" htmlFor="org-name" error={error?.field('name')} required>
          <Input id="org-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" autoFocus />
        </Field>
        <Field label="Time zone" htmlFor="org-tz" hint="Defines days, weeks and pay periods. You can change it later." error={error?.field('timezone')}>
          <Select id="org-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="org-cur" hint="Used for rates, invoices and reports." error={error?.field('currency')}>
          <Select id="org-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
        <Button type="submit" variant="primary" size="md" loading={loading} disabled={!name.trim()} className="w-full">
          Create organization
        </Button>
      </form>
    </AuthShell>
  );
}
