'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '@tallywork/ui';
import type { MeDto } from '@tallywork/contracts';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api<MeDto>('/auth/login', { body: { email, password } });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : me.organizations[0] ? `/o/${me.organizations[0].id}` : '/welcome');
    } catch (err) {
      setError(err instanceof ApiError ? err.title : 'Could not sign in');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Work email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-interactive hover:underline">
          Forgot password?
        </Link>
      </div>
      <div className="rounded-sm border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        Demo workspace: <span className="font-mono">admin@demo.tallywork.app</span> / <span className="font-mono">demo-password-123</span>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Pick up where you left off."
      footer={
        <>
          New to Tallywork?{' '}
          <Link href="/signup" className="font-medium text-interactive hover:underline">
            Create an organization
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
