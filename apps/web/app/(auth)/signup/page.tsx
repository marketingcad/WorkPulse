'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organization_name: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await api<{ organization_id: string }>('/auth/signup', {
        body: { ...form, organization_name: form.organization_name || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      router.replace(`/o/${r.organization_id}?welcome=1`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(500, 'error', 'Could not create your account'));
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your organization"
      subtitle="Start tracking time with your team in minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-interactive hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Your name" htmlFor="name" error={err?.field('name')}>
          <Input id="name" autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Work email" htmlFor="email" error={err?.field('email')}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={err?.field('password')}>
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={10} />
        </Field>
        <Field label="Organization name" htmlFor="org" hint="You can change this later.">
          <Input id="org" value={form.organization_name} onChange={set('organization_name')} placeholder="Acme Studio" />
        </Field>
        {err && !err.errors && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
          Create organization
        </Button>
        <p className="text-xs text-text-faint">Monitoring features stay off until you enable them, and your team is always told what is tracked.</p>
      </form>
    </AuthShell>
  );
}
