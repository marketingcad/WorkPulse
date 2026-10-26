'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, FileUp, History, Lock, MoreHorizontal, Pencil, Plus, Scissors, Send, Trash2 } from 'lucide-react';
import type { InsightsDto, TimeEntryDto, TimeTypeDto, TimesheetDto } from '@tallywork/contracts';
import {
  ActivityBar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  KpiStrip,
  Menu,
  MenuItem,
  MenuSeparator,
  Panel,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Tooltip,
  cx,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtTime,
  humanize,
  useToast,
} from '@tallywork/ui';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, qs, useOrgId, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg } from '@/lib/org';
import { CommentDialog, DeleteEntryDialog, EditEntryDialog, ManualTimeDialog, RevisionsDrawer, SplitEntryDialog } from './entry-dialogs';
import { periodLabel, type TimesheetHistoryItem } from './shared';
import { CsvImportDialog } from './csv-import';
import { TimeTypeBadge } from '@/components/settings/time-types-panel';
import { downloadText, toCsv } from '@/lib/csv';

type Decision = 'approve' | 'reject' | 'request-changes' | 'reopen';

export interface TimesheetViewProps {
  membershipId: string;
  /** Any date inside the period to show. */
  date: string;
  /** Period navigation; omitted in compact mode. */
  onDateChange?: (date: string) => void;
  /** Drawer layout: no period navigation, tighter spacing. */
  compact?: boolean;
  /** Show approve / reject / request changes / reopen when permitted. */
  decisions?: boolean;
  onDecided?: (ts: TimesheetDto, action: Decision) => void;
}

/** Timesheet for one member and one period: header, week grid, entries, approval history. */
export function TimesheetView({ membershipId, date, onDateChange, compact, decisions, onDecided }: TimesheetViewProps) {
  const org = useOrg();
  const toast = useToast();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const isSelf = membershipId === org.membership.id;
  const tsQ = useOrgQuery<TimesheetDto>(`/timesheets${qs({ membership_id: membershipId, date })}`);
  const ts = tsQ.data;
  const entriesQ = useOrgQuery<TimeEntryDto[]>(ts ? `/time-entries${qs({ from: ts.period_start, to: ts.period_end, membership_ids: [membershipId] })}` : null, { enabled: !!ts && org.can('time:read') });
  const [tab, setTab] = useState<'week' | 'entries'>('week');
  const [day, setDay] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [approving, setApproving] = useState(false);
  const [importing, setImporting] = useState(false);
  const today = todayIn(org.membership.timezone || org.organization.timezone);
  const seesMoney = org.can('time:read') && (org.can('rates:read') || org.can('billing:read'));
  const moneyQ = useOrgQuery<InsightsDto>(ts && seesMoney ? `/insights${qs({ from: ts.period_start, to: ts.period_end, membership_ids: [membershipId] })}` : null);
  const money = moneyQ.data?.money_visible ? moneyQ.data : null;
  const fmtM = (m: number | null | undefined) => (m == null ? '—' : fmtMoney(m, money?.currency ?? org.organization.currency));
  const typesQ = useOrgQuery<TimeTypeDto[]>('/time-types?include_archived=true', { staleTime: 60_000 });
  const typeNames = new Map((typesQ.data ?? []).map((t) => [t.id, t.name]));

  const exportCsv = () => {
    if (!ts || !entriesQ.data) return;
    // 4 decimals: summed rows stay within 0.0001 h each of the total shown (2 decimals drifted by up to 0.005 h a row).
    const hours = (s: number) => Math.round((s / 3600) * 10000) / 10000;
    const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
    const rows = [...entriesQ.data]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((e) => [e.local_date, hm(e.started_at), e.ended_at ? hm(e.ended_at) : '', e.project_name ?? '', e.task_title ?? '', e.note ?? '', (e.time_type_id && typeNames.get(e.time_type_id)) || '', e.billable ? 'yes' : 'no', e.source === 'MANUAL' ? 'manual' : 'tracked', hours(e.duration_seconds)]);
    downloadText(`timesheet-${ts.worker_name.replace(/[^\w-]+/g, '_')}-${ts.period_start}.csv`, toCsv(['Date', 'Start', 'End', 'Project', 'Task', 'Note', 'Type', 'Billable', 'Source', 'Hours'], rows));
  };

  const canSubmit = !!ts && (ts.status === 'DRAFT' || ts.status === 'REJECTED') && (isSelf ? org.can('timesheets:submit') : org.can('timesheets:approve'));
  const canDecide = !!decisions && !!ts?.id && org.can('timesheets:approve') && (!isSelf || org.membership.is_owner);
  const canAdd = isSelf ? org.can('manual_time:request') : org.can('manual_time:approve');

  const submit = async () => {
    if (!ts) return;
    setSubmitting(true);
    try {
      await api(`/orgs/${orgId}/timesheets/submit`, { method: 'POST', body: { membership_id: isSelf ? undefined : membershipId, date: ts.period_start, version: ts.version } });
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
      toast.success(isSelf ? 'Timesheet submitted for approval' : `Timesheet submitted for ${ts.worker_name}`);
      setConfirmSubmit(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (action: Decision, comment: string) => {
    if (!ts?.id) return;
    const r = await api<TimesheetDto>(`/orgs/${orgId}/timesheets/${ts.id}/${action}`, { method: 'POST', body: { comment: comment || undefined } });
    void qc.invalidateQueries({ queryKey: ['org', orgId] });
    const msg = { approve: 'Timesheet approved', reject: 'Timesheet rejected', 'request-changes': 'Changes requested; the timesheet is back in draft', reopen: 'Timesheet reopened as draft' }[action];
    toast.success(`${msg} · ${ts.worker_name}`);
    onDecided?.(r, action);
  };

  const approveNow = async () => {
    setApproving(true);
    try {
      await decide('approve', '');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setApproving(false);
    }
  };

  if (tsQ.error) return <Panel><ErrorState error={tsQ.error} onRetry={() => tsQ.refetch()} /></Panel>;
  if (!ts) return <Panel><SkeletonRows rows={6} cols={6} /></Panel>;

  const variance = ts.expected_seconds != null ? ts.total_seconds - ts.expected_seconds : null;
  const showComment = !!ts.comment && (ts.status === 'REJECTED' || ts.status === 'DRAFT');

  return (
    <div className={cx('flex flex-col', compact ? 'gap-3 p-4' : 'gap-4')}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {onDateChange && !compact && (
          <div className="flex items-center gap-1">
            <IconButton label="Previous period" variant="secondary" onClick={() => onDateChange(addDays(ts.period_start, -1))}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="tabular min-w-44 px-1 text-center text-sm font-medium">{periodLabel(ts.period_start, ts.period_end)}</span>
            <IconButton label="Next period" variant="secondary" onClick={() => onDateChange(addDays(ts.period_end, 1))}>
              <ChevronRight className="size-4" />
            </IconButton>
            {(today < ts.period_start || today > ts.period_end) && (
              <Button size="sm" variant="ghost" onClick={() => onDateChange(today)}>
                Current period
              </Button>
            )}
          </div>
        )}
        {compact && <span className="tabular text-sm font-medium">{periodLabel(ts.period_start, ts.period_end)}</span>}
        <StatusBadge status={ts.status} />
        {!isSelf && !compact && <span className="text-sm text-text-muted">{ts.worker_name}</span>}
        {ts.submitted_at && <span className="text-xs text-text-muted">Submitted {fmtDateTime(ts.submitted_at)}</span>}
        {ts.decided_at && ts.decided_by_name && ts.status !== 'SUBMITTED' && (
          <span className="text-xs text-text-muted">
            {humanize(ts.status)} by {ts.decided_by_name} · {fmtDateTime(ts.decided_at)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!compact && entriesQ.data && entriesQ.data.length > 0 && (
            <Button variant="ghost" icon={<Download className="size-3.5" />} onClick={exportCsv}>
              Export CSV
            </Button>
          )}
          {canAdd && !compact && (ts.status === 'DRAFT' || ts.status === 'REJECTED') && (
            <>
              <Button variant="ghost" icon={<FileUp className="size-3.5" />} onClick={() => setImporting(true)}>
                Import CSV
              </Button>
              <Button icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                Add time
              </Button>
            </>
          )}
          {canSubmit && !compact && (
            <Button variant="primary" icon={<Send className="size-3.5" />} onClick={() => setConfirmSubmit(true)}>
              {ts.status === 'REJECTED' ? 'Resubmit' : 'Submit'}
            </Button>
          )}
          {canDecide && ts.status === 'SUBMITTED' && (
            <>
              <Button onClick={() => setDecision('request-changes')}>Request changes</Button>
              <Button variant="danger" onClick={() => setDecision('reject')}>
                Reject
              </Button>
              <Button variant="primary" onClick={approveNow} loading={approving} disabled={ts.late_seconds > 0} title={ts.late_seconds > 0 ? 'Time was added after submission; request changes first' : undefined}>
                Approve
              </Button>
            </>
          )}
          {canDecide && ts.status === 'APPROVED' && <Button onClick={() => setDecision('reopen')}>Reopen</Button>}
        </div>
      </div>

      {ts.late_seconds > 0 && (
        <div role="status" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
          <div className="font-medium text-danger">{org.fmtDuration(ts.late_seconds)} added after this timesheet was submitted</div>
          <p className="mt-0.5 text-text">
            {ts.status === 'APPROVED'
              ? 'This time is locked and not part of the approval. Reopen the timesheet to include it.'
              : 'Usually a desktop app that synced late. Request changes so it can be reviewed and resubmitted.'}
          </p>
        </div>
      )}

      {showComment && (
        <div role="status" className={cx('rounded-md border px-4 py-3 text-sm', ts.status === 'REJECTED' ? 'border-danger/30 bg-danger-soft' : 'border-warning/30 bg-warning-soft')}>
          <div className={cx('font-medium', ts.status === 'REJECTED' ? 'text-danger' : 'text-warning')}>
            {ts.status === 'REJECTED' ? 'Rejected' : 'Changes requested'}
            {ts.decided_by_name && ` by ${ts.decided_by_name}`}
          </div>
          <p className="mt-0.5 text-text">“{ts.comment}”</p>
          {isSelf && <p className="mt-1 text-xs text-text-muted">Fix the entries below, then submit again.</p>}
        </div>
      )}

      <KpiStrip
        items={[
          { label: 'Total', value: org.fmtDuration(ts.total_seconds) },
          { label: 'Billable', value: org.fmtDuration(ts.billable_seconds), hint: ts.total_seconds ? `${Math.round((ts.billable_seconds / ts.total_seconds) * 100)}% of total` : undefined },
          { label: 'Manual', value: org.fmtDuration(ts.manual_seconds), hint: ts.total_seconds ? `${Math.round((ts.manual_seconds / ts.total_seconds) * 100)}% of total` : undefined },
          {
            label: 'Expected vs actual',
            value: ts.expected_seconds != null ? `${org.fmtDuration(ts.total_seconds)} / ${org.fmtDuration(ts.expected_seconds)}` : '—',
            hint: variance != null ? <span className={variance < 0 ? 'text-warning' : 'text-text-muted'}>{variance < 0 ? '−' : '+'}{org.fmtDuration(Math.abs(variance))} {variance < 0 ? 'under' : 'over'}</span> : 'No expected hours set',
          },
          { label: 'Avg activity', value: ts.avg_activity_pct != null ? `${ts.avg_activity_pct}%` : '—' },
          ...(money
            ? [
                { label: 'Est. pay', value: fmtM(money.totals.pay_minor), hint: 'From pay rates; final after approval' },
                { label: 'Est. billable', value: fmtM(money.totals.bill_minor) },
              ]
            : []),
        ]}
      />

      <Panel>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'week' | 'entries')}
          items={[
            { value: 'week', label: 'Week' },
            { value: 'entries', label: 'Entries', count: entriesQ.data?.length },
          ]}
        />
        {tab === 'week' ? (
          <WeekGrid
            ts={ts}
            today={today}
            onDay={(d) => {
              setDay(d);
              setTab('entries');
            }}
          />
        ) : (
          <EntriesList ts={ts} entriesQ={entriesQ} money={money} day={day} onClearDay={() => setDay(null)} onAdd={canAdd && (ts.status === 'DRAFT' || ts.status === 'REJECTED') ? () => setAdding(true) : undefined} />
        )}
      </Panel>

      {ts.id && <HistoryPanel timesheetId={ts.id} />}

      {importing && <CsvImportDialog membershipId={membershipId} onClose={() => setImporting(false)} />}
      {adding && <ManualTimeDialog membershipId={membershipId} defaultDate={day ?? (today >= ts.period_start && today <= ts.period_end ? today : ts.period_start)} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit timesheet?"
        confirmLabel="Submit for approval"
        loading={submitting}
        onConfirm={submit}
        description={`${periodLabel(ts.period_start, ts.period_end)} · ${org.fmtDuration(ts.total_seconds)} total. Entries in this period are locked until the timesheet is approved or returned.`}
      />
      {decision === 'reject' && <CommentDialog title="Reject timesheet" description={`${ts.worker_name} · ${periodLabel(ts.period_start, ts.period_end)}`} confirmLabel="Reject" danger required onConfirm={(c) => decide('reject', c)} onClose={() => setDecision(null)} />}
      {decision === 'request-changes' && <CommentDialog title="Request changes" description="The timesheet goes back to draft and entries unlock so the member can fix them." confirmLabel="Request changes" required onConfirm={(c) => decide('request-changes', c)} onClose={() => setDecision(null)} />}
      {decision === 'reopen' && <CommentDialog title="Reopen timesheet" description="The approved timesheet returns to draft and its billing entries are voided. Not possible once invoiced." confirmLabel="Reopen" required={false} onConfirm={(c) => decide('reopen', c)} onClose={() => setDecision(null)} />}
    </div>
  );
}

// ─── Week grid ───────────────────────────────────────────────────────────────
function WeekGrid({ ts, today, onDay }: { ts: TimesheetDto; today: string; onDay: (d: string) => void }) {
  const org = useOrg();
  const d = org.fmtDuration;
  if (!ts.projects.length) return <EmptyState title="No time in this period" description="Tracked and manual time shows up here by project and day." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Time per project and day</caption>
        <thead>
          <tr className="border-b border-border bg-surface-muted/60">
            <th scope="col" className="sticky left-0 z-10 h-10 min-w-48 bg-surface-muted px-3 text-left text-2xs font-semibold uppercase tracking-wide text-text-muted">
              Project / task
            </th>
            {ts.days.map((x) => (
              <th key={x.date} scope="col" className={cx('px-1 text-center', x.date === today && 'bg-interactive-soft')}>
                <button onClick={() => onDay(x.date)} className="flex w-full flex-col items-center rounded-sm px-1 py-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-interactive" aria-label={`Show entries for ${fmtDate(x.date, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
                  <span className={cx('text-2xs font-semibold uppercase tracking-wide', x.date === today ? 'text-interactive' : 'text-text-muted')}>{fmtDate(x.date, { weekday: 'short' })}</span>
                  <span className={cx('tabular text-xs', x.date === today ? 'font-semibold text-interactive' : 'text-text-muted')}>{fmtDate(x.date, { month: 'numeric', day: 'numeric' })}</span>
                </button>
              </th>
            ))}
            <th scope="col" className="px-3 text-right text-2xs font-semibold uppercase tracking-wide text-text-muted">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ts.projects.map((p) => (
            <tr key={`${p.project_id}:${p.task_id ?? ''}`} className="h-10">
              <th scope="row" className="sticky left-0 z-10 max-w-64 bg-surface px-3 text-left font-normal">
                <span className="block truncate font-medium">{p.project_name}</span>
                {p.task_title && <span className="block truncate text-xs text-text-muted">{p.task_title}</span>}
              </th>
              {ts.days.map((x) => {
                const v = p.days[x.date] ?? 0;
                return (
                  <td key={x.date} className={cx('tabular px-1 text-center', x.date === today && 'bg-interactive-soft/50', v ? 'text-text' : 'text-text-faint')}>
                    {v ? d(v) : '–'}
                  </td>
                );
              })}
              <td className="tabular px-3 text-right font-medium">{d(p.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="h-10 border-t border-border-strong bg-surface-muted/40 font-semibold">
            <th scope="row" className="sticky left-0 z-10 bg-surface-muted px-3 text-left text-2xs uppercase tracking-wide text-text-muted">
              Total
            </th>
            {ts.days.map((x) => (
              <td key={x.date} className={cx('tabular px-1 text-center', x.date === today && 'bg-interactive-soft')}>
                {x.seconds ? d(x.seconds) : '–'}
              </td>
            ))}
            <td className="tabular px-3 text-right">{d(ts.total_seconds)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Entries list ────────────────────────────────────────────────────────────
type EntryAction = { kind: 'edit' | 'split' | 'delete' | 'history' | 'duplicate'; entry: TimeEntryDto };

function EntriesList({ ts, entriesQ, money, day, onClearDay, onAdd }: { ts: TimesheetDto; entriesQ: ReturnType<typeof useOrgQuery<TimeEntryDto[]>>; money: InsightsDto | null; day: string | null; onClearDay: () => void; onAdd?: () => void }) {
  const org = useOrg();
  const dayMoney = useMemo(() => new Map((money?.by_day ?? []).map((x) => [x.date, x])), [money]);
  const typesQ = useOrgQuery<TimeTypeDto[]>('/time-types?include_archived=true', { staleTime: 60_000 });
  const typeOf = useMemo(() => new Map((typesQ.data ?? []).map((t) => [t.id, t])), [typesQ.data]);
  const [action, setAction] = useState<EntryAction | null>(null);
  const isSelf = ts.membership_id === org.membership.id;
  const editGrant = org.grants['time:edit'];
  const mayEdit = !!editGrant && (isSelf || editGrant !== 'own');

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ts.projects) {
      m.set(p.project_id, p.project_name);
      if (p.task_id && p.task_title) m.set(p.task_id, p.task_title);
    }
    return m;
  }, [ts.projects]);

  const groups = useMemo(() => {
    const byDate = new Map<string, TimeEntryDto[]>();
    for (const e of entriesQ.data ?? []) {
      const list = byDate.get(e.local_date) ?? [];
      list.push(e);
      byDate.set(e.local_date, list);
    }
    const dates = day ? [day] : [...byDate.keys()].sort();
    return dates.map((date) => ({ date, entries: byDate.get(date) ?? [] }));
  }, [entriesQ.data, day]);

  if (!org.can('time:read')) return <EmptyState title="Entries not available" description="You can see totals but not individual entries." />;
  if (entriesQ.error) return <ErrorState error={entriesQ.error} onRetry={() => entriesQ.refetch()} />;
  if (entriesQ.isLoading || !entriesQ.data) return <SkeletonRows rows={5} cols={5} />;

  return (
    <div>
      {day && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-muted/50 px-4 py-2 text-sm">
          <span>
            Showing <span className="font-medium">{fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          </span>
          <button onClick={onClearDay} className="text-xs font-medium text-interactive hover:underline">
            Show whole period
          </button>
        </div>
      )}
      {groups.every((g) => !g.entries.length) ? (
        <EmptyState
          title={day ? 'No time on this day' : 'No time entries in this period'}
          description={onAdd ? 'Track time with the desktop app or the web timer, or add time you worked away from the computer.' : undefined}
          action={
            onAdd && (
              <Button icon={<Plus className="size-3.5" />} onClick={onAdd}>
                Add time
              </Button>
            )
          }
        />
      ) : (
        groups.map((g) => (
          <section key={g.date} aria-label={fmtDate(g.date, { weekday: 'long', month: 'long', day: 'numeric' })}>
            <header className="flex items-center justify-between border-b border-border bg-surface-muted/60 px-4 py-1.5">
              <h3 className="text-xs font-semibold">{fmtDate(g.date, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
              <span className="flex flex-wrap items-center justify-end gap-x-3 text-xs">
                <span className="text-text-muted">Billable {org.fmtDuration(g.entries.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0))}</span>
                {money && dayMoney.get(g.date) && (
                  <>
                    <span className="tabular text-text-muted">Wage {fmtMoney(dayMoney.get(g.date)!.pay_minor ?? 0, money.currency)}</span>
                    <span className="tabular text-text-muted">Est. billable {fmtMoney(dayMoney.get(g.date)!.bill_minor ?? 0, money.currency)}</span>
                  </>
                )}
                <span className="tabular font-semibold">{org.fmtDuration(g.entries.reduce((s, e) => s + e.duration_seconds, 0))}</span>
              </span>
            </header>
            <ul className="divide-y divide-border">
              {g.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                  <span className="tabular w-36 shrink-0 text-text-muted">{e.duration_only ? <span className="text-text-faint">Duration entry</span> : `${fmtTime(e.started_at)} – ${fmtTime(e.ended_at)}`}</span>
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block truncate">
                      <span className="font-medium">{e.project_name}</span>
                      {e.task_title && <span className="text-text-muted"> / {e.task_title}</span>}
                    </span>
                    {e.note && <span className="block truncate text-xs text-text-muted">{e.note}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {e.source === 'MANUAL' ? <StatusBadge status="MANUAL" label="Manual" /> : <StatusBadge status={e.tracking_source ?? 'TRACKED'} label={e.tracking_source === 'DESKTOP' ? 'Tracked · Desktop' : e.tracking_source === 'WEB' ? 'Tracked · Web' : 'Tracked'} />}
                    {e.time_type_id && typeOf.get(e.time_type_id) && <TimeTypeBadge type={typeOf.get(e.time_type_id)!} />}
                    {e.edited && <Badge>Edited</Badge>}
                    {!e.billable && <Badge>Non-billable</Badge>}
                  </span>
                  <span className="w-24 shrink-0">
                    <ActivityBar pct={e.activity_pct} />
                  </span>
                  <span className="tabular w-16 shrink-0 text-right font-medium">{org.fmtDuration(e.duration_seconds)}</span>
                  <span className="flex w-14 shrink-0 items-center justify-end gap-0.5">
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
                      {mayEdit && !e.locked && (
                        <>
                          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setAction({ kind: 'edit', entry: e })}>
                            Edit
                          </MenuItem>
                          <MenuItem icon={<Scissors className="size-3.5" />} onSelect={() => setAction({ kind: 'split', entry: e })}>
                            Split
                          </MenuItem>
                        </>
                      )}
                      {onAdd && (
                        <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => setAction({ kind: 'duplicate', entry: e })}>
                          Duplicate
                        </MenuItem>
                      )}
                      <MenuItem icon={<History className="size-3.5" />} onSelect={() => setAction({ kind: 'history', entry: e })}>
                        View history
                      </MenuItem>
                      {mayEdit && !e.locked && (
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
        ))
      )}
      {action?.kind === 'edit' && <EditEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'split' && <SplitEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'delete' && <DeleteEntryDialog entry={action.entry} onClose={() => setAction(null)} />}
      {action?.kind === 'history' && <RevisionsDrawer entry={action.entry} names={names} onClose={() => setAction(null)} />}
      {action?.kind === 'duplicate' && (
        <ManualTimeDialog
          membershipId={action.entry.membership_id}
          defaultDate={action.entry.local_date}
          prefill={{ projectId: action.entry.project_id, taskId: action.entry.task_id, note: action.entry.note, timeTypeId: action.entry.time_type_id ?? null, durationSeconds: action.entry.duration_seconds }}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}

// ─── Approval history ────────────────────────────────────────────────────────
function HistoryPanel({ timesheetId }: { timesheetId: string }) {
  const [open, setOpen] = useState(false);
  const q = useOrgQuery<TimesheetHistoryItem[]>(open ? `/timesheets/${timesheetId}/history` : null);
  return (
    <Panel
      title={
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-sm font-semibold">
          {open ? <ChevronUp className="size-4 text-text-faint" /> : <ChevronDown className="size-4 text-text-faint" />}
          Approval history
        </button>
      }
    >
      {open &&
        (q.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="No approval actions yet" description="Submissions and decisions will be listed here." />
        ) : (
          <ol className="divide-y divide-border">
            {[...q.data].reverse().map((h, i) => (
              <li key={`${h.created_at}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="w-32 shrink-0 text-xs text-text-muted">{fmtDateTime(h.created_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{h.actor_name || 'System'}</span> <span className="text-text-muted">{humanize(h.action).toLowerCase()}</span>
                  {h.comment && <span className="mt-0.5 block text-text-muted">“{h.comment}”</span>}
                </span>
                <span className="flex items-center gap-1 text-xs">
                  <StatusBadge status={h.from} />
                  <ChevronRight className="size-3 text-text-faint" aria-label="to" />
                  <StatusBadge status={h.to} />
                </span>
              </li>
            ))}
          </ol>
        ))}
    </Panel>
  );
}
