'use client';
import { PageHeader, Panel, PermissionState, Tabs } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { MyTimeOff } from '@/components/people/time-off-mine';
import { TimeOffRequests } from '@/components/people/time-off-requests';
import { TimeOffCalendar } from '@/components/people/time-off-calendar';
import { TimeOffAdmin } from '@/components/people/time-off-admin';
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
