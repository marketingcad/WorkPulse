'use client';
import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Input } from '@tallywork/ui';
import { errorMessage, useOrgMutation } from '@/lib/api';

export interface AnonymizeResult {
  membership_id: string;
  account_anonymized: boolean;
  deleted: Record<string, number>;
}

/**
 * Irreversible erasure of a member's personal monitoring data. Like ConfirmDialog, but the
 * confirm button stays disabled until the member's name is typed exactly.
 */
export function AnonymizeDialog({ open, onOpenChange, member, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; member: { id: string; name: string }; onDone: (r: AnonymizeResult) => void }) {
  const [typed, setTyped] = useState('');
  const m = useOrgMutation<Record<string, never>, AnonymizeResult>('POST', `/workers/${member.id}/anonymize`, { onSuccess: (r) => onDone(r) });
  useEffect(() => {
    if (open) {
      setTyped('');
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const matches = typed.trim() === member.name.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Erase ${member.name}’s personal data?`}
      width={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" disabled={!matches} loading={m.isPending} onClick={() => m.mutate({})}>
            Erase permanently
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-sm bg-danger-soft px-3 py-2 text-danger">This cannot be undone. They are removed from the organization and lose access immediately.</p>
        <div>
          <div className="font-medium">Deleted</div>
          <ul className="mt-1 list-disc pl-5 text-text-muted">
            <li>Screenshots, activity levels, and application and website usage</li>
            <li>Notifications and notification preferences</li>
            <li>Their devices (signed out) and any API keys they created (revoked)</li>
            <li>Their profile title and team memberships</li>
            <li>The sign-in account itself (name, email, password, two-factor), if they belong to no other organization</li>
          </ul>
        </div>
        <div>
          <div className="font-medium">Kept, because the law or your books need them</div>
          <ul className="mt-1 list-disc pl-5 text-text-muted">
            <li>Time entries, timesheets and approvals</li>
            <li>Billing, invoices and expenses</li>
            <li>The audit trail, with IP addresses and other network identifiers removed</li>
          </ul>
        </div>
        <p className="text-text-muted">Consider exporting their data first if they asked for a copy.</p>
        <Field label={`Type “${member.name}” to confirm`} htmlFor="erase-confirm">
          <Input id="erase-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        {m.error && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-danger">
            {errorMessage(m.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
