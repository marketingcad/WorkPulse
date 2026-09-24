'use client';
import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, PermissionState, Spinner, Tabs } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { ActivityReview } from '@/components/tracking/activity-review';
import { UsageView } from '@/components/tracking/usage-view';

type Tab = 'screenshots' | 'apps' | 'urls';

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <ActivityInner />
    </Suspense>
  );
}

function ActivityInner() {
  const org = useOrg();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const canApps = org.can('apps:read');
  const raw = sp.get('tab');
  const tab: Tab = (raw === 'apps' || raw === 'urls') && canApps ? raw : 'screenshots';

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  if (!org.can('activity:read')) return <PermissionState />;

  return (
    <>
      <PageHeader
        title={org.isManagerView ? 'Activity' : 'My activity'}
        description={
          tab === 'screenshots'
            ? 'Review a day in 10-minute blocks: screenshots, activity levels and what was worked on.'
            : `Where time went by ${tab === 'apps' ? 'application' : 'website'}, recorded by the desktop app.`
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onValueChange={(v) => setParams({ tab: v === 'screenshots' ? undefined : v })}
        items={[{ value: 'screenshots', label: 'Screenshots' }, ...(canApps ? [{ value: 'apps', label: 'Apps' }, { value: 'urls', label: 'URLs' }] : [])]}
      />
      {tab === 'screenshots' ? (
        <ActivityReview member={sp.get('member')} date={sp.get('date')} onChange={(p) => setParams(p)} />
      ) : (
        <UsageView key={tab} kind={tab} initialMember={sp.get('member') ?? undefined} />
      )}
    </>
  );
}
