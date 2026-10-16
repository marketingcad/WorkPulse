'use client';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Field } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  return (
    <AuthShell
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link href="/login" className="text-interactive hover:underline">
          {t('auth.forgot.back')}
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">{t('auth.forgot.sent', { email })}</p>
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
          <Field label={t('auth.workEmail')} htmlFor="email">
            <AuthInput icon={Mail} id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="md" loading={loading}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
