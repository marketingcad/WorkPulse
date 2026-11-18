'use client';
/**
 * Enrollment tokens for managed installs (Devices page, organization-wide device managers). IT puts a
 * token in the desktop app's managed settings; computers that sign in with it join this organization
 * already approved. The token never signs anyone in. Its secret is shown once, right after creation.
 */
import { useState } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import type { EnrollmentTokenCreatedDto, EnrollmentTokenDto } from '@tallywork/contracts';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, Panel, SegmentedControl, fmtDate, fmtRelative, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { useOrgAction } from '@/components/workspace/basics';

const STATUS: Record<EnrollmentTokenDto['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'neutral' },
};

export function EnrollmentTokensPanel() {
  const q = useOrgQuery<EnrollmentTokenDto[]>('/enrollment-tokens');
  const run = useOrgAction();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<EnrollmentTokenCreatedDto | null>(null);
  const [revoking, setRevoking] = useState<EnrollmentTokenDto | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: Column<EnrollmentTokenDto>[] = [
    {
      key: 'name',
      header: 'Name',
      priority: 'primary',
      value: (t) => t.name,
      cell: (t) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{t.name}</span>
          <span className="font-mono text-2xs text-text-faint">wpe_{t.prefix}…</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', priority: 'secondary', value: (t) => t.status, cell: (t) => <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge> },
    { key: 'computers', header: 'Computers', align: 'right', value: (t) => t.use_count, cell: (t) => <span className="tabular">{t.use_count}</span> },
    { key: 'used', header: 'Last used', value: (t) => t.last_used_at ?? '', cell: (t) => <span className="text-text-muted">{t.last_used_at ? fmtRelative(t.last_used_at) : 'Never'}</span> },
    {
      key: 'created',
      header: 'Created',
      value: (t) => t.created_at,
      cell: (t) => (
        <span className="text-text-muted">
          {fmtDate(t.created_at)}
          {t.created_by_name && ` · ${t.created_by_name}`}
          {t.expires_at && <span className="block text-2xs">Expires {fmtDate(t.expires_at)}</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (t) =>
        t.status === 'ACTIVE' ? (
          <Button size="sm" variant="ghost" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.name}`}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <Panel
      title="Enrollment tokens"
      className="mt-4"
      actions={
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          New token
        </Button>
      }
    >
      <p className="px-4 pt-3 text-sm text-text-muted">
        For company computers set up by your IT team. Put a token in the desktop app’s managed settings: computers that sign in with it join this organization already approved. People still sign in with their own account. Revoking a token stops new computers from joining; computers already set up keep working.
      </p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          columns={columns}
          rowKey={(t) => t.id}
          caption="Enrollment tokens"
          rowClassName={(t) => (t.status === 'ACTIVE' ? undefined : 'bg-surface-muted/50')}
          empty={<EmptyState icon={<KeyRound className="size-5" />} title="No enrollment tokens" description="Create one when you install the desktop app on company computers with Intune, Group Policy, Jamf or a script." action={<Button onClick={() => setCreating(true)}>New token</Button>} />}
        />
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setCreated(t);
          }}
        />
      )}
      {created && <TokenDialog token={created} onClose={() => setCreated(null)} />}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? 'token'}?`}
        description="New computers can no longer join with it, and signing in on a computer that still has it is refused. Computers already set up with it keep working. This cannot be undone."
        confirmLabel="Revoke token"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!revoking) return;
          setBusy(true);
          try {
            await run('DELETE', `/enrollment-tokens/${revoking.id}`);
            toast.success(`${revoking.name} revoked`);
            setRevoking(null);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Panel>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (t: EnrollmentTokenCreatedDto) => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // The expiry is the end of the chosen day on this computer.
      const expires_at = expires ? new Date(`${expires}T23:59:59`).toISOString() : null;
      onCreated(await run<EnrollmentTokenCreatedDto>('POST', '/enrollment-tokens', { name: name.trim(), expires_at }));
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New enrollment token"
      description="Name it after the computers or the rollout it is for, so you can tell tokens apart later."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Create token
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <Field label="Name" htmlFor="token-name" required error={err?.field('name')}>
          <Input id="token-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head office laptops" />
        </Field>
        <Field label="Expires" htmlFor="token-expires" hint="Optional. After this day, new computers can no longer join with it." error={err?.field('expires_at')}>
          <Input id="token-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

type Os = 'windows' | 'macos' | 'linux';

/** The secret, shown once, with setup lines for each system. */
function TokenDialog({ token, onClose }: { token: EnrollmentTokenCreatedDto; onClose: () => void }) {
  const [os, setOs] = useState<Os>('windows');
  const server = typeof window === 'undefined' ? '' : window.location.origin;
  const snippets: Record<Os, string> = {
    windows: [
      `reg add "HKLM\\SOFTWARE\\Policies\\Tallywork" /v ServerUrl /t REG_SZ /d ${server} /f`,
      `reg add "HKLM\\SOFTWARE\\Policies\\Tallywork" /v EnrollmentToken /t REG_SZ /d ${token.token} /f`,
    ].join('\n'),
    macos: [
      '<!-- In a configuration profile for app.tallywork.desktop (Jamf, Kandji, Intune) -->',
      '<key>ServerUrl</key>',
      `<string>${server}</string>`,
      '<key>EnrollmentToken</key>',
      `<string>${token.token}</string>`,
    ].join('\n'),
    linux: `# /etc/tallywork/config.json\n${JSON.stringify({ serverUrl: server, enrollmentToken: token.token }, null, 2)}`,
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Token created: ${token.name}`} width={620} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-text">
          Copy it now. For your security it is shown only once; if you lose it, revoke it and create a new one.
        </p>
        <CopyField label="Enrollment token" value={token.token} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Add it to your computers</span>
            <SegmentedControl
              size="xs"
              label="System"
              value={os}
              onChange={setOs}
              options={[
                { value: 'windows', label: 'Windows' },
                { value: 'macos', label: 'macOS' },
                { value: 'linux', label: 'Linux' },
              ]}
            />
          </div>
          <CopyField label={`Setup for ${os === 'windows' ? 'Windows (run as administrator, or deploy with Group Policy or Intune)' : os === 'macos' ? 'macOS' : 'Linux'}`} value={snippets[os]} multiline />
          <p className="text-xs text-text-muted">
            Then install the app (<span className="font-mono">Tallywork-Setup.exe</span>, or the per-machine <span className="font-mono">.msi</span> for Intune and Group Policy). People sign in with their own account, and the computer joins your organization already approved.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div className="flex items-start gap-2">
        <pre aria-label={label} className={`min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-xs ${multiline ? 'whitespace-pre' : 'whitespace-nowrap'}`}>
          {value}
        </pre>
        <Button size="sm" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
