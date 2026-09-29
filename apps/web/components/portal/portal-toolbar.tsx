'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto, PortalListItemDto } from '@tallywork/contracts';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

/**
 * Signed-in bar for client viewers: who is signed in, a way back to the dashboard list (only when
 * there is more than one) and sign out. Viewer pages only — never the admin "Preview as client".
 */
export function PortalToolbar({ showAll = true, className = '' }: { showAll?: boolean; className?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') }).data;
  const portals = useQuery({ queryKey: ['portal', 'list'], queryFn: () => api<PortalListItemDto[]>('/portal'), enabled: showAll }).data;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${className}`}>
      {me && (
        <span className="truncate text-text-muted">
          {t('portal.toolbar.signedInAs')} <span className="font-medium text-text">{me.user.email}</span>
        </span>
      )}
      {showAll && (portals?.length ?? 0) > 1 && (
        <Link href="/portal" className="text-interactive hover:underline">
          {t('portal.toolbar.all')}
        </Link>
      )}
      <button
        type="button"
        disabled={leaving}
        className="text-text-muted hover:text-text hover:underline disabled:opacity-50"
        onClick={async () => {
          setLeaving(true);
          await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
          qc.clear();
          router.replace('/login');
        }}
      >
        {t('portal.toolbar.signOut')}
      </button>
    </div>
  );
}
