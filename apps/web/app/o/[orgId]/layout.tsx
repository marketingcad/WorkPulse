'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import type { MeDto, OrgContextDto } from '@tallywork/contracts';
import { ErrorState, Logo, Spinner } from '@tallywork/ui';
import { api } from '@/lib/api';
import { OrgProvider } from '@/lib/org';
import { useAccountLocale } from '@/lib/i18n';
import { AppShell } from '@/components/shell/app-shell';
import { MfaEnrollmentRequired, isMfaEnrollmentError } from '@/components/security/mfa-required';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['org', orgId, 'context'], queryFn: () => api<OrgContextDto>(`/orgs/${orgId}`), staleTime: 60_000 });
  // Dates, numbers and (later) text follow the person's own language setting.
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') }).data;
  useAccountLocale(me?.user.locale);
  // Any org request refused because two-factor is now required (e.g. an admin just turned it on) switches to the enrollment screen.
  const [mfaBlocked, setMfaBlocked] = useState(false);
  useEffect(() => {
    const onEvent = (ev: { type: string; action?: { type: string; error?: unknown } }) => {
      if (ev.type === 'updated' && ev.action?.type === 'error' && isMfaEnrollmentError(ev.action.error)) setMfaBlocked(true);
    };
    const offQueries = qc.getQueryCache().subscribe(onEvent);
    const offMutations = qc.getMutationCache().subscribe(onEvent);
    return () => {
      offQueries();
      offMutations();
    };
  }, [qc]);
  // Workers use Tallywork through the desktop app only; the web workspace is for admins and managers.
  const router = useRouter();
  const desktopOnly = data?.membership.role_key === 'WORKER';
  useEffect(() => {
    if (desktopOnly) router.replace('/download');
  }, [desktopOnly, router]);

  if (mfaBlocked || isMfaEnrollmentError(error))
    return (
      <MfaEnrollmentRequired
        orgId={orgId}
        onEnrolled={() => {
          setMfaBlocked(false);
          void qc.invalidateQueries({ queryKey: ['org', orgId] });
        }}
      />
    );
  if (error)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  if (!data || desktopOnly)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-text-muted">
        <Logo size={36} className="text-[#0f2240] dark:text-white" />
        <Spinner />
      </div>
    );
  return (
    <OrgProvider value={data}>
      <AppShell>{children}</AppShell>
    </OrgProvider>
  );
}
