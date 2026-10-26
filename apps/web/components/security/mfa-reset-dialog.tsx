'use client';
import { useState } from 'react';
import { Button, Dialog, Field, Input, useToast } from '@tallywork/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useOrgAction } from '@/components/workspace/shared';

/**
 * Owner only: reset a member's two-factor after they lost both their phone and their recovery codes.
 * The server checks everything (owner, password, the member belongs to no other organization).
 */
export function MfaResetDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: { id: string; name: string } }) {
  const run = useOrgAction();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (o: boolean) => {
    if (!o) {
      setPassword('');
      setError(null);
    }
    onOpenChange(o);
  };
  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await run('POST', `/workers/${member.id}/mfa/reset`, { password });
      toast.success(`Two-factor was reset for ${member.name}. They were signed out and got an email.`);
      close(false);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Reset two-factor for ${member.name}?`}
      description="Only when they lost both their phone and their recovery codes. They are signed out everywhere, get an email, and set two-factor up again after signing in with their password."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={!password} onClick={() => void submit()}>
            Reset two-factor
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Your password" htmlFor="mfa-reset-password" error={error?.field('password') ?? (error && !error.errors?.length ? error.title : undefined)}>
          <Input id="mfa-reset-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
