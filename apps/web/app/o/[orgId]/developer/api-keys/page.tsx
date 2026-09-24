'use client';
import { useMemo, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { API_KEY_SCOPES, type ApiKeyScope } from '@tallywork/domain';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, Panel, PermissionState, Select, StatusBadge, Tooltip, fmtDate, fmtRelative, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg } from '@/lib/org';
import { CodeBlock, SecretReveal } from '@/components/settings/secret-reveal';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_by_name: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
interface CreatedKey {
  id: string;
  name: string;
  scopes: string[];
  key: string;
  note: string;
}

const SCOPE_INFO: Record<ApiKeyScope, string> = {
  'read:workers': 'List members, their roles and teams',
  'read:teams': 'List teams and team membership',
  'read:clients': 'List clients',
  'read:projects': 'List projects and their settings',
  'read:tasks': 'List tasks and assignees',
  'read:timesheets': 'Read timesheets and approval status',
  'read:time': 'Read tracked and manual time entries',
  'read:activity': 'Read activity levels, apps and URLs',
  'read:reports': 'Run reports',
  'read:billing': 'Read rates and billable amounts',
  'read:invoices': 'Read invoices and payments',
  'write:projects': 'Create and update projects',
  'write:tasks': 'Create and update tasks',
  'write:clients': 'Create and update clients',
};
const ALL_SCOPES = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];

function keyStatus(k: ApiKeyRow): string {
  if (k.revoked_at) return 'REVOKED';
  if (k.expires_at && Date.parse(k.expires_at) < Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

export default function ApiKeysPage() {
  const org = useOrg();
  const toast = useToast();
  const allowed = org.can('api_keys:manage');
  const q = useOrgQuery<ApiKeyRow[]>(allowed ? '/api-keys' : null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const revoke = useOrgMutation<{ id: string }>('DELETE', (b) => `/api-keys/${b.id}`, {
    onSuccess: () => {
      toast.success('API key revoked');
      setRevoking(null);
    },
  });

  const columns = useMemo<Column<ApiKeyRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        priority: 'primary',
        value: (k) => k.name,
        cell: (k) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{k.name}</span>
            <code className="font-mono text-2xs text-text-muted">{k.prefix}_…</code>
          </span>
        ),
      },
      {
        key: 'scopes',
        header: 'Scopes',
        priority: 'secondary',
        value: (k) => k.scopes.join(' '),
        cell: (k) => (
          <Tooltip content={k.scopes.join(', ')}>
            <span className="flex max-w-72 flex-wrap gap-1">
              {k.scopes.slice(0, 3).map((s) => (
                <Badge key={s} tone={s.startsWith('write:') ? 'warning' : 'neutral'}>
                  {s}
                </Badge>
              ))}
              {k.scopes.length > 3 && <Badge>+{k.scopes.length - 3}</Badge>}
            </span>
          </Tooltip>
        ),
      },
      { key: 'created_by', header: 'Created by', value: (k) => k.created_by_name, cell: (k) => <span className="text-text-muted">{k.created_by_name || '—'}</span> },
      { key: 'created_at', header: 'Created', value: (k) => k.created_at, cell: (k) => <span className="text-text-muted">{fmtDate(k.created_at)}</span> },
      { key: 'last_used', header: 'Last used', value: (k) => k.last_used_at ?? '', cell: (k) => <span className="text-text-muted">{fmtRelative(k.last_used_at)}</span> },
      { key: 'expires', header: 'Expires', value: (k) => k.expires_at ?? '9999', cell: (k) => <span className="text-text-muted">{k.expires_at ? fmtDate(k.expires_at) : 'Never'}</span> },
      { key: 'status', header: 'Status', priority: 'secondary', value: keyStatus, cell: (k) => <StatusBadge status={keyStatus(k)} /> },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        cell: (k) =>
          k.revoked_at ? null : (
            <IconButton label={`Revoke ${k.name}`} size="xs" onClick={() => setRevoking(k)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          ),
      },
    ],
    [],
  );

  if (!allowed) return <PermissionState />;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.tallywork.app';

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys let your own scripts and integrations read or change data in this organization. A key never has more access than the person who created it."
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
            Create API key
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <Panel title="Keys">
          {q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <DataTable
              rows={q.data}
              loading={q.isLoading}
              columns={columns}
              rowKey={(k) => k.id}
              initialSort={{ key: 'created_at', dir: 'desc' }}
              rowClassName={(k) => (k.revoked_at ? 'opacity-60' : undefined)}
              empty={
                <EmptyState
                  icon={<KeyRound className="size-5" />}
                  title="No API keys yet"
                  description="Create a key with only the scopes your integration needs."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                      Create API key
                    </Button>
                  }
                />
              }
            />
          )}
        </Panel>
        <Panel title="Using a key">
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="text-text-muted">Send the key as a Bearer token. All endpoints live under your organization, and responses are JSON.</p>
            <CodeBlock copy>{`curl -H "Authorization: Bearer tw_live_xxxxxxxx_<secret>" \\\n  ${origin}/api/v1/orgs/${org.organization.id}/projects`}</CodeBlock>
            <p className="text-xs text-text-faint">Revoked or expired keys stop working immediately. Every key action is written to the audit log.</p>
          </div>
        </Panel>
      </div>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke API key?"
        description={revoking ? `Integrations using “${revoking.name}” (${revoking.prefix}_…) will stop working immediately. This cannot be undone.` : undefined}
        confirmLabel="Revoke key"
        danger
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useOrg();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [expiry, setExpiry] = useState<'never' | '30' | '90' | '365' | 'custom'>('90');
  const [customDate, setCustomDate] = useState('');
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const m = useOrgMutation<{ name: string; scopes: ApiKeyScope[]; expires_at: string | null }, CreatedKey>('POST', '/api-keys', { onSuccess: (r) => setCreated(r) });
  const err = m.error instanceof ApiError ? m.error : null;

  const reset = () => {
    setName('');
    setScopes([]);
    setExpiry('90');
    setCustomDate('');
    setCreated(null);
    m.reset();
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(reset, 200);
  };
  const expiresAt = (): string | null => {
    if (expiry === 'never') return null;
    const date = expiry === 'custom' ? customDate : addDays(todayIn(org.organization.timezone), Number(expiry));
    return date ? new Date(`${date}T23:59:59Z`).toISOString() : null;
  };
  const submit = () => m.mutate({ name: name.trim(), scopes, expires_at: expiresAt() });
  const toggle = (s: ApiKeyScope) => setScopes((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const canSubmit = name.trim().length > 0 && scopes.length > 0 && (expiry !== 'custom' || !!customDate);

  if (created)
    return (
      <Dialog open={open} onOpenChange={close} title="API key created" width={560} footer={<Button variant="primary" onClick={() => close(false)}>I have stored the key</Button>}>
        <div className="flex flex-col gap-3">
          <SecretReveal label={`Secret for “${created.name}”`} secret={created.key} warning="Copy this key now and store it in a secret manager. For your security it will not be shown again." />
          <div className="flex flex-wrap gap-1">
            {created.scopes.map((s) => (
              <Badge key={s}>{s}</Badge>
            ))}
          </div>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Create API key"
      description="Choose the smallest set of scopes your integration needs."
      width={600}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!canSubmit} onClick={submit}>
            Create key
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <Field label="Name" htmlFor="key-name" hint="For example “Payroll sync” or “BI warehouse”." error={err?.field('name')} required>
          <Input id="key-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-text-muted">
            Scopes<span className="text-danger"> *</span>
          </legend>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {ALL_SCOPES.map((s) => {
              const perm = API_KEY_SCOPES[s];
              const held = org.can(perm);
              return (
                <label key={s} className={held ? 'flex cursor-pointer items-start gap-2' : 'flex items-start gap-2 opacity-50'} title={held ? undefined : `You do not hold ${perm}`}>
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-interactive)]" checked={scopes.includes(s)} disabled={!held} onChange={() => toggle(s)} />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-medium">{s}</span>
                    <span className="block text-xs text-text-muted">{SCOPE_INFO[s]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {err?.field('scopes') && <p className="text-xs text-danger">{err.field('scopes')}</p>}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Expires" htmlFor="key-expiry" className="w-44">
            <Select id="key-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
              <option value="custom">On a date…</option>
              <option value="never">Never</option>
            </Select>
          </Field>
          {expiry === 'custom' && (
            <Field label="Expiry date" htmlFor="key-date" className="w-44">
              <Input id="key-date" type="date" min={addDays(todayIn(org.organization.timezone), 1)} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
            </Field>
          )}
        </div>
        {expiry === 'never' && <p className="text-xs text-warning">Keys without an expiry should be rotated manually at least once a year.</p>}
        {err && !err.errors?.length && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
      </form>
    </Dialog>
  );
}
