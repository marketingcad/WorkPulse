'use client';
import { PermissionState } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { OrgSettingsForm } from '@/components/settings/org-settings-form';

/** Who the organization is: name, time zone, currency, and the company profile printed on invoices. */
export default function OrgSettingsPage() {
  const org = useOrg();
  if (!org.can('org:update')) return <PermissionState />;
  return <OrgSettingsForm part="organization" title="Organization" description="Name, time zone, currency and the company details printed on invoices." />;
}
