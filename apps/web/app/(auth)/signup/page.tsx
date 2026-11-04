'use client';
import { Building2, Lock, Mail, User } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
import { CheckEmail } from '@/components/check-email';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organization_name: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const set =(k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const r = await api<{ organization_id: string; verification_required?: boolean }>('/auth/signup', {
        body: { ...form, organization_name: form.organization_name || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      if (r.verification_required) {
        setPendingEmail(form.email);
        setLoading(false);
        return;
      }
      router.replace(`/o/${r.organization_id}?welcome=1`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(500, 'error', t('auth.signup.failed')));
      setLoading(false);
    }
  }

  if (pendingEmail)
    return (
      <AuthShell
        title={t('auth.verify.checkTitle')}
        footer={
          <Link href="/login" className="font-medium text-interactive hover:underline">
            {t('auth.verify.signIn')}
          </Link>
        }
      >
        <CheckEmail email={pendingEmail} />
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-interactive hover:underline">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.yourName')} htmlFor="name" error={err?.field('name')}>
          <AuthInput icon={User} id="name" autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label={t('auth.workEmail')} htmlFor="email" error={err?.field('email')}>
          <AuthInput icon={Mail} id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')} error={err?.field('password')}>
          <AuthInput icon={Lock} id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={10} />
        </Field>
        <Field label={t('auth.signup.orgName')} htmlFor="org" hint={t('auth.signup.orgHint')}>
          <AuthInput icon={Building2} id="org" value={form.organization_name} onChange={set('organization_name')} placeholder={t('auth.signup.orgPlaceholder')} />
        </Field>
        {err?.general(['name', 'email', 'password']) && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.general(['name', 'email', 'password'])}
          </p>
        )}
        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
          {t('auth.signup.submit')}
        </Button>
        <p className="text-xs text-text-faint">{t('auth.signup.monitoringNote')}</p>
      </form>
    </AuthShell>
  );
}
