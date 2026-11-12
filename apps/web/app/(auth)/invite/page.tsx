'use client';
import { Lock, User } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Spinner } from '@tallywork/ui';
import { AuthInput, AuthShell } from '@/components/auth-shell';
import { api, ApiError } from '@/lib/api';
import { passwordProblem } from '@/lib/form-checks';
import { t } from '@/lib/i18n';

/** What the join page may know before accepting (POST /auth/invitations/peek). */
interface InvitationPeek {
  name: string | null;
  organization_name: string;
  has_account: boolean;
}

/**
 * QA audit 11 Nov 2026 (BUG-10): the page asked for a name the inviter had already entered, sent a
 * too-short password to the server to find out, and showed "invalid or expired" or "sign in first"
 * only after it was filled in. It now reads the invitation first: the name is filled in, an unusable
 * link says so straight away, someone with an account is told to sign in, and the password is checked
 * here with the server's own rule.
 */
function Form({ onOrganization }: { onOrganization: (name: string) => void }) {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [peek, setPeek] = useState<InvitationPeek | null>(null);
  const [unusable, setUnusable] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const signInHref = `/login?next=${encodeURIComponent(`/invite?token=${token}`)}`;

  useEffect(() => {
    let live = true;
    api<InvitationPeek>('/auth/invitations/peek', { body: { token } })
      .then((p) => {
        if (!live) return;
        setPeek(p);
        onOrganization(p.organization_name);
        // Only fills an empty field: never overwrites what the person has typed meanwhile.
        if (p.name) setName((cur) => cur || p.name!);
      })
      .catch((e) => {
        if (!live) return;
        // An invalid, expired or replaced link: nothing to fill in. Other failures (network) leave the
        // form usable, and accepting reports its own error.
        if (e instanceof ApiError && (e.code === 'invalid_invitation' || e.status === 400)) setUnusable(true);
        else setPeek({ name: null, organization_name: '', has_account: false });
      });
    return () => {
      live = false;
    };
  }, [token, onOrganization]);

  if (unusable) {
    return (
      <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
        {t('auth.invite.invalid')}
      </p>
    );
  }
  if (!peek) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
        <Spinner /> {t('auth.invite.checking')}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!peek.has_account) {
          const problem = passwordProblem(password);
          if (problem) {
            setPasswordError(problem);
            return;
          }
        }
        setPasswordError(null);
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ organization_id: string; role_key: string | null }>('/auth/invitations/accept', { body: { token, name: name.trim() || undefined, password: password || undefined } });
          // Workers use the desktop app only, so they go to its download page instead of the web workspace.
          router.replace(r.role_key === 'WORKER' ? '/download?welcome=1' : `/o/${r.organization_id}?welcome=1`);
        } catch (err) {
          const e2 = err instanceof ApiError ? err : new ApiError(500, 'error', t('auth.invite.failed'));
          if (e2.code === 'login_required') {
            router.replace(signInHref);
            return;
          }
          setError(e2);
          setLoading(false);
        }
      }}
    >
      {peek.has_account ? (
        <p role="status" className="rounded-sm bg-surface-muted px-3 py-2 text-sm text-text">
          {t('auth.invite.hasAccount')}{' '}
          <Link href={signInHref} className="font-medium text-interactive hover:underline">
            {t('auth.invite.signIn')}
          </Link>
        </p>
      ) : (
        <>
          <Field label={t('auth.yourName')} htmlFor="name">
            <AuthInput icon={User} id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
          </Field>
          <Field label={t('auth.invite.choosePassword')} htmlFor="pw" hint={passwordError ? undefined : t('auth.invite.passwordHintNew')} error={passwordError ?? error?.field('password') ?? undefined}>
            <AuthInput
              icon={Lock}
              id="pw"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(null);
              }}
              autoComplete="new-password"
              aria-invalid={!!passwordError}
            />
          </Field>
        </>
      )}
      {error && !error.field('password') && (
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
  const [organization, setOrganization] = useState('');
  return (
    <AuthShell title={t('auth.invite.title')} subtitle={organization ? t('auth.invite.subtitleOrg', { org: organization }) : t('auth.invite.subtitle')}>
      <Suspense>
        <Form onOrganization={setOrganization} />
      </Suspense>
    </AuthShell>
  );
}
