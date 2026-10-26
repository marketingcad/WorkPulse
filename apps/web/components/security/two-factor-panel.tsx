'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, ErrorState, Field, Input, Panel, SkeletonRows, StatusBadge, useToast } from '@tallywork/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { CodeBlock, CopyButton } from '@/components/settings/secret-reveal';

interface MfaStatus {
  enabled: boolean;
  recovery_codes_left: number | null;
}
interface Setup {
  secret: string;
  otpauth_url: string;
  /** the QR code, drawn by our server (the secret never goes to an outside QR service) */
  qr_svg: string;
}

/** What the person is confirming with their password (and, when two-factor is on, a code). */
type Ask = 'setup' | 'replace' | 'codes' | 'off';
const ASK: Record<Ask, { title: string; action: string; needsCode: boolean; danger?: boolean }> = {
  setup: { title: 'Confirm it’s you to set up two-factor authentication.', action: 'Continue', needsCode: false },
  replace: { title: 'Confirm it’s you to move two-factor to a new authenticator app. Your current app keeps working until the new one is set up.', action: 'Continue', needsCode: true },
  codes: { title: 'Confirm it’s you to get new recovery codes. Your current codes stop working.', action: 'Get new codes', needsCode: true },
  off: { title: 'Confirm it’s you to turn two-factor authentication off. Your other sessions will be signed out.', action: 'Turn off', needsCode: true, danger: true },
};

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
 * Recovery codes live only in this component's state while shown, never in storage.
 */
export function TwoFactorPanel({ requiredByOrg, onDone }: { requiredByOrg?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery<MfaStatus, ApiError>({ queryKey: ['me', 'mfa'], queryFn: () => api<MfaStatus>('/me/mfa') });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<{ list: string[]; note: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });
  const reset = () => {
    setAsk(null);
    setPassword('');
    setCode('');
    setError(null);
  };
  const call = async (fn: () => Promise<void>) => {
    if (busy) return; // no duplicate requests from double clicks
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

  const submitAsk = (what: Ask) =>
    call(async () => {
      const proof = { password, ...(ASK[what].needsCode ? { code: code.trim() } : {}) };
      if (what === 'setup' || what === 'replace') {
        setSetup(await api<Setup>('/me/mfa/totp/setup', { method: 'POST', body: proof }));
      } else if (what === 'codes') {
        const r = await api<{ recovery_codes: string[]; note: string }>('/me/mfa/recovery-codes', { method: 'POST', body: proof });
        setCodes({ list: r.recovery_codes, note: r.note });
        setSaved(false);
      } else {
        await api('/me/mfa/totp/disable', { method: 'POST', body: proof });
        toast.success('Two-factor authentication is off. Your other sessions were signed out.');
        // The session is no longer verified: an organization that requires two-factor blocks it again.
        void qc.invalidateQueries({ queryKey: ['org'] });
      }
      reset();
      void refresh();
    });
  const confirm = () =>
    call(async () => {
      const r = await api<{ recovery_codes: string[]; note: string }>('/me/mfa/totp/confirm', { method: 'POST', body: { code } });
      setCodes({ list: r.recovery_codes, note: r.note });
      setSaved(false);
      setSetup(null);
      setCode('');
      void refresh();
    });
  const cancelSetup = () =>
    call(async () => {
      await api('/me/mfa/totp/cancel', { method: 'POST' });
      setSetup(null);
      setCode('');
    });

  const fieldError = (f: string) => error?.field(f) ?? undefined;
  const generalError = error && !error.errors?.length ? error.title : undefined;
  const s = q.data;

  const askForm = (what: Ask) => (
    <form
      className="flex flex-col gap-3 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (password && (!ASK[what].needsCode || code.trim().length >= 6)) void submitAsk(what);
      }}
    >
      <p className="text-sm text-text-muted">{ASK[what].title}</p>
      {what === 'off' && requiredByOrg && <p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">Your organization requires two-factor authentication. You will need to set it up again before you can continue working.</p>}
      <Field label="Password" htmlFor="mfa-password" error={fieldError('password')}>
        <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      {ASK[what].needsCode && (
        <Field label="Code from your authenticator app, or a recovery code" htmlFor="mfa-proof-code" error={fieldError('code')}>
          <Input id="mfa-proof-code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        </Field>
      )}
      {generalError && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {generalError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={ASK[what].danger ? 'danger' : 'primary'} loading={busy} disabled={!password || (ASK[what].needsCode && code.trim().length < 6)}>
          {ASK[what].action}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );

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
              <span>{codes.note} They are shown only once. Each works one time, in place of a code from your app.</span>
            </div>
            <CodeBlock copy>{codes.list.join('\n')}</CodeBlock>
            <div>
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadText('workpulse-recovery-codes.txt', `WorkPulse recovery codes\nEach code works once.\n\n${codes.list.join('\n')}\n`)}>
                Download
              </Button>
            </div>
            <Checkbox label="I have saved these codes somewhere safe" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <div>
              <Button
                size="sm"
                variant="primary"
                disabled={!saved}
                onClick={() => {
                  setCodes(null);
                  onDone?.();
                }}
              >
                Done
              </Button>
            </div>
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
                Install an authenticator app on your phone if you don’t have one (1Password, Google Authenticator, Microsoft Authenticator, or another app that supports time-based codes).
              </li>
              <li>
                In the app, add an account and scan this QR code.
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qr_svg)}`}
                  alt="QR code to add WorkPulse to your authenticator app"
                  width={176}
                  height={176}
                  className="mt-2 rounded-sm border border-border bg-white p-2"
                />
                <a href={setup.otpauth_url} className="mt-2 inline-flex items-center gap-1 font-medium text-interactive hover:underline">
                  On this phone? Open in authenticator app <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="mt-2 block text-xs text-text-muted">Can’t scan it? Enter this key by hand (time-based):</span>
                <span className="mt-1 flex items-center gap-2 rounded-sm border border-border bg-surface-muted p-2">
                  <code className="tabular min-w-0 flex-1 select-all break-all font-mono text-sm tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                  <CopyButton value={setup.secret} />
                </span>
              </li>
              <li>
                Enter the 6-digit code the app shows. This setup expires in 15 minutes.
                {/* The full message ("check the time on your phone…") helps more here than the field's short one. */}
                <Field label="Code" htmlFor="mfa-setup-code" error={error?.title} className="mt-2 max-w-48">
                  <Input id="mfa-setup-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" className="tabular tracking-widest" value={code} onChange={(e) => setCode(digitsOnly(e.target.value))} />
                </Field>
              </li>
            </ol>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={busy} disabled={code.length !== 6}>
                {s.enabled ? 'Use this app' : 'Turn on'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void cancelSetup()}>
                Cancel
              </Button>
            </div>
          </form>
        ) : s.enabled ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="flex items-start gap-2 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>Signing in asks for a code from your authenticator app after your password.</span>
            </p>
            <p className="text-sm text-text-muted">
              Recovery codes left: <span className="tabular font-medium text-text">{s.recovery_codes_left ?? 0}</span>
              {(s.recovery_codes_left ?? 0) <= 2 && ' · Get new recovery codes before you run out.'}
            </p>
            {ask ? (
              askForm(ask)
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setAsk('replace')}>
                  Replace authenticator app
                </Button>
                <Button size="sm" onClick={() => setAsk('codes')}>
                  New recovery codes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsk('off')}>
                  Turn off
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-text-muted">Protect your account with a code from an authenticator app on your phone, asked for after your password.</p>
            {requiredByOrg && <p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">Your organization requires two-factor authentication.</p>}
            {ask ? (
              askForm(ask)
            ) : (
              <div>
                <Button size="sm" variant="primary" onClick={() => setAsk('setup')}>
                  Set up
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
