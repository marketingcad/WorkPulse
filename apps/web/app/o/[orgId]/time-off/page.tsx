'use client';
import dynamic from 'next/dynamic';
import { PageHeader, Panel, PermissionState, SkeletonRows, Tabs } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
// Each tab loads when it is opened (bundle budget, 20 Nov 2026).
const tabLoading = () => <SkeletonRows rows={4} />;
const MyTimeOff = dynamic(() => import('@/components/people/time-off-mine').then((m) => m.MyTimeOff), { ssr: false, loading: tabLoading });
const TimeOffRequests = dynamic(() => import('@/components/people/time-off-requests').then((m) => m.TimeOffRequests), { ssr: false, loading: tabLoading });
const TimeOffCalendar = dynamic(() => import('@/components/people/time-off-calendar').then((m) => m.TimeOffCalendar), { ssr: false, loading: tabLoading });
const TimeOffAdmin = dynamic(() => import('@/components/people/time-off-admin').then((m) => m.TimeOffAdmin), { ssr: false, loading: tabLoading });
import type { TimeOffRequest } from '@/components/people/shared';
import { useUrlParams } from '@/components/timesheets/use-url-params';

type Tab = 'mine' | 'requests' | 'calendar' | 'admin';
const TABS: Tab[] = ['mine', 'requests', 'calendar', 'admin'];

export default function TimeOffPage() {
  const org = useOrg();
  const canApprove = org.can('time_off:approve');
  const canManage = org.can('time_off:manage');
  // The tab is in the address (refresh and Back keep it); none chosen: the queue when requests wait.
  const [url, setUrl] = useUrlParams(['tab'] as const);
  const chosen: Tab | null = url.tab && (TABS as readonly string[]).includes(url.tab) ? (url.tab as Tab) : null;
  const setTab = (t: Tab) => setUrl({ tab: t });
  const pendingQ = useOrgQuery<TimeOffRequest[]>(canApprove ? `/time-off/requests${qs({ status: 'PENDING' })}` : null);
  const pendingForMe = pendingQ.data?.filter((r) => r.membership_id !== org.membership.id).length;
  // Approvers land on the queue while something is waiting for them.
  const tab: Tab = chosen ?? (pendingForMe ? 'requests' : 'mine');

  if (!org.can('time_off:read'))
    return (
      <>
        <PageHeader title="Time off" />
        <Panel>
          <PermissionState />
        </Panel>
      </>
    );

  const items: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'mine', label: 'My time off' },
    ...(canApprove ? [{ value: 'requests' as const, label: 'Requests', count: pendingForMe || undefined }] : []),
    { value: 'calendar', label: 'Calendar' },
    ...(canManage ? [{ value: 'admin' as const, label: 'Policies & holidays' }] : []),
  ];

  return (
    <>
      <PageHeader title="Time off" description={canApprove ? 'Balances, requests waiting for your decision, and who is away.' : 'Your balances and requests, and who is away.'} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} items={items} className="mb-4" />
      {tab === 'mine' && <MyTimeOff />}
      {tab === 'requests' && canApprove && <TimeOffRequests />}
      {tab === 'calendar' && <TimeOffCalendar />}
      {tab === 'admin' && canManage && <TimeOffAdmin />}
    </>
  );
}
