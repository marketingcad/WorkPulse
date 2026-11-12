'use client';
import Link from 'next/link';
import type { RateScope } from '@tallywork/domain';
import { Field, Input } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { precedenceText } from './rate-precedence';

/**
 * The note under the pay and bill rate fields on the member, client and project forms: the same
 * wording everywhere, taken from the rules the billing engine applies, and a way to the Rates page
 * for what these quick fields can't do (a member's rate on one project, the rate history).
 */
export function RateNote({ scope, className }: { scope: Exclude<RateScope, 'ORG' | 'PROJECT_WORKER'>; className?: string }) {
  const org = useOrg();
  return (
    <p className={['text-xs text-text-muted', className].filter(Boolean).join(' ')}>
      Rates set here start on the “Rates start” date. Approved time that had no rate is priced once a rate covers it. {precedenceText('PAY', scope)} {precedenceText('BILL', scope)}{' '}
      {org.can('rates:read') && (
        <Link href={`${org.base}/finance/billing`} className="font-medium text-interactive hover:underline">
          See all rates →
        </Link>
      )}
    </p>
  );
}

/**
 * The first day the pay and bill rates of a member, client or project form apply (QA audit BUG-08:
 * they always started today, so time already worked was priced at 0). Empty = the server's default,
 * described by `emptyMeans` ("today", or a new project's start date).
 */
export function RateStartField({ id, value, onChange, emptyMeans, error, disabled }: { id: string; value: string; onChange: (v: string) => void; emptyMeans: string; error?: string; disabled?: boolean }) {
  return (
    <Field label="Rates start" htmlFor={id} hint={value ? 'Time on and after this day uses these rates.' : `Empty: ${emptyMeans}.`} error={error}>
      <Input id={id} type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
