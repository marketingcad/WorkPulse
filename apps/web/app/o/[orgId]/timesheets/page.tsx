'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import type { WorkerDto } from '@tallywork/contracts';
import { PageHeader, Panel, PermissionState, SkeletonRows } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { TimesheetView } from '@/components/timesheets/timesheet-view';
import { useUrlParams } from '@/components/timesheets/use-url-params';

export default function MyTimesheetPage() {
  return (
    <Suspense fallback={<Panel><SkeletonRows /></Panel>}>
      <MyTimesheet />
    </Suspense>
  );
}

function MyTimesheet() {
  const org = useOrg();
  const [params, setParams] = useUrlParams(['member', 'date'] as const);
  const membershipId = params.member || org.membership.id;
  const isSelf = membershipId === org.membership.id;
  const date = params.date || todayIn(org.membership.timezone || org.organization.timezone);
  const workerQ = useOrgQuery<WorkerDto>(!isSelf && org.can('members:read') ? `/workers/${membershipId}` : null, { retry: false });

  if (!org.can('timesheets:read')) return <PermissionState />;

  return (
    <>
      <PageHeader
        title={isSelf ? 'My timesheet' : `Timesheet${workerQ.data ? ` · ${workerQ.data.name}` : ''}`}
        description={isSelf ? 'Review your time for the period, fix mistakes, and submit it for approval.' : 'Review and edit this member’s time for the period.'}
        breadcrumbs={
          !isSelf && org.can('timesheets:read', 'team') ? (
            <Link href={`${org.base}/timesheets/team`} className="hover:underline">
              View & edit
            </Link>
          ) : undefined
        }
      />
      <TimesheetView membershipId={membershipId} date={date} onDateChange={(d) => setParams({ date: d })} decisions={!isSelf} />
    </>
  );
}
