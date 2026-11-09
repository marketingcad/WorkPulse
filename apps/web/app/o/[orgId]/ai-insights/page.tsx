'use client';
import { Suspense, lazy } from 'react';
import { PageHeader, PermissionState, SkeletonRows } from '@tallywork/ui';
import { isDesktopOnly } from '@tallywork/domain';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

// The body and its strings load on demand: not part of the page's first load (the 250 KB budget).
const InsightsView = lazy(() => import('@/components/insights-ai/insights-view'));

/**
 * AI Insights: workforce, timesheet and project findings computed from what the person may see.
 * Same access as WorkPulse AI (a web role that can read the organization); no AI key needed.
 */
export default function AiInsightsPage() {
  const org = useOrg();
  const allowed = org.can('org:read') && !isDesktopOnly(org.grants);
  return (
    <>
      <PageHeader title={t('nav.item.aiInsights')} />
      {!allowed ? (
        <PermissionState />
      ) : (
        <Suspense fallback={<SkeletonRows rows={4} cols={2} />}>
          <InsightsView />
        </Suspense>
      )}
    </>
  );
}
