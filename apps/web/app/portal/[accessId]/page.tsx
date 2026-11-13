'use client';
import { Suspense, lazy, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { ErrorState, Spinner, Tabs } from '@tallywork/ui';
import { PortalDashboard } from '@/components/portal/portal-dashboard';
import { PortalToolbar } from '@/components/portal/portal-toolbar';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

// Insights (delivery facts and appreciation) load when the tab opens.
const PortalInsightsTab = lazy(() => import('@/components/portal/portal-insights'));
// The AI summary, only when the organization shares it.
const PortalAiSummary = lazy(() => import('@/components/portal/portal-ai-summary'));

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PortalPage() {
  const { accessId } = useParams<{ accessId: string }>();
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()) }));
  const [tab, setTab] = useState('dashboard');
  const qs = `?from=${range.from}&to=${range.to}`;
  const summary = useQuery({ queryKey: ['portal', accessId, 'summary', range], queryFn: () => api<PortalSummaryDto>(`/portal/${accessId}/summary${qs}`) });
  const shots = useQuery({ queryKey: ['portal', accessId, 'screenshots', range], queryFn: () => api<PortalScreenshotDto[]>(`/portal/${accessId}/screenshots${qs}`), enabled: !!summary.data?.sections.screenshots });
  // The toolbar (signed-in email, all dashboards, sign out) belongs to the viewer page, not to PortalDashboard,
  // which the admin "Preview as client" reuses. It also shows on errors, so a revoked viewer can still sign out.
  const toolbar = <PortalToolbar className="mx-auto max-w-6xl justify-end px-4 pt-4" />;
  // A dashboard that is off, removed or no longer shared is a plain page, not an error with a retry
  // that cannot help (QA audit 13 Nov 2026, BUG-19).
  if (summary.error instanceof ApiError && summary.error.status === 404) {
    const off = summary.error.code === 'portal_off';
    return (
      <>
        {toolbar}
        <main id="main" className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-xl font-semibold text-text">{t(off ? 'portal.viewer.offTitle' : 'portal.viewer.goneTitle')}</h1>
          <p className="text-sm text-text-muted">{t(off ? 'portal.viewer.offBody' : 'portal.viewer.goneBody')}</p>
        </main>
      </>
    );
  }
  if (summary.error)
    return (
      <>
        {toolbar}
        <div className="flex min-h-[80dvh] items-center justify-center"><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></div>
      </>
    );
  if (!summary.data) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>;
  // If the screenshots request fails (e.g. transient network error), fall back to an empty list rather than
  // surfacing a broken state; the rest of the dashboard (hours, projects, tasks) still renders normally.
  // While it's still loading, pass screenshotsLoading so the dashboard shows a spinner instead of an empty grid.
  return (
    <>
      {toolbar}
      <div className="mx-auto max-w-6xl px-4 pt-2">
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'dashboard', label: t('portal.tab.dashboard') },
            { value: 'insights', label: t('portal.tab.insights') },
          ]}
        />
      </div>
      {tab === 'dashboard' && summary.data.sections.ai_summary && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Suspense fallback={null}>
            <PortalAiSummary accessId={accessId} />
          </Suspense>
        </div>
      )}
      {tab === 'dashboard' ? (
        <PortalDashboard
          summary={summary.data}
          screenshots={summary.data.sections.screenshots ? (shots.data ?? []) : null}
          screenshotsLoading={summary.data.sections.screenshots && shots.isLoading}
          range={range}
          onRange={setRange}
        />
      ) : (
        <div className="mx-auto max-w-6xl px-4 py-6">
          <Suspense fallback={<Spinner />}>
            <PortalInsightsTab accessId={accessId} />
          </Suspense>
        </div>
      )}
    </>
  );
}
