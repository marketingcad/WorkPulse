'use client';
import { useMemo, useState } from 'react';
import type { AuditLogDto } from '@tallywork/contracts';
import { Badge, Button, DataTable, Drawer, ErrorState, FilterBar, Input, PageHeader, Panel, PermissionState, PersonCell, Select, Stat, fmtDateTime, type Column, type Tone } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { JsonDiff } from '@/components/settings/json-diff';

const TARGET_TYPES = ['organization', 'membership', 'role', 'team', 'project', 'client', 'task', 'timesheet', 'time_entry', 'invoice', 'payment', 'expense', 'device', 'api_key', 'webhook', 'report', 'policy_org', 'policy_team', 'policy_worker'];

function actionTone(a: string): Tone {
  if (/(deleted|revoked|rejected|removed|suspended|void)/.test(a)) return 'danger';
  if (/(created|approved|invited|accepted)/.test(a)) return 'success';
  if (/(updated|changed|edited|replayed)/.test(a)) return 'info';
  if (/(exported|login|viewed)/.test(a)) return 'secondary';
  return 'neutral';
}
const actorLabel = (r: AuditLogDto) => r.actor_name ?? (r.actor_type === 'user' ? 'Unknown user' : r.actor_type === 'system' ? 'System' : `${r.actor_type}${r.actor_id ? ` ${r.actor_id.slice(0, 8)}` : ''}`);
const toIso = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

export default function AuditPage() {
  const org = useOrg();
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(200);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const allowed = org.can('audit:read');
  const q = useOrgQuery<AuditLogDto[]>(allowed ? `/audit-logs${qs({ action: action.trim() || undefined, target_type: targetType || undefined, from: toIso(from), to: toIso(to, true), limit })}` : null, { placeholderData: (p) => p });

  const columns = useMemo<Column<AuditLogDto>[]>(
    () => [
      { key: 'when', header: 'When', priority: 'secondary', value: (r) => r.created_at, cell: (r) => <span className="tabular whitespace-nowrap text-text-muted">{fmtDateTime(r.created_at)}</span> },
      { key: 'actor', header: 'Actor', priority: 'secondary', value: actorLabel, cell: (r) => (r.actor_type === 'user' ? <PersonCell name={actorLabel(r)} size={20} /> : <span className="text-text-muted">{actorLabel(r)}</span>) },
      { key: 'action', header: 'Action', priority: 'primary', value: (r) => r.action, cell: (r) => <Badge tone={actionTone(r.action)} className="font-mono">{r.action}</Badge> },
      {
        key: 'target',
        header: 'Target',
        value: (r) => `${r.target_type ?? ''} ${r.target_id ?? ''}`,
        cell: (r) =>
          r.target_type ? (
            <span className="text-xs">
              {r.target_type}
              {r.target_id && <span className="font-mono text-text-faint"> {r.target_id.slice(0, 8)}</span>}
            </span>
          ) : (
            <span className="text-text-faint">—</span>
          ),
      },
      { key: 'ip', header: 'IP', value: (r) => r.ip_address ?? '', cell: (r) => <span className="font-mono text-xs text-text-muted">{r.ip_address ?? '—'}</span> },
    ],
    [],
  );

  if (!allowed) return <PermissionState />;
  const filtered = !!(action || targetType || from || to);

  return (
    <>
      <PageHeader title="Audit log" description="Every change to settings, people, time and money, with who made it and from where. Entries cannot be edited or deleted." />
      <FilterBar>
        <Input aria-label="Action starts with" placeholder="Action, e.g. policy. or invoice.sent" className="w-60" value={action} onChange={(e) => setAction(e.target.value)} />
        <Select aria-label="Target type" className="w-44" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="">All targets</option>
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label="From date" className="w-36" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-text-faint">–</span>
        <Input type="date" aria-label="To date" className="w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        <Select aria-label="Rows" className="w-28" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[100, 200, 500, 1000].map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setAction('');
              setTargetType('');
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </Button>
        )}
      </FilterBar>
      <Panel footer={q.data && q.data.length >= limit ? `Showing the newest ${limit} entries. Narrow the filters to see older ones.` : undefined}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable rows={q.data} loading={q.isLoading} columns={columns} rowKey={(r) => r.id} onRowClick={setOpen} searchable caption="Audit log" />
        )}
      </Panel>

      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.action ?? ''} subtitle={open ? fmtDateTime(open.created_at) : undefined} width={620}>
        {open && (
          <div className="flex flex-col gap-4 p-5">
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Actor" value={actorLabel(open)} />
              <Stat label="Actor type" value={open.actor_type} />
              <Stat label="Target" value={open.target_type ?? '—'} />
              <Stat label="Target ID" value={<span className="font-mono text-xs">{open.target_id ?? '—'}</span>} />
              <Stat label="IP address" value={<span className="font-mono text-xs">{open.ip_address ?? '—'}</span>} />
              <Stat label="Time" value={new Date(open.created_at).toLocaleString()} />
            </dl>
            <JsonDiff before={open.before} after={open.after} />
          </div>
        )}
      </Drawer>
    </>
  );
}
