'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={
        <Link href="/login" className="text-interactive hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            await api('/auth/password/forgot', { body: { email } }).catch(() => undefined);
            setSent(true);
          }}
        >
          <Field label="Work email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="md" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
