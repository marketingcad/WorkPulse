'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    api('/auth/verify-email', { body: { token } })
      .then(() => setState({ ok: true, msg: t('auth.verify.confirmed') }))
      .catch((e) => setState({ ok: false, msg: errorMessage(e) }));
  }, [token]);
  if (!state) return <Spinner />;
  return (
    <p className={`rounded-sm px-3 py-2 text-sm ${state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
      {state.msg}{' '}
      <Link href="/" className="font-medium underline">
        {t('auth.verify.continue')}
      </Link>
    </p>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title={t('auth.verify.title')}>
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
