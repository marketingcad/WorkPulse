'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, SkeletonRows } from '@tallywork/ui';
import { useOrg } from '@/lib/org';

/** Payments moved under Invoices ("Payments received"); keep old links working. */
export default function PaymentsRedirect() {
  const org = useOrg();
  const router = useRouter();
  useEffect(() => router.replace(`${org.base}/finance/invoices/payments`), [org.base, router]);
  return (
    <Panel>
      <SkeletonRows />
    </Panel>
  );
}
