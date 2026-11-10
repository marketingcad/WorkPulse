'use client';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { PortalAiSummaryDto } from '@tallywork/contracts';
import { ErrorState, Panel, SkeletonRows, registerCatalog } from '@tallywork/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

registerCatalog(
  'en',
  {
    'portal.summary.title': 'Summary',
    'portal.summary.byAi': 'Written by WorkPulse AI from your project progress. Updated once a day.',
    'portal.summary.plain': 'From your project progress.',
    'portal.summary.loading': 'Loading the summary',
  },
  { base: true },
);

/**
 * GET /portal/:accessId/ai-summary (packages/api/src/services/portal-summary.ts): a short summary of the
 * client's projects, shown only when the organization shares it. Loaded on demand, not with the page.
 */
export default function PortalAiSummary({ accessId }: { accessId: string }) {
  const q = useQuery({ queryKey: ['portal', accessId, 'ai-summary'], queryFn: () => api<PortalAiSummaryDto>(`/portal/${accessId}/ai-summary`), staleTime: 10 * 60_000 });
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-interactive" aria-hidden />
          {t('portal.summary.title')}
        </span>
      }
    >
      <div className="px-5 py-4" data-testid="portal-ai-summary" data-source={q.data?.source}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div aria-label={t('portal.summary.loading')}>
            <SkeletonRows rows={2} />
          </div>
        ) : (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed">{q.data.text}</p>
            <p className="mt-2 text-xs text-text-muted">{q.data.source === 'ai' ? t('portal.summary.byAi') : t('portal.summary.plain')}</p>
          </>
        )}
      </div>
    </Panel>
  );
}
