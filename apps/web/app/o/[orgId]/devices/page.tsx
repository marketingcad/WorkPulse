'use client';
import { useState } from 'react';
import { CheckCircle2, KeyRound, Laptop, MoreHorizontal, ShieldOff } from 'lucide-react';
import type { DeviceDto, OffsetPage } from '@tallywork/contracts';
import {
  Badge,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  PermissionState,
  PersonCell,
  StatusBadge,
  fmtRelative,
  humanize,
  useToast,
  type Column,
} from '@tallywork/ui';
import { errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useClampPage, useSearch, useServerPage } from '@/lib/paging';

type Action = 'approve' | 'reauth' | 'revoke';
const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const ACTION_COPY: Record<Action, { title: string; confirm: string; body: string; done: string }> = {
  approve: { title: 'Approve this device?', confirm: 'Approve', body: 'The desktop app on this device will be allowed to sync time, activity and screenshots for this member.', done: 'Device approved' },
  reauth: { title: 'Require sign-in again?', confirm: 'Require sign-in', body: 'The device keeps its history, but its current credentials stop working. The member must sign in again from the desktop app before it can sync.', done: 'Device must sign in again' },
  revoke: { title: 'Revoke this device?', confirm: 'Revoke device', body: 'The device is disconnected and can no longer sync. Time already synced is kept. This cannot be undone from here.', done: 'Device revoked' },
};

export default function DevicesPage() {
  const org = useOrg();
  const toast = useToast();
  const allowed = org.can('devices:read');
  const search = useSearch();
  // The server searches and pages the devices (one or more per member), most recently seen first.
  const paging = useServerPage(search.term);
  const q = useOrgQuery<OffsetPage<DeviceDto> & { summary: { counts: Record<string, number> } }>(allowed ? `/devices${qs({ q: search.term || undefined, ...paging.params })}` : null, {
    refetchInterval: 60_000,
    placeholderData: (p) => p,
  });
  useClampPage(paging, q.data, q.isPlaceholderData);
  const [pending, setPending] = useState<{ device: DeviceDto; action: Action } | null>(null);
  const m = useOrgMutation<{ id: string; action: Action }, DeviceDto>('POST', (b) => `/devices/${b.id}/${b.action}`);

  const canManage = (d: DeviceDto) => org.can('devices:manage') && (org.grants['devices:manage'] !== 'own' || d.membership_id === org.membership.id);
  const canApprove = org.can('devices:manage', 'org');

  const run = async () => {
    if (!pending) return;
    try {
      await m.mutateAsync({ id: pending.device.id, action: pending.action });
      toast.success(ACTION_COPY[pending.action].done);
      setPending(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!allowed) return <PermissionState />;

  const columns: Column<DeviceDto>[] = [
    ...(org.isManagerView ? [{ key: 'member', header: 'Member', cell: (d: DeviceDto) => <PersonCell name={d.worker_name} />, value: (d: DeviceDto) => d.worker_name, priority: 'primary' as const }] : []),
    {
      key: 'name',
      header: 'Device',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <Laptop className="size-4 shrink-0 text-text-faint" aria-hidden />
          <span className="truncate font-medium">{d.name}</span>
        </span>
      ),
      value: (d) => d.name,
      priority: org.isManagerView ? 'secondary' : 'primary',
    },
    { key: 'platform', header: 'Platform', cell: (d) => PLATFORM[d.platform] ?? humanize(d.platform), value: (d) => d.platform },
    { key: 'os', header: 'OS', cell: (d) => <span className="text-text-muted">{d.os_version ?? '—'}</span>, value: (d) => d.os_version ?? '' },
    { key: 'agent', header: 'App version', cell: (d) => <span className="tabular font-mono text-xs">{d.agent_version ?? '—'}</span>, value: (d) => d.agent_version ?? '' },
    { key: 'status', header: 'Status', cell: (d) => <StatusBadge status={d.status} label={d.status === 'PENDING' ? 'Pending approval' : undefined} />, value: (d) => d.status, priority: 'secondary' },
    {
      key: 'caps',
      header: 'Capabilities',
      sortable: false,
      cell: (d) => {
        const caps = Object.entries(d.capabilities ?? {}).filter(([, v]) => v !== false);
        return caps.length ? (
          <span className="flex max-w-64 flex-wrap gap-1">
            {caps.map(([k, v]) => (
              <Badge key={k} tone="neutral">
                {humanize(k)}
                {typeof v === 'string' && `: ${v}`}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-text-faint">—</span>
        );
      },
    },
    { key: 'seen', header: 'Last seen', cell: (d) => <span className="text-xs text-text-muted">{fmtRelative(d.last_seen_at)}</span>, value: (d) => d.last_seen_at ?? '', priority: 'secondary' },
    { key: 'sync', header: 'Last sync', cell: (d) => <span className="text-xs text-text-muted">{fmtRelative(d.last_sync_at)}</span>, value: (d) => d.last_sync_at ?? '' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: '48px',
      sortable: false,
      cell: (d) => {
        const manage = canManage(d) && d.status !== 'REVOKED';
        const approve = canApprove && d.status === 'PENDING';
        if (!manage && !approve) return null;
        return (
          <div className="flex justify-end">
            <Menu
              trigger={
                <IconButton label={`Actions for ${d.name}`} size="xs">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
            >
              {approve && (
                <MenuItem icon={<CheckCircle2 className="size-3.5" />} onSelect={() => setPending({ device: d, action: 'approve' })}>
                  Approve device
                </MenuItem>
              )}
              {manage && (
                <>
                  <MenuItem icon={<KeyRound className="size-3.5" />} onSelect={() => setPending({ device: d, action: 'reauth' })}>
                    Require sign-in again
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger icon={<ShieldOff className="size-3.5" />} onSelect={() => setPending({ device: d, action: 'revoke' })}>
                    Revoke device
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        );
      },
    },
  ];

  const pendingCount = q.data?.summary.counts.PENDING ?? 0;

  return (
    <>
      <PageHeader title={org.isManagerView ? 'Devices' : 'My devices'} description="Computers running the WorkPulse desktop app. Revoke a device when it is lost, replaced or no longer used." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Devices" actions={pendingCount > 0 ? <StatusBadge status="PENDING" label={`${pendingCount} awaiting approval`} /> : undefined}>
          {q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <DataTable
              rows={q.data?.data}
              columns={columns.map((c) => ({ ...c, sortable: false }))}
              rowKey={(d) => d.id}
              loading={q.isLoading}
              pagination={paging.pagination(q.data)}
              toolbar={
                (q.data?.summary.counts.ALL ?? 0) > 8 || search.term ? (
                  <Input aria-label="Search devices" placeholder="Search device, platform or member…" value={search.input} onChange={(e) => search.setInput(e.target.value)} className="h-7 w-64 text-xs" />
                ) : undefined
              }
              rowClassName={(d) => (d.status === 'REVOKED' ? 'opacity-60' : undefined)}
              caption="Registered devices"
              empty={search.term ? <EmptyState title="No devices match your search" /> : <EmptyState icon={<Laptop className="size-5" />} title="No devices yet" description="Install the desktop app and sign in. The computer appears here after its first sync." />
              }
            />
          )}
        </Panel>
        <Panel title="Download the desktop app">
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="text-text-muted">The desktop app tracks time with activity levels, screenshots and app/URL usage, according to your organization’s tracking policy. The web timer records time only.</p>
            <ul className="flex flex-col gap-1.5">
              {['Windows 10 and 11', 'macOS 12 or later', 'Linux'].map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <Laptop className="size-3.5 text-text-faint" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            <ol className="list-decimal space-y-1 pl-4 text-text-muted">
              <li>Install the app and open it.</li>
              <li>Choose “Sign in”. Your browser opens so you can sign in to WorkPulse securely; the app never sees your password.</li>
              <li>Pick a project and press start. The device appears in this list after its first sync.</li>
            </ol>
            <p className="text-xs text-text-faint">Ask your administrator for the installer for your organization. Activity and screenshots are captured only while the timer is running.</p>
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? ACTION_COPY[pending.action].title : ''}
        confirmLabel={pending ? ACTION_COPY[pending.action].confirm : 'Confirm'}
        danger={pending?.action === 'revoke'}
        loading={m.isPending}
        onConfirm={run}
        description={
          pending && (
            <>
              <p className="mb-2">
                <strong className="text-text">{pending.device.name}</strong>
                {org.isManagerView && ` · ${pending.device.worker_name}`}
              </p>
              <p>{ACTION_COPY[pending.action].body}</p>
            </>
          )
        }
      />
    </>
  );
}
