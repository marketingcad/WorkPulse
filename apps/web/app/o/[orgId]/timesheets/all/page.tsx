'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CalendarOff, Copy, Download, History, Lock, MoreHorizontal, Pencil, Plus, Save, Scissors, Trash2 } from 'lucide-react';
import type { ClientDto, InsightsDto, ProjectDto, TaskDto, TimeEntryDto, TimeTypeDto, WorkerDto } from '@tallywork/contracts';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  SkeletonRows,
  StatusBadge,
  Tooltip,
  cx,
  fmtDate,
  fmtMoney,
  fmtTime,
  useToast,
} from '@tallywork/ui';
import { api, errorMessage, qs, useOrgId, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { downloadText, toCsv } from '@/lib/csv';
import { DeleteEntryDialog, EditEntryDialog, ManualTimeDialog, RevisionsDrawer, SplitEntryDialog } from '@/components/timesheets/entry-dialogs';
import { TimeTypeBadge } from '@/components/settings/time-types-panel';
import { useQueryClient } from '@tanstack/react-query';

type Preset = 'today' | 'yesterday' | 'this_week' | 'prev_week' | 'this_month' | 'prev_month' | 'custom';
type Action = {
  kind: 'edit' | 'split' | 'delete' | 'history' | 'duplicate';
  entry: TimeEntryDto;
};
interface TimeOffRow {
  id: string;
  membership_id: string;
  worker_name: string;
  policy_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

function presetRange(p: Exclude<Preset, 'custom'>, today: string, weekStart: number): { from: string; to: string } {
  const ws = weekStartOf(today, weekStart);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const month = (offset: number) => {
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    return {
      from: first.toISOString().slice(0, 10),
      to: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
    };
  };
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: ws, to: addDays(ws, 6) };
    case 'prev_week':
      return { from: addDays(ws, -7), to: addDays(ws, -1) };
    case 'this_month':
      return month(0);
    case 'prev_month':
      return month(-1);
  }
}
const PRESETS: Array<{ value: Exclude<Preset, 'custom'>; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'prev_week', label: 'Prev week' },
  { value: 'this_month', label: 'This month' },
  { value: 'prev_month', label: 'Prev month' },
];

/** One timesheet across every member you can see: filter, add, edit and bulk-change time. */
export default function AllTimeEntriesPage() {
  const org = useOrg();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIn(org.organization.timezone);
  const [preset, setPreset] = useState<Preset>('this_week');
  const [custom, setCustom] = useState(() => presetRange('this_week', today, org.organization.week_start));
  const range = preset === 'custom' ? custom : presetRange(preset, today, org.organization.week_start);
  const [member, setMember] = useState('');
  const [client, setClient] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [desc, setDesc] = useState(true);
  const [showLeaves, setShowLeaves] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'delete' | 'set_billable' | 'set_non_billable' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const workersQ = useOrgQuery<WorkerDto[]>(org.can('members:read') ? '/workers' : null);
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);
  const projectsQ = useOrgQuery<ProjectDto[]>('/projects');
  const tasksQ = useOrgQuery<TaskDto[]>(project && org.can('tasks:read') ? `/projects/${project}/tasks` : null);
  const typesQ = useOrgQuery<TimeTypeDto[]>('/time-types?include_archived=true', { staleTime: 60_000 });
  const entriesQ = useOrgQuery<TimeEntryDto[]>(
    org.can('time:read')
      ? `/time-entries${qs({ from: range.from, to: range.to, membership_ids: member ? [member] : undefined, client_id: client || undefined, project_ids: project ? [project] : undefined, task_id: task || undefined })}`
      : null,
  );
  // Money per day is only exact when the list is not narrowed below member level.
  const seesMoney = (org.can('rates:read') || org.can('billing:read')) && !client && !project && !task;
  const moneyQ = useOrgQuery<InsightsDto>(seesMoney ? `/insights${qs({ from: range.from, to: range.to, membership_ids: member ? [member] : undefined })}` : null);
  const leavesQ = useOrgQuery<TimeOffRow[]>(
    showLeaves && org.can('time_off:read') ? `/time-off/requests${qs({ status: 'APPROVED', from: range.from, to: range.to, membership_ids: member ? [member] : undefined })}` : null,
  );

  const typeOf = useMemo(() => new Map((typesQ.data ?? []).map((t) => [t.id, t])), [typesQ.data]);
  const projects = (projectsQ.data ?? []).filter((p) => !client || p.client_id === client);
  const editGrant = org.grants['time:edit'];
  const mayEdit = (e: TimeEntryDto) => !e.locked && !!editGrant && (e.membership_id === org.membership.id || editGrant !== 'own');
  const canAdd = org.can('manual_time:approve') || org.can('manual_time:request');
  const d = org.fmtDuration;

  const entries = entriesQ.data ?? [];
  // Readable names for the entry history (project/task ids in revisions).
  const names = useMemo(() => {
    const m = new Map<string, string>((projectsQ.data ?? []).map((p) => [p.id, p.name]));
    for (const e of entriesQ.data ?? []) if (e.task_id && e.task_title) m.set(e.task_id, e.task_title);
    return m;
  }, [projectsQ.data, entriesQ.data]);
  const days = useMemo(() => {
    const byDate = new Map<string, TimeEntryDto[]>();
    for (const e of entries) byDate.set(e.local_date, [...(byDate.get(e.local_date) ?? []), e]);
    if (showLeaves)
      for (const l of leavesQ.data ?? [])
        for (let dt = l.start_date < range.from ? range.from : l.start_date; dt <= l.end_date && dt <= range.to; dt = addDays(dt, 1)) if (!byDate.has(dt)) byDate.set(dt, []);
    return [...byDate.entries()].sort(([a], [b]) => (desc ? b.localeCompare(a) : a.localeCompare(b)));
  }, [entries, desc, showLeaves, leavesQ.data, range.from, range.to]);
  const dayMoney = useMemo(() => new Map((moneyQ.data?.by_day ?? []).map((x) => [x.date, x])), [moneyQ.data]);
  const leavesOn = (date: string) => (leavesQ.data ?? []).filter((l) => l.start_date <= date && l.end_date >= date);
  const total = entries.reduce((s, e) => s + e.duration_seconds, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0);
  const selectable = entries.filter(mayEdit);
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  if (!org.can('time:read')) return <PermissionState />;

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const runBulk = async () => {
    if (!bulk) return;
    setBulkBusy(true);
    try {
      const res = await api<Array<{ id: string; ok: boolean; error?: string }>>(`/orgs/${orgId}/time-entries/bulk`, { method: 'POST', body: { ids: [...selected], action: bulk, reason: bulkReason.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
      const failed = res.filter((r) => !r.ok);
      if (failed.length) toast.error(`${res.length - failed.length} updated, ${failed.length} could not be changed: ${failed[0]!.error}`);
      else toast.success(`${res.length} ${res.length === 1 ? 'entry' : 'entries'} updated`);
      setSelected(new Set(failed.map((f) => f.id)));
      setBulk(null);
      setBulkReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };
  const exportCsv = () => {
    const hours = (s: number) => Math.round((s / 3600) * 100) / 100;
    const rows = [...entries]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((e) => [
        e.local_date,
        e.worker_name ?? '',
        e.client_name ?? '',
        e.project_name ?? '',
        e.task_title ?? '',
        e.note ?? '',
        e.duration_only ? '' : fmtTime(e.started_at),
        e.duration_only ? '' : fmtTime(e.ended_at),
        (e.time_type_id && typeOf.get(e.time_type_id)?.name) || '',
        e.billable ? 'yes' : 'no',
        hours(e.duration_seconds),
      ]);
    downloadText(`time-entries-${range.from}-to-${range.to}.csv`, toCsv(['Date', 'Member', 'Client', 'Project', 'Task', 'Work performed', 'Start', 'End', 'Type', 'Billable', 'Hours'], rows));
  };

  return (
    <>
      <PageHeader
        title="All time entries"
        description="Everyone's time in one list. Filter, add, correct and bulk-change entries; periods still follow timesheet approval."
        actions={
          <>
            {org.can('reports:read') && (
              <Button icon={<Save className="size-3.5" />} onClick={() => setSaveOpen(true)}>
                Save as report
              </Button>
            )}
            <Button icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={!entries.length}>
              Export CSV
            </Button>
            {canAdd && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(today)}>
                Add time
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPreset(p.value)}
            className={cx('h-7 rounded-full px-3 text-xs font-medium', preset === p.value ? 'bg-interactive-soft text-interactive' : 'text-text-muted hover:bg-surface-muted')}
            aria-pressed={preset === p.value}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <span className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From"
            value={range.from}
            onChange={(e) => (
              setCustom({
                from: e.target.value,
                to: range.to < e.target.value ? e.target.value : range.to,
              }),
              setPreset('custom')
            )}
            className="h-7 w-36 text-xs"
          />
          <span className="text-xs text-text-muted">–</span>
          <Input
            type="date"
            aria-label="To"
            value={range.to}
            min={range.from}
            onChange={(e) => (setCustom({ from: range.from, to: e.target.value }), setPreset('custom'))}
            className="h-7 w-36 text-xs"
          />
        </span>
      </div>

      <FilterBar>
        {org.can('members:read') && (
          <Select aria-label="Member" value={member} onChange={(e) => (setMember(e.target.value), setSelected(new Set()))} className="h-8 w-48">
            <option value="">All members</option>
            {(workersQ.data ?? [])
              .filter((w) => w.status !== 'REMOVED')
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </Select>
        )}
        {org.can('clients:read') && (
          <Select aria-label="Client" value={client} onChange={(e) => (setClient(e.target.value), setProject(''), setTask(''))} className="h-8 w-44">
            <option value="">All clients</option>
            {(clientsQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Project" value={project} onChange={(e) => (setProject(e.target.value), setTask(''))} className="h-8 w-52">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {project && (
          <Select aria-label="Task" value={task} onChange={(e) => setTask(e.target.value)} className="h-8 w-44">
            <option value="">All tasks</option>
            {(tasksQ.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        )}
        {org.can('time_off:read') && <Checkbox label="Show leaves" checked={showLeaves} onChange={(e) => setShowLeaves(e.target.checked)} className="text-xs" />}
        <Button size="sm" variant="ghost" icon={desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />} onClick={() => setDesc((v) => !v)} className="ml-auto">
          {desc ? 'Newest first' : 'Oldest first'}
        </Button>
      </FilterBar>

      {selected.size > 0 && (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-interactive/30 bg-interactive-soft px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="xs" onClick={() => setBulk('set_billable')}>
            Mark billable
          </Button>
          <Button size="xs" onClick={() => setBulk('set_non_billable')}>
            Mark non-billable
          </Button>
          <Button size="xs" variant="danger" icon={<Trash2 className="size-3" />} onClick={() => setBulk('delete')}>
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
            Clear
          </Button>
        </div>
      )}

      <Panel>
        {entriesQ.error ? (
          <ErrorState error={entriesQ.error} onRetry={() => entriesQ.refetch()} />
        ) : entriesQ.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : !days.length ? (
          <EmptyState
            title="No time in this range"
            description="Change the dates or filters, or add time."
            action={canAdd && <Button onClick={() => setAdding(range.to > today ? today : range.to)}>Add time</Button>}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-text-muted">
              <Checkbox aria-label="Select all editable entries" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.id)))} />
              <span>{entries.length} entries</span>
            </div>
            {days.map(([date, list]) => {
              const secs = list.reduce((s, e) => s + e.duration_seconds, 0);
              const bill = list.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0);
              const money = dayMoney.get(date);
              const leaves = showLeaves ? leavesOn(date) : [];
              return (
                <section
                  key={date}
                  aria-label={fmtDate(date, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                >
                  <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-muted/60 px-4 py-1.5 text-xs">
                    {canAdd && (
                      <IconButton label={`Add time on ${fmtDate(date)}`} size="xs" onClick={() => setAdding(date)}>
                        <Plus className="size-3.5" />
                      </IconButton>
                    )}
                    <h3 className="font-semibold">
                      {fmtDate(date, {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </h3>
                    {list.length > 0 && (
                      <>
                        <span className="text-text-muted">
                          Logged <span className="tabular font-medium text-text">{d(secs)}</span>
                        </span>
                        <span className="text-text-muted">
                          Billable <span className="tabular font-medium text-text">{d(bill)}</span>
                        </span>
                        {money && money.pay_minor !== null && (
                          <span className="text-text-muted">
                            Est. pay <span className="tabular font-medium text-text">{fmtMoney(money.pay_minor, moneyQ.data!.currency)}</span>
                          </span>
                        )}
                        {money && money.bill_minor !== null && (
                          <span className="text-text-muted">
                            Est. billable <span className="tabular font-medium text-text">{fmtMoney(money.bill_minor, moneyQ.data!.currency)}</span>
                          </span>
                        )}
                      </>
                    )}
                  </header>
                  {leaves.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-b border-border px-4 py-1.5">
                      {leaves.map((l) => (
                        <Badge key={l.id} tone="info" icon={<CalendarOff className="size-3" />}>
                          {l.worker_name} · {l.policy_name}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <ul className="divide-y divide-border">
                    {list
                      .sort((a, b) => (desc ? b.started_at.localeCompare(a.started_at) : a.started_at.localeCompare(b.started_at)))
                      .map((e) => (
                        <li
                          key={e.id}
                          className={cx(
                            'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm xl:grid xl:grid-cols-[auto_8rem_minmax(0,1fr)_8.5rem_10.5rem_3.5rem_3.5rem] xl:flex-nowrap',
                            selected.has(e.id) && 'bg-interactive-soft/40',
                          )}
                        >
                          <Checkbox aria-label="Select entry" checked={selected.has(e.id)} disabled={!mayEdit(e)} onChange={() => toggle(e.id)} />
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar name={e.worker_name ?? '?'} size={22} />
                            <span className="truncate">{e.worker_name}</span>
                          </span>
                          <span className="min-w-0 flex-1 basis-56 xl:basis-auto">
                            <span className="block truncate">
                              {e.client_name && <span className="text-text-muted">{e.client_name} · </span>}
                              <span className="font-medium">{e.project_name}</span>
                              {e.task_title && <span className="text-text-muted"> / {e.task_title}</span>}
                            </span>
                            {e.note && <span className="block truncate text-xs text-text-muted">{e.note}</span>}
                          </span>
                          <span className="tabular shrink-0 whitespace-nowrap text-xs text-text-muted">{e.duration_only ? 'Duration entry' : `${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}`}</span>
                          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                            {e.source === 'MANUAL' ? <StatusBadge status="MANUAL" label="Manual" /> : <StatusBadge status={e.tracking_source ?? 'TRACKED'} label="Tracked" />}
                            {e.time_type_id && typeOf.get(e.time_type_id) && <TimeTypeBadge type={typeOf.get(e.time_type_id)!} />}
                            {!e.billable && <Badge>Non-billable</Badge>}
                          </span>
                          <span className="tabular shrink-0 text-right font-medium">{d(e.duration_seconds)}</span>
                          <span className="flex shrink-0 items-center justify-end gap-0.5">
                            {e.locked && (
                              <Tooltip content="Locked: part of a submitted or approved timesheet, or older than your organization allows changing">
                                <span className="inline-flex p-1 text-text-faint" aria-label="Locked" role="img">
                                  <Lock className="size-3.5" />
                                </span>
                              </Tooltip>
                            )}
                            <Menu
                              trigger={
                                <IconButton label="Entry actions" size="xs">
                                  <MoreHorizontal className="size-3.5" />
                                </IconButton>
                              }
                            >
                              {mayEdit(e) && (
                                <>
                                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setAction({ kind: 'edit', entry: e })}>
                                    Edit
                                  </MenuItem>
                                  <MenuItem icon={<Scissors className="size-3.5" />} onSelect={() => setAction({ kind: 'split', entry: e })}>
                                    Split
                                  </MenuItem>
                                </>
                              )}
                              {canAdd && (
                                <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => setAction({ kind: 'duplicate', entry: e })}>
                                  Duplicate
                                </MenuItem>
                              )}
                              <MenuItem icon={<History className="size-3.5" />} onSelect={() => setAction({ kind: 'history', entry: e })}>
                                View history
                              </MenuItem>
                              {mayEdit(e) && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => setAction({ kind: 'delete', entry: e })}>
                                    Delete
                                  </MenuItem>
                                </>
                              )}
                            </Menu>
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              );
            })}
            <footer className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border-strong bg-surface-muted/40 px-4 py-2.5 text-sm">
              <span className="text-text-muted">
                Time logged <span className="tabular font-semibold text-text">{d(total)}</span>
              </span>
              <span className="text-text-muted">
                Billable time <span className="tabular font-semibold text-text">{d(billable)}</span>
              </span>
              {moneyQ.data?.money_visible && (
                <>
                  <span className="text-text-muted">
                    Est. pay <span className="tabular font-semibold text-text">{fmtMoney(moneyQ.data.totals.pay_minor ?? 0, moneyQ.data.currency)}</span>
                  </span>
                  <span className="text-text-muted">
                    Est. billable <span className="tabular font-semibold text-text">{fmtMoney(moneyQ.data.totals.bill_minor ?? 0, moneyQ.data.currency)}</span>
                  </span>
                </>
              )}
            </footer>
          </>
        )}
      </Panel>

      {adding && <ManualTimeDialog membershipId={member || undefined} defaultDate={adding} onClose={() => setAdding(null)} />}
      {action?.kind === 'edit' && <EditEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'split' && <SplitEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'delete' && <DeleteEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'history' && <RevisionsDrawer entry={action.entry} names={names} onClose={() => setAction(null)} />}
      {action?.kind === 'duplicate' && (
        <ManualTimeDialog
          membershipId={action.entry.membership_id}
          defaultDate={action.entry.local_date}
          prefill={{
            projectId: action.entry.project_id,
            taskId: action.entry.task_id,
            note: action.entry.note,
            timeTypeId: action.entry.time_type_id ?? null,
            durationSeconds: action.entry.duration_seconds,
          }}
          onClose={() => setAction(null)}
        />
      )}
      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(o) => !o && setBulk(null)}
        title={`${bulk === 'delete' ? 'Delete' : bulk === 'set_billable' ? 'Mark billable:' : 'Mark non-billable:'} ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}${bulk === 'delete' ? '?' : ''}`}
        description={
          <>
            <p>
              {bulk === 'delete' ? 'Deleted time is removed from timesheets and reports. ' : ''}Each change is kept in the entry history. Entries in submitted or approved timesheets can't be
              changed and are left selected.
            </p>
            <Field label="Reason" htmlFor="bulk-reason" hint="Saved to the history of each entry. Your organization may require it." className="mt-3">
              <Input id="bulk-reason" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} maxLength={500} />
            </Field>
          </>
        }
        confirmLabel={bulk === 'delete' ? 'Delete' : 'Apply'}
        danger={bulk === 'delete'}
        loading={bulkBusy}
        onConfirm={runBulk}
      />
      <SaveAsReportDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        params={{
          from: range.from,
          to: range.to,
          membership_ids: member ? [member] : undefined,
          client_ids: client ? [client] : undefined,
          project_ids: project ? [project] : undefined,
          group_by: ['date', 'worker', 'project'],
        }}
      />
    </>
  );
}

function SaveAsReportDialog({ open, onClose, params }: { open: boolean; onClose: () => void; params: Record<string, unknown> }) {
  const org = useOrg();
  const orgId = useOrgId();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/saved-reports`, {
        method: 'POST',
        body: { report_key: 'time-activity', name: name.trim(), params },
      });
      toast.success('Report saved');
      setName('');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Save as report"
      description="Saves these dates and filters as a Time & Activity report, grouped by day, member and project."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Save report
          </Button>
        </>
      }
    >
      <Field
        label="Report name"
        htmlFor="sr-name"
        required
        hint={
          <Link href={`${org.base}/reports`} className="text-interactive hover:underline">
            Saved reports are listed under Reports.
          </Link>
        }
      >
        <Input id="sr-name" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme hours this month" />
      </Field>
    </Dialog>
  );
}
