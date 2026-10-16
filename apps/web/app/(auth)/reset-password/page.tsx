'use client';
import { Lock } from 'lucide-react';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Field } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'done')
    return (
      <p className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">
        {t('auth.reset.done')}{' '}
        <Link href="/login" className="font-medium underline">
          {t('auth.signIn')}
        </Link>
      </p>
    );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('loading');
        setError(null);
        try {
          await api('/auth/password/reset', { body: { token, password } });
          setState('done');
        } catch (err) {
          setError(errorMessage(err));
          setState('idle');
        }
      }}
    >
      <Field label={t('auth.reset.newPassword')} htmlFor="pw" hint={t('auth.passwordHint')} error={error}>
        <AuthInput icon={Lock} id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoFocus />
      </Field>
      <Button type="submit" variant="primary" size="md" loading={state === 'loading'}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title={t('auth.reset.title')}>
      <Suspense>
        <Form />
      </Suspense>
    </AuthShell>
  );
}
