'use client';
import { useState } from 'react';
import { Button } from '@tallywork/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

/** Shown while an account waits for its email to be confirmed, with a way to send the link again. */
export function CheckEmail({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function resend() {
    setState('sending');
    try {
      await api('/auth/verify-email/resend', { body: { email } });
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">{t('auth.verify.checkBody', { email })}</p>
      <p className="text-sm text-text-muted">{t('auth.verify.checkSpam')}</p>
      {state === 'sent' && (
        <p role="status" className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">
          {t('auth.verify.resent')}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {t('auth.login.failed')}
        </p>
      )}
      <Button type="button" variant="secondary" size="md" loading={state === 'sending'} onClick={resend} className="w-full">
        {t('auth.verify.resend')}
      </Button>
    </div>
  );
}
