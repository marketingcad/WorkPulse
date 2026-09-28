'use client';
import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button, Field, Input, Panel, Select, fmtDateTime, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';

interface Access {
  active: boolean;
  expires_at: string | null;
  reason: string | null;
}

const DURATIONS = [1, 4, 24, 72];

/**
 * Lets an admin give Tallywork support time-limited, read-only access to members, devices and
 * the audit log (without it, support only sees counts and health). Every look support takes is
 * written to this organization's audit log.
 */
export function SupportAccessPanel() {
  const toast = useToast();
  const q = useOrgQuery<Access>('/support-access');
  const [hours, setHours] = useState(4);
  const [reason, setReason] = useState('');
  const grant = useOrgMutation<{ hours: number; reason: string }, Access>('POST', '/support-access', {
    onSuccess: () => {
      toast.success('Support access granted');
      setReason('');
    },
  });
  const revoke = useOrgMutation<void, Access>('DELETE', '/support-access', { onSuccess: () => toast.success('Support access revoked') });
  const err = grant.error instanceof ApiError ? grant.error : null;
  const a = q.data;

  return (
    <Panel title="Support access">
      <div className="flex flex-col gap-4 p-4 text-sm">
        <p className="text-text-muted">
          WorkPulse support can always see counts and health for your organization, never your people’s data. To let them look at members, devices and the audit log while they help you, grant read-only access for a limited time. Everything they view is recorded in your audit log.
        </p>
        {a?.active ? (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3">
            <LifeBuoy className="size-4 text-warning" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-warning">Support has read-only access until {fmtDateTime(a.expires_at)}</div>
              <div className="text-text">“{a.reason}”</div>
            </div>
            <Button variant="danger" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(undefined)}>
              Revoke now
            </Button>
          </div>
        ) : (
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length >= 3) grant.mutate({ hours, reason: reason.trim() });
            }}
          >
            <Field label="For" htmlFor="support-hours">
              <Select id="support-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {DURATIONS.map((h) => (
                  <option key={h} value={h}>
                    {h === 1 ? '1 hour' : h < 24 ? `${h} hours` : `${h / 24} ${h === 24 ? 'day' : 'days'}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="support-reason" hint="Shared with support and kept in the audit log." error={err?.field('reason')}>
              <Input id="support-reason" value={reason} maxLength={300} placeholder="e.g. Ticket #1234: timesheet totals look wrong" onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" loading={grant.isPending} disabled={reason.trim().length < 3}>
              Grant access
            </Button>
          </form>
        )}
        {(grant.error || revoke.error) && !err?.field('reason') && <p className="text-danger">{errorMessage(grant.error ?? revoke.error)}</p>}
      </div>
    </Panel>
  );
}
