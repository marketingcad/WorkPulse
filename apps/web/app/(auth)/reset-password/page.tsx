'use client';
import { Lock } from 'lucide-react';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Field } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
import { api, ApiError, errorMessage } from '@/lib/api';
import { confirmPasswordProblem, formErrors, passwordProblem } from '@/lib/form-checks';
import { t } from '@/lib/i18n';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [err, setErr] = useState<ApiError | null>(null);
  if (state === 'done')
    return (
      <p className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">
        {t('auth.reset.done')}{' '}
        <Link href="/login" className="font-medium underline">
          {t('auth.signIn')}
        </Link>
      </p>
    );
  // Only a problem with the password goes under the field; an invalid or expired link is said above the
  // button (form validation audit, 20 Nov 2026: every error was shown as if the password were wrong).
  const general = err?.general(['password', 'confirm_password']);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (state === 'loading') return;
        const problems: Array<{ field: string; message: string }> = [];
        const pw = passwordProblem(password);
        if (pw) problems.push({ field: 'password', message: pw });
        else {
          const mismatch = confirmPasswordProblem(password, confirm);
          if (mismatch) problems.push({ field: 'confirm_password', message: mismatch });
        }
        if (problems.length) return setErr(formErrors(problems));
        setState('loading');
        setErr(null);
        try {
          await api('/auth/password/reset', { body: { token, password } });
          setState('done');
        } catch (e2) {
          setErr(e2 instanceof ApiError ? e2 : new ApiError(500, 'error', errorMessage(e2)));
          setState('idle');
        }
      }}
    >
      <Field label={t('auth.reset.newPassword')} htmlFor="pw" hint={t('auth.passwordHint')} error={err?.field('password')} required>
        <AuthInput icon={Lock} id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} maxLength={200} required autoFocus />
      </Field>
      <Field label={t('auth.confirmPassword')} htmlFor="pw-confirm" error={err?.field('confirm_password')} required>
        <AuthInput icon={Lock} id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} required />
      </Field>
      {general && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {general}
        </p>
      )}
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
