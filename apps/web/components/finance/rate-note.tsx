'use client';
import Link from 'next/link';
import type { RateScope } from '@tallywork/domain';
import { useOrg } from '@/lib/org';
import { precedenceText } from './rate-precedence';

/**
 * The note under the pay and bill rate fields on the member, client and project forms: the same
 * wording everywhere, taken from the rules the billing engine applies, and a way to the Rates page
 * for what these quick fields can't do (a future start date, a member's rate on one project).
 */
export function RateNote({ scope, className }: { scope: Exclude<RateScope, 'ORG' | 'PROJECT_WORKER'>; className?: string }) {
  const org = useOrg();
  return (
    <p className={['text-xs text-text-muted', className].filter(Boolean).join(' ')}>
      Rates set here start today. {precedenceText('PAY', scope)} {precedenceText('BILL', scope)}{' '}
      {org.can('rates:read') && (
        <Link href={`${org.base}/finance/billing`} className="font-medium text-interactive hover:underline">
          See all rates, or set a future date →
        </Link>
      )}
    </p>
  );
}
