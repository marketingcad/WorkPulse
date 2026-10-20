'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, FileText, Search, Users, Activity as ActivityIcon } from 'lucide-react';
import type { EodReportDto } from '@tallywork/contracts';
import { Badge, Button, Dialog, EmptyState, ErrorState, FilterBar, Input, KpiStrip, PageHeader, PermissionState, PersonCell, Select, SkeletonRows, Panel, fmtTime, useToast } from '@tallywork/ui';
import { qs, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { DateRangeFilter, MemberFilter, useDefaultRange } from '@/components/tracking/filters';
import type { DateRange } from '@/components/tracking/time';
import { HelpLink } from '@/components/help/help-link';

/** A local date ('YYYY-MM-DD') as "Tuesday, October 20", without a time-zone shift. */
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(`${d}T12:00:00`).toLocaleDateString([], opts);

/**
 * End-of-day reports: what each person completed, written when they clock out in the desktop app.
 * Grouped by day, with a short preview on each card and the full report (with its session) in a
 * dialog that pages through the list.
 */
export default function EodReportsPage() {
  const org = useOrg();
  const [range, setRange] = useState<DateRange>(useDefaultRange('this_week'));
  const [member, setMember] = useState('');
  const [show, setShow] = useState<'all' | 'finished'>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const allowed = org.can('tracking:read');
  const q = useOrgQuery<EodReportDto[]>(allowed ? `/eod-reports${qs({ from: range.from, to: range.to, membership_ids: member || undefined })}` : null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => (show === 'all' || r.finished) && (!term || `${r.body} ${r.worker_name} ${r.project_name} ${r.task_title ?? ''}`.toLowerCase().includes(term)));
  }, [q.data, show, search]);
  const days = useMemo(() => {
    const m = new Map<string, EodReportDto[]>();
    for (const r of rows) m.set(r.local_date, [...(m.get(r.local_date) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  // The dialog pages through reports in the order shown.
  const ordered = useMemo(() => days.flatMap(([, list]) => list), [days]);
  const at = ordered.findIndex((r) => r.id === openId);

  if (!allowed) return <PermissionState />;
  const people = new Set(rows.map((r) => r.membership_id)).size;
  const finished = rows.filter((r) => r.finished).length;
  const worked = rows.reduce((s, r) => s + r.worked_seconds, 0);

  return (
    <>
      <PageHeader title="End-of-day reports" description="What each person completed, written when they clock out in the desktop app." actions={<HelpLink article="eod-reports" />} />
      <FilterBar>
        <DateRangeFilter value={range} onChange={setRange} />
        <MemberFilter value={member} onChange={setMember} />
        <Select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as 'all' | 'finished')} className="w-44">
          <option value="all">All reports</option>
          <option value="finished">Finished work only</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
          <Input aria-label="Search reports" placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 pl-8" />
        </div>
      </FilterBar>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <Panel>
          <SkeletonRows rows={4} cols={3} />
        </Panel>
      ) : (
        <>
          <KpiStrip
            className="mb-6"
            items={[
              { label: 'Reports', value: rows.length, icon: <FileText />, tone: 'blue' },
              { label: 'People reporting', value: people, icon: <Users />, tone: 'violet' },
              { label: 'Marked finished', value: finished, icon: <CheckCircle2 />, tone: 'green' },
              { label: 'Time covered', value: org.fmtDuration(worked), icon: <Clock3 />, tone: 'amber' },
            ]}
          />
          {!rows.length ? (
            <Panel>
              {search.trim() ? (
                <EmptyState title={`No reports mention “${search.trim()}”`} description="Try another word, or clear the search." action={<Button onClick={() => setSearch('')}>Clear search</Button>} />
              ) : show === 'finished' && q.data?.length ? (
                <EmptyState title="No finished work in this period" description="Reports where the person ticked “This work is finished” appear here." />
              ) : (
                <EmptyState title="No end-of-day reports in this period" description="A report is written each time someone clocks out in the desktop app. Try a wider date range." />
              )}
            </Panel>
          ) : (
            <div className="flex flex-col gap-8">
              {days.map(([day, list]) => (
                <section key={day} aria-labelledby={`day-${day}`}>
                  <header className="mb-3 flex items-baseline gap-3">
                    <h2 id={`day-${day}`} className="text-base font-semibold">
                      {fmtDay(day)}
                    </h2>
                    <span className="text-xs text-text-muted">
                      {list.length} {list.length === 1 ? 'report' : 'reports'} · {org.fmtDuration(list.reduce((s, r) => s + r.worked_seconds, 0))}
                    </span>
                  </header>
                  <ul className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
                    {list.map((r) => (
                      <li key={r.id} className="min-w-0">
                        <ReportCard r={r} onOpen={() => setOpenId(r.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {at >= 0 && <ReportDialog r={ordered[at]!} position={{ index: at, total: ordered.length }} onPrev={() => setOpenId(ordered[at - 1]?.id ?? openId)} onNext={() => setOpenId(ordered[at + 1]?.id ?? openId)} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ProjectTag({ r }: { r: EodReportDto }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs">
      <span className="size-2 shrink-0 rounded-full" style={{ background: r.project_color }} aria-hidden />
      <span className="truncate">
        <span className="font-medium">{r.project_name}</span>
        {r.task_title && <span className="text-text-muted"> / {r.task_title}</span>}
      </span>
    </span>
  );
}

function ReportCard({ r, onOpen }: { r: EodReportDto; onOpen: () => void }) {
  const org = useOrg();
  return (
    <article aria-label={`${r.worker_name}, ${fmtDay(r.local_date, { weekday: 'short', month: 'short', day: 'numeric' })}`} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <PersonCell name={r.worker_name} />
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="tabular text-xs text-text-muted">
            {fmtTime(r.started_at)}–{r.ended_at ? fmtTime(r.ended_at) : '…'}
          </span>
          <span className="tabular text-sm font-semibold">{org.fmtDuration(r.worked_seconds)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ProjectTag r={r} />
        {r.finished && (
          <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>
            Finished
          </Badge>
        )}
      </div>
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{r.body}</p>
      <button onClick={onOpen} aria-label={`Read full report from ${r.worker_name}`} className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-interactive hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive">
        Read full report <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </article>
  );
}

function ReportDialog({ r, position, onPrev, onNext, onClose }: { r: EodReportDto; position: { index: number; total: number }; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const org = useOrg();
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.body);
      toast.success('Report copied');
    } catch {
      toast.error('Could not copy the report');
    }
  };
  const tz = org.membership.timezone || org.organization.timezone;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={r.worker_name}
      description={`End-of-day report · ${fmtDay(r.local_date)}`}
      width={640}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button size="sm" icon={<ChevronLeft className="size-3.5" />} onClick={onPrev} disabled={position.index === 0} aria-label="Previous report">
            Previous
          </Button>
          <span className="tabular text-xs text-text-muted">
            {position.index + 1} of {position.total}
          </span>
          <Button size="sm" onClick={onNext} disabled={position.index === position.total - 1} aria-label="Next report">
            Next <ChevronRight className="size-3.5" />
          </Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>
              Copy report
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-border bg-surface-muted p-3 text-sm sm:grid-cols-4">
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-text-muted">Project</dt>
            <dd className="mt-0.5">
              <ProjectTag r={r} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Clocked in – out</dt>
            <dd className="tabular mt-0.5 font-medium">
              {fmtTime(r.started_at)}–{r.ended_at ? fmtTime(r.ended_at) : '…'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Worked</dt>
            <dd className="tabular mt-0.5 font-medium">{org.fmtDuration(r.worked_seconds)}</dd>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-text-muted">Status</dt>
            <dd className="mt-0.5">{r.finished ? <Badge tone="success">Finished: the person marked this work as complete</Badge> : <span className="text-text-muted">In progress</span>}</dd>
          </div>
        </dl>
        <section aria-label="Report">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">What they completed</h3>
          <p className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border p-4 text-[15px] leading-relaxed">{r.body}</p>
        </section>
        <Link href={`${org.base}/activity?member=${r.membership_id}&date=${r.local_date}`} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-interactive hover:underline">
          <ActivityIcon className="size-3.5" aria-hidden /> View activity for this day
        </Link>
        <span className="sr-only">Times are shown in {tz}.</span>
      </div>
    </Dialog>
  );
}
