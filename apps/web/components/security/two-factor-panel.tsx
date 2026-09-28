'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button, ErrorState, Field, Input, Panel, SkeletonRows, StatusBadge, useToast } from '@tallywork/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { CodeBlock, CopyButton } from '@/components/settings/secret-reveal';

interface MfaStatus {
  enabled: boolean;
  recovery_codes_left: number | null;
}
interface Setup {
  secret: string;
  otpauth_url: string;
}

/** Authenticator codes are 6 digits; anything else typed or pasted is dropped. */
export const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The signed-in person's own two-factor settings. Uses /me routes only, so it also works while an
 * organization blocks access until two-factor is on. `onDone` runs once the recovery codes are dismissed.
 */
export function TwoFactorPanel({ requiredByOrg, onDone }: { requiredByOrg?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery<MfaStatus, ApiError>({ queryKey: ['me', 'mfa'], queryFn: () => api<MfaStatus>('/me/mfa') });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<{ list: string[]; note: string } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });
  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    call(async () => {
      try {
        setSetup(await api<Setup>('/me/mfa/totp/setup', { method: 'POST' }));
        setCode('');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'mfa_already_enabled') {
          toast.error(e.title);
          void refresh();
          return;
        }
        throw e;
      }
    });
  const confirm = () =>
    call(async () => {
      const r = await api<{ recovery_codes: string[]; note: string }>('/me/mfa/totp/confirm', { method: 'POST', body: { code } });
      setCodes({ list: r.recovery_codes, note: r.note });
      setSetup(null);
      setCode('');
      void refresh();
    });
  const disable = () =>
    call(async () => {
      await api('/me/mfa/totp/disable', { method: 'POST', body: { code: code.trim() } });
      setDisabling(false);
      setCode('');
      toast.success('Two-factor authentication is off. Your other sessions were signed out.');
      void refresh();
      // The session is no longer verified: an organization that requires two-factor blocks it again.
      void qc.invalidateQueries({ queryKey: ['org'] });
    });

  const codeError = error?.field('code') ?? (error && !error.errors?.length ? error.title : undefined);
  const s = q.data;

  return (
    <div id="two-factor" className="scroll-mt-20">
      <Panel title="Two-factor authentication" actions={s && !codes ? <StatusBadge status={s.enabled ? 'ACTIVE' : 'NOT_SUBMITTED'} label={s.enabled ? 'On' : 'Off'} /> : undefined}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !s ? (
          <SkeletonRows rows={2} cols={2} />
        ) : codes ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-2 rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{codes.note} They are shown only once.</span>
            </div>
            <CodeBlock copy>{codes.list.join('\n')}</CodeBlock>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadText('workpulse-recovery-codes.txt', `WorkPulse recovery codes\nEach code works once.\n\n${codes.list.join('\n')}\n`)}>
                Download
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setCodes(null);
                  onDone?.();
                }}
              >
                I saved these codes
              </Button>
            </div>
          </div>
        ) : s.enabled ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="flex items-start gap-2 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>Signing in asks for a code from your authenticator app after your password.</span>
            </p>
            <p className="text-sm text-text-muted">
              Recovery codes left: <span className="tabular font-medium text-text">{s.recovery_codes_left ?? 0}</span>
              {(s.recovery_codes_left ?? 0) <= 2 && ' · Turn two-factor off and on again to get a new set.'}
            </p>
            {disabling ? (
              <form
                className="flex flex-col gap-2 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim().length >= 6) void disable();
                }}
              >
                {requiredByOrg && <p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">Your organization requires two-factor authentication. You will need to set it up again before you can continue working.</p>}
                <Field label="Code from your app, or a recovery code" htmlFor="mfa-off-code" error={codeError}>
                  <Input id="mfa-off-code" autoComplete="one-time-code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} autoFocus />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="danger" loading={busy} disabled={code.trim().length < 6}>
                    Turn off
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDisabling(false);
                      setCode('');
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <Button size="sm" onClick={() => setDisabling(true)}>
                  Turn off
                </Button>
              </div>
            )}
          </div>
        ) : setup ? (
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) void confirm();
            }}
          >
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
              <li>
                Add WorkPulse to an authenticator app (1Password, Google Authenticator, Microsoft Authenticator…).{' '}
                <a href={setup.otpauth_url} className="inline-flex items-center gap-1 font-medium text-interactive hover:underline">
                  Open in authenticator app <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="mt-2 block text-xs text-text-muted">Or enter this key by hand (time-based):</span>
                <span className="mt-1 flex items-center gap-2 rounded-sm border border-border bg-surface-muted p-2">
                  <code className="tabular min-w-0 flex-1 select-all break-all font-mono text-sm tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                  <CopyButton value={setup.secret} />
                </span>
              </li>
              <li>
                Enter the 6-digit code the app shows.
                <Field label="Code" htmlFor="mfa-setup-code" error={codeError} className="mt-2 max-w-48">
                  <Input id="mfa-setup-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" className="tabular tracking-widest" value={code} onChange={(e) => setCode(digitsOnly(e.target.value))} />
                </Field>
              </li>
            </ol>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={code.length !== 6}>
                Turn on
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSetup(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-text-muted">Protect your account with a code from an authenticator app on your phone, asked for after your password.</p>
            {requiredByOrg && <p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">Your organization requires two-factor authentication.</p>}
            {error && !error.errors?.length && (
              <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
                {error.title}
              </p>
            )}
            <div>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void start()}>
                Set up
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
