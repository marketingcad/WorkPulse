'use client';
import { Lock, User } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
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
          const r = await api<{ organization_id: string; role_key: string | null }>('/auth/invitations/accept', { body: { token, name: name || undefined, password: password || undefined } });
          // Workers use the desktop app only, so they go to its download page instead of the web workspace.
          router.replace(r.role_key === 'WORKER' ? '/download?welcome=1' : `/o/${r.organization_id}?welcome=1`);
        } catch (err) {
          const e2 = err instanceof ApiError ? err : new ApiError(500, 'error', t('auth.invite.failed'));
          if (e2.code === 'login_required') {
            router.replace(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`);
            return;
          }
          setError(e2);
          setLoading(false);
        }
      }}
    >
      <Field label={t('auth.yourName')} htmlFor="name">
        <AuthInput icon={User} id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      </Field>
      <Field label={t('auth.invite.choosePassword')} htmlFor="pw" hint={t('auth.invite.passwordHint')}>
        <AuthInput icon={Lock} id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error.title}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading}>
        {t('auth.invite.submit')}
      </Button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <AuthShell title={t('auth.invite.title')} subtitle={t('auth.invite.subtitle')}>
      <Suspense>
        <Form />
      </Suspense>
    </AuthShell>
  );
}
