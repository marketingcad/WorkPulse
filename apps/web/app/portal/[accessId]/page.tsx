'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { ErrorState, Spinner } from '@tallywork/ui';
import { PortalDashboard } from '@/components/portal/portal-dashboard';
import { PortalToolbar } from '@/components/portal/portal-toolbar';
import { api } from '@/lib/api';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PortalPage() {
  const { accessId } = useParams<{ accessId: string }>();
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()) }));
  const qs = `?from=${range.from}&to=${range.to}`;
  const summary = useQuery({ queryKey: ['portal', accessId, 'summary', range], queryFn: () => api<PortalSummaryDto>(`/portal/${accessId}/summary${qs}`) });
  const shots = useQuery({ queryKey: ['portal', accessId, 'screenshots', range], queryFn: () => api<PortalScreenshotDto[]>(`/portal/${accessId}/screenshots${qs}`), enabled: !!summary.data?.sections.screenshots });
  // The toolbar (signed-in email, all dashboards, sign out) belongs to the viewer page, not to PortalDashboard,
  // which the admin "Preview as client" reuses. It also shows on errors, so a revoked viewer can still sign out.
  const toolbar = <PortalToolbar className="mx-auto max-w-5xl justify-end px-4 pt-4" />;
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
      <PortalDashboard
        summary={summary.data}
        screenshots={summary.data.sections.screenshots ? (shots.data ?? []) : null}
        screenshotsLoading={summary.data.sections.screenshots && shots.isLoading}
        range={range}
        onRange={setRange}
      />
    </>
  );
}
