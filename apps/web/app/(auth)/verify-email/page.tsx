'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, errorMessage } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    api('/auth/verify-email', { body: { token } })
      .then(() => setState({ ok: true, msg: 'Your email is confirmed.' }))
      .catch((e) => setState({ ok: false, msg: errorMessage(e) }));
  }, [token]);
  if (!state) return <Spinner />;
  return (
    <p className={`rounded-sm px-3 py-2 text-sm ${state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
      {state.msg}{' '}
      <Link href="/" className="font-medium underline">
        Continue
      </Link>
    </p>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Confirm your email">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
