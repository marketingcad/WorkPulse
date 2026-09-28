'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

// A token works once, so a repeated effect run (React Strict Mode in dev) must reuse the first request.
const pending = new Map<string, Promise<{ signed_in?: boolean }>>();
function verifyOnce(token: string) {
  let p = pending.get(token);
  if (!p) pending.set(token, (p = api<{ signed_in?: boolean }>('/auth/verify-email', { body: { token } })));
  return p;
}

function Verify() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    verifyOnce(token)
      .then((r) => {
        setState({ ok: true, msg: t('auth.verify.confirmed') });
        // The link signed the person in: continue straight to their organization.
        if (r.signed_in) router.replace('/');
      })
      .catch((e) => setState({ ok: false, msg: errorMessage(e) }));
  }, [token, router]);
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
