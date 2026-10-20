'use client';
import { PageHeader, PermissionState } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { ApprovalQueue } from '@/components/timesheets/approval-queue';
import { ManualRequests } from '@/components/timesheets/manual-requests';
import { HelpLink } from '@/components/help/help-link';

/**
 * Everything waiting for a manager's decision on one page: submitted timesheets and manual time
 * requests. Each part keeps its own permission (approving timesheets; requesting or approving
 * manual time), so someone who only requests manual time sees just their requests.
 */
export default function ApprovalsPage() {
  const org = useOrg();
  const timesheets = org.can('timesheets:approve');
  const manual = org.can('manual_time:request') || org.can('manual_time:approve');
  if (!timesheets && !manual) return <PermissionState message="Approvals need the timesheet or manual time approval permission." />;
  return (
    <>
      <PageHeader title="Approvals" description="Timesheets and manual time waiting for a decision. Approved time counts toward pay and invoices." actions={<HelpLink article={timesheets ? 'approve-timesheets' : 'manual-time'} />} />
      <div className="flex flex-col gap-6">
        {timesheets && <ApprovalQueue />}
        {manual && <ManualRequests />}
      </div>
    </>
  );
}
