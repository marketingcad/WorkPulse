'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type { MeDto } from '@tallywork/contracts';
import { Button, Logo } from '@tallywork/ui';
import { ApiError, api } from '@/lib/api';
import { TwoFactorPanel } from './two-factor-panel';

export const isMfaEnrollmentError = (e: unknown) => e instanceof ApiError && e.code === 'mfa_enrollment_required';

/**
 * Full-page state while an organization requires two-factor and this session has not verified it.
 * Every /orgs/:orgId request (including the organization context) is refused, so the profile route
 * shows the two-factor panel here instead of the normal profile page.
 */
export function MfaEnrollmentRequired({ orgId, onEnrolled }: { orgId: string; onEnrolled: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = `/o/${orgId}/me/profile`;
  const onProfile = pathname === profile;
  const meQ = useQuery<MeDto, ApiError>({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const orgName = meQ.data?.organizations.find((o) => o.id === orgId)?.name;
  const others = (meQ.data?.organizations ?? []).filter((o) => o.id !== orgId);

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-5">
        <Logo size={30} className="text-[#0f2240] dark:text-white" />
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-1 size-6 shrink-0 text-warning" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Your organization requires two-factor authentication</h1>
            <p className="mt-1 text-sm text-text-muted">
              {orgName ? `${orgName} asks` : 'This organization asks'} everyone it applies to for a code from an authenticator app when signing in. Turn it on for your account to continue.
              {meQ.data?.user.mfa_enabled && ' Two-factor is already on for your account: sign out and sign in again with a code.'}
            </p>
          </div>
        </div>
        {onProfile ? (
          <TwoFactorPanel requiredByOrg onDone={onEnrolled} />
        ) : (
          <div>
            <Button variant="primary" size="md" onClick={() => router.push(`${profile}#two-factor`)}>
              Set up two-factor authentication
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-sm">
          {others.map((o) => (
            <a key={o.id} href={`/o/${o.id}`} className="text-interactive hover:underline">
              Go to {o.name}
            </a>
          ))}
          <button
            type="button"
            className="text-text-muted hover:text-text hover:underline"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
