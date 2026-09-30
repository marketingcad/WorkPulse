'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '@tallywork/ui';
import type { MeDto } from '@tallywork/contracts';
import { AuthShell } from '@/components/auth-shell';
import { CheckEmail } from '@/components/check-email';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Accounts with two-factor get a second step after the password.
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [unverified, setUnverified] = useState(false);

  function finish(me: MeDto) {
    const next = params.get('next');
    let last: string | null = null;
    try {
      last = localStorage.getItem('tw.lastOrg');
    } catch {
      /* ignore */
    }
    const org = me.organizations.find((o) => o.id === last) ?? me.organizations[0];
    // Client viewers have no organization of their own: they go to their dashboards.
    const fallback = org ? `/o/${org.id}` : me.client_portals?.length ? (me.client_portals.length === 1 ? `/portal/${me.client_portals[0]!.access_id}` : '/portal') : '/welcome';
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : fallback);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<MeDto | { mfa_required: true }>('/auth/login', { body: { email, password } });
      if ('mfa_required' in r) {
        setStep('code');
        setPassword('');
        setLoading(false);
        return;
      }
      finish(r);
    } catch (err) {
      setUnverified(err instanceof ApiError && err.code === 'email_not_verified');
      setError(err instanceof ApiError ? err.title : t('auth.login.failed'));
      setLoading(false);
    }
  }

  if (unverified)
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
        <CheckEmail email={email} />
        <button type="button" className="text-sm text-interactive hover:underline" onClick={() => setUnverified(false)}>
          {t('auth.mfa.back')}
        </button>
      </div>
    );

  if (step === 'code')
    return (
      <CodeStep
        email={email}
        onVerified={finish}
        onRestart={(message) => {
          setStep('password');
          setError(message ?? null);
        }}
      />
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t('auth.workEmail')} htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={t('auth.password')} htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
        {t('auth.signIn')}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-interactive hover:underline">
          {t('auth.login.forgot')}
        </Link>
      </div>
      <div className="rounded-sm border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        {t('auth.login.demo')} <span className="font-mono">admin@demo.tallywork.app</span> / <span className="font-mono">demo-password-123</span>
      </div>
    </form>
  );
}

/** Second sign-in step: a 6-digit authenticator code, or a one-time recovery code. */
function CodeStep({ email, onVerified, onRestart }: { email: string; onVerified: (me: MeDto) => void; onRestart: (message?: string) => void }) {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ready = recovery ? code.trim().length >= 6 : code.length === 6;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      onVerified(await api<MeDto>('/auth/mfa/verify', { body: { code: code.trim() } }));
    } catch (err) {
      setLoading(false);
      // The short pending session expired or was signed out: start again with the password.
      if (err instanceof ApiError && err.status === 401 && err.code !== 'invalid_mfa_code') return onRestart(err.title);
      setError(err instanceof ApiError ? err.title : t('auth.mfa.failed'));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-text-muted">
        {recovery ? t('auth.mfa.recoveryIntro') : t('auth.mfa.appIntro')}
        <span className="mt-1 block text-xs text-text-faint">{t('auth.mfa.signingInAs', { email })}</span>
      </p>
      {recovery ? (
        <Field label={t('auth.mfa.recoveryCode')} htmlFor="mfa-code">
          <Input id="mfa-code" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxx-xxxx" className="font-mono" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} autoFocus />
        </Field>
      ) : (
        <Field label={t('auth.mfa.code')} htmlFor="mfa-code">
          <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="123456" className="tabular text-lg tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
        </Field>
      )}
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading} disabled={!ready} className="w-full">
        {t('auth.mfa.verify')}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-interactive hover:underline"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
        </button>
        <button
          type="button"
          className="text-text-muted hover:text-text hover:underline"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
            onRestart();
          }}
        >
          {t('auth.mfa.back')}
        </button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.newTo')}{' '}
          <Link href="/signup" className="font-medium text-interactive hover:underline">
            {t('auth.login.createOrg')}
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
