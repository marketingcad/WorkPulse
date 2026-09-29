'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { PortalListItemDto } from '@tallywork/contracts';
import { ErrorState, Spinner } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function PortalListPage() {
  const { data, error, refetch } = useQuery({ queryKey: ['portal', 'list'], queryFn: () => api<PortalListItemDto[]>('/portal') });
  return (
    <AuthShell title={t('portal.list.title')}>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-text-muted">{t('portal.list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((p) => (
            <li key={p.access_id}>
              <Link href={`/portal/${p.access_id}`} className="block rounded-sm border border-border px-3 py-2 hover:bg-surface-muted">
                <span className="font-medium">{p.client_name}</span>
                <span className="block text-xs text-text-muted">{p.organization_name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AuthShell>
  );
}
