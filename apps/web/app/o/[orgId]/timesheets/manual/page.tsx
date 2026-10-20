'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, SkeletonRows } from '@tallywork/ui';
import { useOrg } from '@/lib/org';

/** Manual time requests moved onto Timesheets › Approvals; keep old links (and notifications) working. */
export default function ManualTimeRedirect() {
  const org = useOrg();
  const router = useRouter();
  useEffect(() => router.replace(`${org.base}/timesheets/approvals`), [org.base, router]);
  return (
    <Panel>
      <SkeletonRows />
    </Panel>
  );
}
