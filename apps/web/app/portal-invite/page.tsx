'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

function Form() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ access_id: string }>('/portal/invitations/accept', { body: { token, name: name || undefined, password: password || undefined } });
          router.replace(`/portal/${r.access_id}`);
        } catch (err) {
          const e2 = err instanceof ApiError ? err : new ApiError(500, 'error', t('auth.invite.failed'));
          if (e2.code === 'login_required') return router.replace(`/login?next=${encodeURIComponent(`/portal-invite?token=${token}`)}`);
          setError(e2);
          setLoading(false);
        }
      }}
    >
      <Field label={t('auth.yourName')} htmlFor="name">
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      </Field>
      <Field label={t('auth.invite.choosePassword')} htmlFor="pw" hint={t('auth.passwordHint')} error={error?.field('password')}>
        <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && !error.errors && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error.title}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading}>
        {t('portal.invite.submit')}
      </Button>
    </form>
  );
}

export default function PortalInvitePage() {
  return (
    <AuthShell title={t('portal.invite.title')} subtitle={t('portal.invite.subtitle')}>
      <Suspense>
        <Form />
      </Suspense>
    </AuthShell>
  );
}
