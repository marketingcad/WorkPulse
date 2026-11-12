'use client';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useOrg } from '@/lib/org';

/**
 * QA audit 11 Nov 2026 (BUG-08): time no rate covers is paid and billed 0, and Summary showed $0 with
 * nothing to say why. This says how much time has no pay or bill rate and links to Rates. Time a
 * finalized payroll already paid at 0 (`paid`, part of `pay`) cannot be changed by a rate any more, so
 * it gets its own sentence: add a bonus on the next payroll. Renders nothing when every hour is priced
 * or money is hidden (the counts are null).
 */
export function UnpricedTimeWarning({ pay, bill, paid, className }: { pay: number | null | undefined; bill: number | null | undefined; paid?: number | null; className?: string }) {
  const org = useOrg();
  const paidAtZero = paid ?? 0;
  const fixablePay = Math.max(0, (pay ?? 0) - paidAtZero);
  const parts = [fixablePay ? `${org.fmtDuration(fixablePay)} has no pay rate` : null, bill ? `${org.fmtDuration(bill)} of billable time has no bill rate` : null].filter(Boolean);
  if (!parts.length && !paidAtZero) return null;
  return (
    <div role="status" className={['flex items-start gap-2 rounded-sm border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-text', className].filter(Boolean).join(' ')}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex flex-col gap-1">
        {parts.length > 0 && (
          <p>
            {parts.join(' and ')}, so it counts as 0 in pay and invoices. Set a rate that starts on or before that time and approved time is priced too.{' '}
            {org.can('rates:manage') && (
              <Link href={`${org.base}/finance/billing`} className="font-medium text-interactive hover:underline">
                Set rates →
              </Link>
            )}
          </p>
        )}
        {paidAtZero > 0 && (
          <p>
            {org.fmtDuration(paidAtZero)} with no pay rate was already paid at 0 by a finalized payroll. A rate no longer changes it: add a bonus on the next payroll.{' '}
            {org.can('payroll:manage') && (
              <Link href={`${org.base}/finance/payroll`} className="font-medium text-interactive hover:underline">
                Open Payroll →
              </Link>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
