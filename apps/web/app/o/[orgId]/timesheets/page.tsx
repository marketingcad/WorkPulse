'use client';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Panel, PermissionState, SkeletonRows } from '@tallywork/ui';
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
  const router = useRouter();
  const other = params.member && params.member !== org.membership.id ? params.member : null;
  const date = params.date || todayIn(org.membership.timezone || org.organization.timezone);
  // Someone else's timesheet has one address, under Team week (R2); older links still arrive here.
  useEffect(() => {
    if (other) router.replace(`${org.base}/timesheets/team?member=${other}${params.date ? `&date=${params.date}` : ''}`);
  }, [other, params.date, org.base, router]);

  if (!org.can('timesheets:read')) return <PermissionState />;
  if (other) return <Panel><SkeletonRows /></Panel>;

  return (
    <>
      <PageHeader title="My timesheet" description="Review your time for the period, fix mistakes, and submit it for approval." />
      <TimesheetView membershipId={org.membership.id} date={date} onDateChange={(d) => setParams({ date: d })} />
    </>
  );
}
