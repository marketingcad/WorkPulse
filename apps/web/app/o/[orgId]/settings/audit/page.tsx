'use client';
import { useEffect, useMemo, useState } from 'react';
import type { AuditLogDto, OffsetPage } from '@tallywork/contracts';
import { Badge, Button, DataTable, Drawer, ErrorState, FilterBar, Input, PageHeader, Panel, PermissionState, PersonCell, Select, Stat, cx, fmtDateTime, useToast, type Column, type Tone } from '@tallywork/ui';
import { api, errorMessage, qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { downloadText, toCsv } from '@/lib/csv';
import { Download } from 'lucide-react';
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
const PAGE_SIZES = [25, 50, 100, 200];
/** The API's cap for a CSV export (the newest matching entries). */
const EXPORT_LIMIT = 1000;

export default function AuditPage() {
  const org = useOrg();
  const toast = useToast();
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const allowed = org.can('audit:read');
  const filters = { action: action.trim() || undefined, target_type: targetType || undefined, from: toIso(from), to: toIso(to, true), order };
  const q = useOrgQuery<OffsetPage<AuditLogDto>>(allowed ? `/audit-logs${qs({ ...filters, page: page + 1, page_size: pageSize })}` : null, { placeholderData: (p) => p });
  const total = q.data?.total ?? 0;

  // Query once typing pauses rather than on every keystroke; a new filter starts at page 1.
  useEffect(() => {
    if (actionInput === action) return;
    const id = setTimeout(() => {
      setAction(actionInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [actionInput, action]);

  // Entries can disappear under you (retention); if this page is now past the end, go to the last one.
  useEffect(() => {
    if (q.data && !q.isPlaceholderData && page > 0 && page * pageSize >= q.data.total) setPage(Math.max(0, Math.ceil(q.data.total / pageSize) - 1));
  }, [q.data, q.isPlaceholderData, page, pageSize]);

  // Rows come back already filtered, ordered and paged by the server, so columns aren't client-sortable.
  const columns = useMemo<Column<AuditLogDto>[]>(
    () => [
      { key: 'when', header: 'When', priority: 'secondary', sortable: false, cell: (r) => <span className="tabular whitespace-nowrap text-text-muted">{fmtDateTime(r.created_at)}</span> },
      { key: 'actor', header: 'Actor', priority: 'secondary', sortable: false, cell: (r) => (r.actor_type === 'user' ? <PersonCell name={actorLabel(r)} size={20} /> : <span className="text-text-muted">{actorLabel(r)}</span>) },
      { key: 'action', header: 'Action', priority: 'primary', sortable: false, cell: (r) => <Badge tone={actionTone(r.action)} className="font-mono">{r.action}</Badge> },
      {
        key: 'target',
        header: 'Target',
        sortable: false,
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
      { key: 'ip', header: 'IP', sortable: false, cell:(r) => <span className="font-mono text-xs text-text-muted">{r.ip_address ?? '—'}</span> },
    ],
    [],
  );

  if (!allowed) return <PermissionState />;
  const filtered = !!(actionInput || targetType || from || to);
  // The export covers every matching entry (up to the API cap), not just the page on screen.
  const exportCsv = async () => {
    setExporting(true);
    let entries: AuditLogDto[];
    try {
      entries = await api<AuditLogDto[]>(`/orgs/${org.organization.id}/audit-logs${qs({ ...filters, limit: EXPORT_LIMIT })}`);
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    } finally {
      setExporting(false);
    }
    if (total > entries.length) toast.info(`Exported the ${order === 'desc' ? 'newest' : 'oldest'} ${entries.length} of ${total} entries. Narrow the dates to export the rest.`);
    const rows = entries.map((r) => [r.created_at, actorLabel(r), r.action, r.target_type ?? '', r.target_id ?? '', r.ip_address ?? '', r.before === null || r.before === undefined ? '' : JSON.stringify(r.before), r.after === null || r.after === undefined ? '' : JSON.stringify(r.after)]);
    downloadText('audit-log.csv', toCsv(['When (UTC)', 'Actor', 'Action', 'Target type', 'Target id', 'IP', 'Before', 'After'], rows));
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to settings, people, time and money, with who made it and from where. Entries cannot be edited or deleted."
        actions={
          <Button icon={<Download className="size-3.5" />} onClick={exportCsv} loading={exporting} disabled={!total}>
            Export CSV
          </Button>
        }
      />
      <FilterBar>
        <Input aria-label="Action starts with" placeholder="Action, e.g. policy. or invoice.sent" className="w-60" value={actionInput} onChange={(e) => setActionInput(e.target.value)} />
        <Select
          aria-label="Target type"
          className="w-44"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All targets</option>
          {TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label="From date"
          className="w-36"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
        />
        <span className="text-text-faint">–</span>
        <Input
          type="date"
          aria-label="To date"
          className="w-36"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
        />
        <Select
          aria-label="Order"
          className="w-36"
          value={order}
          onChange={(e) => {
            setOrder(e.target.value as 'desc' | 'asc');
            setPage(0);
          }}
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setActionInput('');
              setAction('');
              setTargetType('');
              setFrom('');
              setTo('');
              setPage(0);
            }}
          >
            Clear
          </Button>
        )}
      </FilterBar>
      <Panel>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          // Keeps the previous page on screen (dimmed) while the next one loads.
          <div aria-busy={q.isFetching} className={cx('transition-opacity', q.isPlaceholderData && 'opacity-60')}>
            <DataTable
              rows={q.data?.data}
              loading={q.isLoading}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={setOpen}
              caption="Audit log"
              pagination={{
                page,
                pageSize,
                total,
                onPageChange: setPage,
                pageSizeOptions: PAGE_SIZES,
                onPageSizeChange: (size) => {
                  // Keep the first entry on screen in view at the new size.
                  setPage(Math.floor((page * pageSize) / size));
                  setPageSize(size);
                },
              }}
            />
          </div>
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
