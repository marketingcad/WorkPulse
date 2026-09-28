'use client';
import { useEffect, useMemo, useState } from 'react';
import { History, KeyRound, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Trash2, Webhook } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  PermissionState,
  StatusBadge,
  Switch,
  fmtDateTime,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { CodeBlock, SecretReveal } from '@/components/settings/secret-reveal';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  failure_count: number;
  disabled_reason: string | null;
  created_at: string;
}
interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  attempt: number;
  status: string;
  response_status: number | null;
  duration_ms: number | null;
  next_attempt_at: string | null;
  created_at: string;
}
interface WebhookBody {
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
}

const VERIFY_SNIPPET = `// Node.js — verify a WorkPulse webhook
import crypto from 'node:crypto';

function verify(rawBody, header, secret) {
  // header: "t=1727260000,v1=5f2b…"
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('base64url');
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300; // reject replays older than 5 min
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? '');
  return fresh && a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

export default function WebhooksPage() {
  const org = useOrg();
  const toast = useToast();
  const allowed = org.can('webhooks:manage');
  const q = useOrgQuery<{ endpoints: Endpoint[]; events: string[] }>(allowed ? '/webhooks' : null);
  const [editing, setEditing] = useState<Endpoint | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Endpoint | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Endpoint | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/webhooks/${b.id}`, {
    onSuccess: () => {
      toast.success('Endpoint deleted');
      setDeleting(null);
    },
  });

  const ping = async (e: Endpoint) => {
    try {
      await api(`/orgs/${org.organization.id}/webhooks/${e.id}/test`, { method: 'POST', body: {} });
      toast.success('Test event queued. It appears under Deliveries within a minute.', { label: 'View', onClick: () => setDeliveriesFor(e) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rotate = async (e: Endpoint) => {
    try {
      const r = await api<{ secret: string }>(`/orgs/${org.organization.id}/webhooks/${e.id}/rotate-secret`, { method: 'POST', body: {} });
      setRotated(r.secret);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const columns = useMemo<Column<Endpoint>[]>(
    () => [
      {
        key: 'url',
        header: 'Endpoint',
        priority: 'primary',
        value: (e) => e.url,
        cell: (e) => (
          <span className="block min-w-0 max-w-md">
            <span className="block truncate font-mono text-xs font-medium">{e.url}</span>
            {e.description && <span className="block truncate text-xs text-text-muted">{e.description}</span>}
          </span>
        ),
      },
      {
        key: 'events',
        header: 'Events',
        priority: 'secondary',
        value: (e) => e.events.length,
        cell: (e) => <span className="text-text-muted">{e.events.includes('*') ? 'All events' : `${e.events.length} ${e.events.length === 1 ? 'event' : 'events'}`}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        priority: 'secondary',
        value: (e) => (e.enabled ? 'ACTIVE' : 'PAUSED'),
        cell: (e) => (
          <span className="flex flex-col items-start gap-0.5">
            <StatusBadge status={e.enabled ? 'ACTIVE' : 'PAUSED'} label={e.enabled ? 'Enabled' : 'Disabled'} />
            {e.disabled_reason && <span className="text-2xs text-danger">{e.disabled_reason}</span>}
          </span>
        ),
      },
      { key: 'failures', header: 'Recent failures', align: 'right', value: (e) => e.failure_count, cell: (e) => <span className={e.failure_count ? 'text-danger' : 'text-text-muted'}>{e.failure_count}</span> },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        cell: (e) => (
          <span onClick={(ev) => ev.stopPropagation()}>
            <Menu
              trigger={
                <IconButton label={`Actions for ${e.url}`} size="xs">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
            >
              <MenuItem icon={<History className="size-3.5" />} onSelect={() => setDeliveriesFor(e)}>
                Deliveries
              </MenuItem>
              <MenuItem icon={<Send className="size-3.5" />} onSelect={() => ping(e)} disabled={!e.enabled}>
                Send test event
              </MenuItem>
              <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEditing(e)}>
                Edit
              </MenuItem>
              <MenuItem icon={<KeyRound className="size-3.5" />} onSelect={() => rotate(e)}>
                Rotate signing secret
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setDeleting(e)}>
                Delete
              </MenuItem>
            </Menu>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!allowed) return <PermissionState />;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="WorkPulse POSTs a signed JSON event to your endpoint when something happens. Failed deliveries are retried with backoff for about a day."
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
            Add endpoint
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <Panel title="Endpoints">
          {q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <DataTable
              rows={q.data?.endpoints}
              loading={q.isLoading}
              columns={columns}
              rowKey={(e) => e.id}
              onRowClick={(e) => setDeliveriesFor(e)}
              empty={
                <EmptyState
                  icon={<Webhook className="size-5" />}
                  title="No endpoints yet"
                  description="Add an HTTPS endpoint to receive events such as timesheet approvals or paid invoices."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
                      Add endpoint
                    </Button>
                  }
                />
              }
            />
          )}
        </Panel>
        <Panel title="Verifying signatures">
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="text-text-muted">Every request carries these headers. Verify the signature before trusting the body, and use the raw request body exactly as received.</p>
            <CodeBlock>{`Tallywork-Event: timesheet.approved\nTallywork-Delivery: <delivery id>\nTallywork-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t + "." + body)>`}</CodeBlock>
            <p className="text-text-muted">
              <span className="font-mono text-xs">v1</span> is the base64url-encoded HMAC-SHA256 of the timestamp, a dot, and the raw body, keyed with the endpoint’s signing secret. Reject requests whose timestamp is more than 5 minutes old. Respond with any 2xx status within 10 seconds.
            </p>
            <CodeBlock copy>{VERIFY_SNIPPET}</CodeBlock>
          </div>
        </Panel>
      </div>

      <EndpointDialog open={editing !== null} endpoint={editing === 'new' ? null : editing} events={q.data?.events ?? []} onOpenChange={(o) => !o && setEditing(null)} />
      <DeliveriesDrawer endpoint={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      <Dialog open={!!rotated} onOpenChange={(o) => !o && setRotated(null)} title="New signing secret" width={560} footer={<Button variant="primary" onClick={() => setRotated(null)}>I have stored the secret</Button>}>
        {rotated && <SecretReveal label="Signing secret" secret={rotated} warning="The old secret stopped working. Update your endpoint to verify with this one; it will not be shown again." />}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete endpoint?"
        description={deleting ? `WorkPulse will stop sending events to ${deleting.url}. Pending retries are discarded.` : undefined}
        confirmLabel="Delete endpoint"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate({ id: deleting.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}

function EndpointDialog({ open, endpoint, events, onOpenChange }: { open: boolean; endpoint: Endpoint | null; events: string[]; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setUrl(endpoint?.url ?? 'https://');
    setDescription(endpoint?.description ?? '');
    setSelected(endpoint?.events ?? []);
    setEnabled(endpoint?.enabled ?? true);
    setSecret(null);
  }, [open, endpoint]);

  const m = useOrgMutation<WebhookBody, Endpoint & { secret?: string }>(endpoint ? 'PATCH' : 'POST', endpoint ? `/webhooks/${endpoint.id}` : '/webhooks', {
    onSuccess: (r) => {
      if (r.secret) setSecret(r.secret);
      else {
        toast.success('Endpoint saved');
        onOpenChange(false);
      }
    },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const httpsOk = /^https:\/\/[^/\s]+\.[^/\s]+/.test(url.trim());
  const all = selected.includes('*');
  const canSubmit = httpsOk && selected.length > 0;
  const submit = () => m.mutate({ url: url.trim(), description: description.trim() || null, events: selected, enabled });
  const toggle = (e: string) => setSelected((xs) => (xs.includes(e) ? xs.filter((x) => x !== e) : [...xs.filter((x) => x !== '*'), e]));
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const e of events) {
      const k = e.split('.')[0] ?? e;
      g.set(k, [...(g.get(k) ?? []), e]);
    }
    return [...g.entries()];
  }, [events]);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) m.reset();
  };

  if (secret)
    return (
      <Dialog open={open} onOpenChange={close} title="Endpoint created" width={560} footer={<Button variant="primary" onClick={() => close(false)}>I have stored the secret</Button>}>
        <SecretReveal label="Signing secret" secret={secret} warning="Copy the signing secret now. You need it to verify the Tallywork-Signature header, and it will not be shown again." />
      </Dialog>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={endpoint ? 'Edit endpoint' : 'Add endpoint'}
      width={640}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!canSubmit} onClick={submit}>
            {endpoint ? 'Save changes' : 'Add endpoint'}
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
        <Field label="Endpoint URL" htmlFor="wh-url" hint="Must be a public https:// address." error={err?.field('url') ?? (url.length > 8 && !httpsOk ? 'Use a full https:// URL' : undefined)} required>
          <Input id="wh-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/tallywork" className="font-mono text-xs" autoFocus />
        </Field>
        <Field label="Description" htmlFor="wh-desc" error={err?.field('description')}>
          <Input id="wh-desc" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="What consumes these events?" />
        </Field>
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-text-muted">
            <span>
              Events<span className="text-danger"> *</span>
            </span>
            <Checkbox label={<span className="text-xs">All events, including future ones</span>} checked={all} onChange={(e) => setSelected(e.target.checked ? ['*'] : [])} />
          </legend>
          <div className="grid grid-cols-1 gap-3 rounded-sm border border-border p-3 sm:grid-cols-2">
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-text-faint">{g.replace('_', ' ')}</div>
                <div className="flex flex-col gap-1">
                  {list.map((e) => (
                    <Checkbox key={e} label={<span className="font-mono text-xs">{e}</span>} checked={all || selected.includes(e)} disabled={all} onChange={() => toggle(e)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {err?.field('events') && <p className="mt-1 text-xs text-danger">{err.field('events')}</p>}
        </fieldset>
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Enabled" description="Disabled endpoints keep their settings but receive no events." />
        {err && !err.errors?.length && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function DeliveriesDrawer({ endpoint, onClose }: { endpoint: Endpoint | null; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const q = useOrgQuery<Delivery[]>(endpoint ? `/webhooks/${endpoint.id}/deliveries` : null, { refetchInterval: 15_000 });
  const [replaying, setReplaying] = useState<string | null>(null);
  const replay = async (d: Delivery) => {
    if (!endpoint) return;
    setReplaying(d.id);
    try {
      await api(`/orgs/${org.organization.id}/webhooks/${endpoint.id}/deliveries/${d.id}/replay`, { method: 'POST', body: {} });
      toast.success('Delivery queued again');
      await q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReplaying(null);
    }
  };
  return (
    <Drawer
      open={!!endpoint}
      onOpenChange={(o) => !o && onClose()}
      title="Deliveries"
      subtitle={endpoint?.url}
      width={560}
      actions={
        <IconButton label="Refresh" size="sm" onClick={() => q.refetch()}>
          <RotateCcw className="size-3.5" />
        </IconButton>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="p-4 text-sm text-text-muted">Loading…</div>
      ) : !q.data?.length ? (
        <EmptyState title="No deliveries yet" description="Send a test event from the endpoint menu to check your integration." />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((d) => (
            <li key={d.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{d.event_type}</span>
                  <StatusBadge status={d.status} />
                  {d.response_status !== null && <Badge tone={d.response_status >= 200 && d.response_status < 300 ? 'success' : 'danger'}>HTTP {d.response_status}</Badge>}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {fmtDateTime(d.created_at)} · attempt {d.attempt}
                  {d.duration_ms !== null && ` · ${d.duration_ms} ms`}
                  {d.next_attempt_at && d.status === 'PENDING' && ` · next try ${fmtDateTime(d.next_attempt_at)}`}
                </div>
                <div className="mt-0.5 truncate font-mono text-2xs text-text-faint">event {d.event_id}</div>
              </div>
              <Button size="xs" icon={<RotateCcw className="size-3" />} loading={replaying === d.id} onClick={() => replay(d)}>
                Replay
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
