'use client';
import { useRouter } from 'next/navigation';
import { Tabs } from '@tallywork/ui';
import { useOrg } from '@/lib/org';

/** Invoices and the client payments applied to them live under one nav item. */
export function InvoiceSections({ current }: { current: 'invoices' | 'payments' }) {
  const org = useOrg();
  const router = useRouter();
  const items = [...(org.can('invoices:read') ? [{ value: 'invoices', label: 'Invoices' }] : []), ...(org.can('payments:read') ? [{ value: 'payments', label: 'Payments received' }] : [])];
  if (items.length < 2) return null;
  return <Tabs value={current} onValueChange={(v) => router.push(`${org.base}/finance/invoices${v === 'payments' ? '/payments' : ''}`)} items={items} className="mb-4" />;
}
