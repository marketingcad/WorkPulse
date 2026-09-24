'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { OrgContextDto } from '@tallywork/contracts';
import { ErrorState, Logo, Spinner } from '@tallywork/ui';
import { api } from '@/lib/api';
import { OrgProvider } from '@/lib/org';
import { AppShell } from '@/components/shell/app-shell';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data, error, refetch } = useQuery({ queryKey: ['org', orgId, 'context'], queryFn: () => api<OrgContextDto>(`/orgs/${orgId}`), staleTime: 60_000 });
  if (error)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  if (!data)
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
