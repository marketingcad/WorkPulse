'use client';
import { PermissionState } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { OrgSettingsForm } from '@/components/settings/org-settings-form';
import { OvertimePanel } from '@/components/settings/overtime-panel';
import { TimeTypesPanel } from '@/components/settings/time-types-panel';
import { BreakTypesPanel } from '@/components/settings/break-types-panel';

/**
 * How time and pay work for everyone: timesheet period, timesheet locks and minimums, attendance grace,
 * budget warnings, overtime, time types and break types, in one place.
 */
export default function TimeAndPaySettingsPage() {
  const org = useOrg();
  if (!org.can('org:update')) return <PermissionState />;
  return (
    <>
      <OrgSettingsForm part="time" title="Time & pay" description="Timesheet periods and rules, overtime and the kinds of time and breaks people can record." />
      <div className="mt-4 flex max-w-3xl flex-col gap-4">
        <OvertimePanel />
        <TimeTypesPanel />
        <BreakTypesPanel />
      </div>
    </>
  );
}
