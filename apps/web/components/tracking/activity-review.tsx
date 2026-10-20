'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, EyeOff, ImageOff, ListTree, Monitor, PauseCircle, PenLine } from 'lucide-react';
import type { ActivityBlockDto, ActivityDayDto, EffectivePolicyDto, LiveWorkerDto } from '@tallywork/contracts';
import {
  ActivityBar,
  Avatar,
  Button,
  Checkbox,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Kbd,
  KpiStrip,
  Panel,
  SegmentedControl,
  Select,
  SkeletonRows,
  cx,
  fmtDate,
  fmtTime,
  useToast,
} from '@tallywork/ui';
import { errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg } from '@/lib/org';
import { DayRibbon } from '@/components/charts';
import { BLOCK_MS, BlockDetail, blockRange, groupCaptures, isLow } from './block-detail';
import { useTrackedWorkers } from './filters';
import { SpansDrawer } from './spans-drawer';
import { dayStartMs, localDateOf } from './time';

type Level = 'all' | 'lt25' | '25_50' | '50_75' | 'gt75';
const LEVELS: Array<{ value: Level; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'lt25', label: '<25%' },
  { value: '25_50', label: '25–50%' },
  { value: '50_75', label: '50–75%' },
  { value: 'gt75', label: '>75%' },
];
const HOUR_MS = 3_600_000;

function levelMatch(b: ActivityBlockDto, l: Level): boolean {
  if (l === 'all') return true;
  if (b.manual) return false;
  const p = b.activity_pct;
  return l === 'lt25' ? p < 25 : l === '25_50' ? p >= 25 && p < 50 : l === '50_75' ? p >= 50 && p < 75 : p >= 75;
}

function useIsWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

export function ActivityReview({ member: memberParam, date, onChange }: { member: string | null; date: string | null; onChange: (p: { member?: string; date?: string }) => void }) {
  const org = useOrg();
  const toast = useToast();
  const wide = useIsWide();
  const self = org.membership.id;
  const workers = useTrackedWorkers();
  const live = useOrgQuery<LiveWorkerDto[]>(org.isManagerView ? '/tracking/live' : null, { refetchInterval: 60_000 });
  const liveBy = useMemo(() => new Map((live.data ?? []).map((w) => [w.membership_id, w.status])), [live.data]);

  // Workers only ever see themselves. Managers review their team: with no member in the link, default
  // to someone working now, else on a break, else who tracked most today, else whose device was seen
  // last, so the page opens on real activity.
  const others = (live.data ?? []).filter((w) => w.membership_id !== self);
  const seenAt = (w: LiveWorkerDto) => (w.last_seen_at ? Date.parse(w.last_seen_at) : 0);
  const recent =
    others.find((w) => w.status === 'WORKING') ??
    others.find((w) => w.status === 'IDLE') ??
    [...others].filter((w) => w.today_seconds > 0).sort((a, b) => b.today_seconds - a.today_seconds)[0] ??
    [...others].sort((a, b) => seenAt(b) - seenAt(a)).find((w) => w.last_seen_at);
  const firstOther = recent?.membership_id ?? workers.rows?.find((w) => w.id !== self)?.id;
  // Wait for who is working before choosing, so the page doesn't open on the wrong person first.
  const member = !org.isManagerView ? self : memberParam || (live.isLoading ? null : firstOther || self);
  const worker = workers.rows?.find((w) => w.id === member);
  const memberName = member === self ? 'You' : (worker?.name ?? 'Member');
  const fallbackTz = worker?.timezone || org.membership.timezone || org.organization.timezone;
  const today = todayIn(fallbackTz);
  // With no date in the link, open on the member's last day of activity when nothing is tracked today.
  const seen = live.data?.find((w) => w.membership_id === member);
  const lastDay = seen && seen.status === 'OFFLINE' && !seen.today_seconds && seen.last_seen_at ? localDateOf(seen.last_seen_at, fallbackTz) : null;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (lastDay ?? today);

  const dayQ = useOrgQuery<ActivityDayDto>(member ? `/activity/day${qs({ membership_id: member, date: day })}` : null, { refetchInterval: 10 * 60_000 });
  const data = dayQ.data;
  const tz = data?.timezone ?? fallbackTz;
  const start = dayStartMs(day, tz);

  const [level, setLevel] = useState<Level>('all');
  const [onlyShots, setOnlyShots] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [memberSearch, setMemberSearch] = useState('');
  const [spansOpen, setSpansOpen] = useState<'apps' | 'urls' | null>(null);
  const [spansDate, setSpansDate] = useState(day);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removeTime, setRemoveTime] = useState(false);

  useEffect(() => {
    setSelected(null);
    setShotIdx(0);
    setSpansDate(day);
  }, [member, day]);

  // Screenshot deletion rules (server enforces; UI explains).
  const deleteGrant = org.grants['screenshots:delete'];
  const own = member === self;
  const serverDecides = own && deleteGrant === 'own';
  const policyQ = useOrgQuery<EffectivePolicyDto>(serverDecides ? `/workers/${self}/effective-policy` : null, { staleTime: 5 * 60_000 });
  const canDelete = !!deleteGrant && (deleteGrant !== 'own' || own) && (!serverDecides || policyQ.data?.policy.screenshots.workerCanDelete === true);
  const del = useOrgMutation<{ id: string; remove: boolean }>('DELETE', (b) => `/screenshots/${b.id}?remove_time=${b.remove}`);

  const visible = useMemo(() => (data?.blocks ?? []).filter((b) => (!onlyShots || b.screenshots.length > 0) && levelMatch(b, level)), [data, onlyShots, level]);
  const hours = useMemo(() => {
    const m = new Map<number, Array<ActivityBlockDto | null>>();
    for (const b of visible) {
      const off = Date.parse(b.window_start) - start;
      const h = Math.floor(off / HOUR_MS);
      if (h < 0 || h > 24) continue;
      const slot = Math.min(5, Math.floor((off - h * HOUR_MS) / BLOCK_MS));
      const row = m.get(h) ?? Array.from({ length: 6 }, () => null);
      row[slot] = b;
      m.set(h, row);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible, start]);

  const idx = selected ? visible.findIndex((b) => b.window_start === selected) : -1;
  const block = idx >= 0 ? visible[idx]! : null;
  const select = useCallback((b: ActivityBlockDto | undefined) => {
    if (!b) return;
    setSelected(b.window_start);
    setShotIdx(0);
    requestAnimationFrame(() => document.getElementById(`blk-${b.window_start}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);
  const hourOf = (b: ActivityBlockDto) => Math.floor((Date.parse(b.window_start) - start) / HOUR_MS);

  const scrollToHour = (h: number) => {
    const target = hours.find(([hh]) => hh >= h) ?? hours[hours.length - 1];
    if (target) document.getElementById(`hour-${target[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goDay = (n: number) => {
    const d = addDays(day, n);
    if (d > today) return;
    onChange({ date: d });
  };

  // Keyboard: ←/→ block, ↑/↓ hour, [/] day, J/K member, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return;
      if (deleting || spansOpen) return;
      if (document.querySelector('[role="dialog"]') && !(block && !wide)) return;
      const list = visible;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          select(idx < 0 ? list[0] : list[Math.min(list.length - 1, idx + 1)]);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          select(idx < 0 ? list[list.length - 1] : list[Math.max(0, idx - 1)]);
          break;
        case 'ArrowDown':
        case 'ArrowUp': {
          if (!block) return;
          e.preventDefault();
          const h = hourOf(block);
          const next = e.key === 'ArrowDown' ? list.find((b) => hourOf(b) > h) : [...list].reverse().find((b) => hourOf(b) < h);
          select(next);
          break;
        }
        case '[':
          goDay(-1);
          break;
        case ']':
          goDay(1);
          break;
        case 'j':
        case 'k': {
          const rows = workers.rows ?? [];
          if (!org.isManagerView || !rows.length) return;
          const i = rows.findIndex((w) => w.id === member);
          const n = rows[(i + (e.key === 'j' ? 1 : -1) + rows.length) % rows.length];
          if (n) onChange({ member: n.id });
          break;
        }
        case 'Escape':
          if (block && wide) setSelected(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync({ id: deleting, remove: serverDecides ? false : removeTime });
      toast.success(serverDecides ? (policyQ.data?.policy.screenshots.deleteRemovesTime ? 'Screenshot deleted and its time removed' : 'Screenshot deleted') : removeTime ? 'Screenshot deleted and its time removed' : 'Screenshot deleted');
      setDeleting(null);
      setRemoveTime(false);
      setShotIdx(0);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const shotsCount = data?.blocks.reduce((s, b) => s + b.screenshots.length, 0) ?? 0;
  const flagged = data?.blocks.filter((b) => isLow(b) || b.idle).length ?? 0;
  const filteredOut = (data?.blocks.length ?? 0) - visible.length;
  const shownMembers = (workers.rows ?? []).filter((w) => !memberSearch || w.name.toLowerCase().includes(memberSearch.toLowerCase()));

  const detail = block && (
    <BlockDetail
      block={block}
      tz={tz}
      shotIdx={shotIdx}
      onShotIdx={setShotIdx}
      onPrev={idx > 0 ? () => select(visible[idx - 1]) : null}
      onNext={idx < visible.length - 1 ? () => select(visible[idx + 1]) : null}
      onClose={() => setSelected(null)}
      onDelete={(id) => setDeleting(id)}
      canDelete={canDelete}
      inline={wide}
    />
  );

  const usagePanel = (className?: string) =>
    data && org.can('apps:read') ? (
      <Panel title="Apps & URLs" className={className}>
        {data.apps.length === 0 && data.urls.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-muted">No app or URL usage recorded for this day.</p>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            {(['apps', 'urls'] as const).map((k) =>
              data[k].length ? (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted">{k === 'apps' ? 'Apps' : 'Sites'}</span>
                    <Button size="xs" variant="ghost" icon={<ListTree className="size-3" />} onClick={() => setSpansOpen(k)}>
                      Timeline
                    </Button>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {data[k].slice(0, 6).map((a) => (
                      <li key={a.name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate" title={a.name}>
                          {a.name}
                        </span>
                        <span className="tabular shrink-0 text-text-muted">{org.fmtDuration(a.seconds)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        )}
      </Panel>
    ) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_380px]">
      {/* LEFT RAIL */}
      <aside className="flex min-w-0 flex-col gap-4" aria-label="Day and member">
        <Panel title="Day">
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-1">
              <IconButton label="Previous day ( [ )" size="sm" variant="secondary" onClick={() => goDay(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Input type="date" aria-label="Date" value={day} max={today} onChange={(e) => e.target.value && onChange({ date: e.target.value })} className="flex-1" />
              <IconButton label="Next day ( ] )" size="sm" variant="secondary" onClick={() => goDay(1)} disabled={day >= today}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <Button size="sm" icon={<CalendarDays className="size-3.5" />} onClick={() => onChange({ date: today })} disabled={day === today}>
              Today
            </Button>
          </div>
        </Panel>

        {org.isManagerView && (
          <Panel title="Members" actions={<span className="tabular text-2xs text-text-faint">{workers.rows?.length ?? 0}</span>}>
            <div className="p-3 lg:hidden">
              <Select aria-label="Member" value={member ?? ''} onChange={(e) => onChange({ member: e.target.value })}>
                {!member && <option value="">Choose a member…</option>}
                {workers.rows?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hidden lg:block">
              {(workers.rows?.length ?? 0) > 8 && (
                <div className="border-b border-border p-2">
                  <Input aria-label="Filter members" placeholder="Filter members…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="h-7" />
                </div>
              )}
              {workers.isLoading ? (
                <SkeletonRows rows={5} cols={1} />
              ) : (
                <ul className="max-h-[50vh] overflow-y-auto py-1" aria-label="Members">
                  {shownMembers.map((w) => {
                    const st = liveBy.get(w.id);
                    const active = w.id === member;
                    return (
                      <li key={w.id}>
                        <button
                          onClick={() => onChange({ member: w.id })}
                          aria-current={active ? 'true' : undefined}
                          className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', active ? 'bg-interactive-soft font-medium text-interactive' : 'hover:bg-surface-muted')}
                        >
                          <Avatar name={w.name} size={20} />
                          <span className="min-w-0 flex-1 truncate">{w.name}</span>
                          {st && (
                            <span className={cx('size-2 shrink-0 rounded-full', st === 'WORKING' ? 'bg-success' : st === 'IDLE' ? 'bg-warning' : 'bg-text-faint')} title={st === 'WORKING' ? 'Working' : st === 'IDLE' ? 'Idle' : 'Offline'}>
                              <span className="sr-only">{st === 'WORKING' ? 'Working' : st === 'IDLE' ? 'Idle' : 'Offline'}</span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {shownMembers.length === 0 && <li className="px-3 py-2 text-xs text-text-muted">No members match.</li>}
                </ul>
              )}
            </div>
          </Panel>
        )}
        {usagePanel('hidden lg:flex')}
      </aside>

      {/* CENTER */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {memberName} <span className="font-normal text-text-muted">· {fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </h2>
          {data && data.timezone !== (org.membership.timezone || org.organization.timezone) && <span className="text-xs text-text-faint">Times shown in {data.timezone}</span>}
        </div>

        {!member && live.isLoading ? (
          <Panel>
            <SkeletonRows rows={8} cols={6} />
          </Panel>
        ) : !member ? (
          <Panel>
            <EmptyState title="Pick a member" description="Choose someone from the member list to review their day." />
          </Panel>
        ) : dayQ.error ? (
          <Panel>
            <ErrorState error={dayQ.error} onRetry={() => void dayQ.refetch()} />
          </Panel>
        ) : dayQ.isLoading || !data ? (
          <Panel>
            <SkeletonRows rows={8} cols={6} />
          </Panel>
        ) : (
          <>
            <KpiStrip
              items={[
                { label: 'Worked', value: org.fmtDuration(data.total_seconds) },
                { label: 'Average activity', value: data.blocks.some((b) => !b.manual) ? `${data.avg_activity_pct}%` : '—' },
                { label: 'Screenshots', value: shotsCount },
                { label: 'Flagged blocks', value: flagged, hint: 'low activity or idle' },
              ]}
            />
            <Panel title="Timeline" bodyClassName="p-4">
              <DayRibbon segments={data.timeline} dayStart={start} dayEnd={start + 24 * HOUR_MS} onSelect={scrollToHour} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-[1px] bg-secondary" /> Tracked (project colour)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-[1px] border border-dashed border-info bg-info/40" /> Manual
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-[1px]" style={{ backgroundImage: 'repeating-linear-gradient(135deg, var(--color-warning) 0 2px, transparent 2px 5px)' }} /> Idle
                </span>
                <span className="ml-auto hidden text-text-faint sm:inline">Click the timeline to jump to an hour</span>
              </div>
            </Panel>

            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl size="xs" label="Activity level" value={level} onChange={setLevel} options={LEVELS} />
              <Checkbox label="Only blocks with screenshots" checked={onlyShots} onChange={(e) => setOnlyShots(e.target.checked)} />
              {filteredOut > 0 && (
                <span className="text-xs text-text-muted">
                  {filteredOut} block{filteredOut === 1 ? '' : 's'} hidden by filters ·{' '}
                  <button
                    className="font-medium text-interactive hover:underline"
                    onClick={() => {
                      setLevel('all');
                      setOnlyShots(false);
                    }}
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>

            {data.blocks.length === 0 ? (
              <Panel>
                <EmptyState
                  title={day === today && member === self ? 'Nothing tracked yet today' : 'No time tracked on this day'}
                  description={day === today && member === self ? 'Track time with the desktop app or the web timer. Your 10-minute blocks appear here.' : 'Use the arrows or [ and ] to move to another day.'}
                />
              </Panel>
            ) : hours.length === 0 ? (
              <Panel>
                <EmptyState title="No blocks match these filters" description="Change the activity level or show blocks without screenshots." />
              </Panel>
            ) : (
              <div className="flex flex-col gap-3">
                {hours.map(([h, slots]) => {
                  const secs = slots.reduce((s, b) => s + (b?.tracked_seconds ?? 0), 0);
                  return (
                    <section key={h} id={`hour-${h}`} className="scroll-mt-4 rounded-md border border-border bg-surface" aria-label={`Hour starting ${fmtTime(new Date(start + h * HOUR_MS).toISOString(), tz)}`}>
                      <header className="flex items-center justify-between border-b border-border px-3 py-1.5">
                        <span className="tabular text-sm font-semibold">{fmtTime(new Date(start + h * HOUR_MS).toISOString(), tz)}</span>
                        <span className="tabular text-xs text-text-muted">{org.fmtDuration(secs)}</span>
                      </header>
                      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-6">
                        {slots.map((b, i) =>
                          b ? (
                            <BlockTile key={b.window_start} block={b} tz={tz} selected={b.window_start === selected} onSelect={() => select(b)} />
                          ) : (
                            <div key={`empty-${i}`} aria-hidden className="hidden min-h-24 rounded-sm border border-dashed border-border bg-surface-muted/40 lg:block" />
                          ),
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            {usagePanel('lg:hidden')}
          </>
        )}
      </div>

      {/* RIGHT PANE (wide screens) */}
      {wide && (
        <aside className="min-w-0" aria-label="Block details">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-border bg-surface">
            {detail ?? (
              <div className="flex flex-col gap-3 p-4 text-sm text-text-muted">
                <p className="font-medium text-text">Select a block</p>
                <p>Click any 10-minute block to see its full screenshot, activity split and work item.</p>
                <ul className="flex flex-col gap-1.5 text-xs">
                  <li>
                    <Kbd>←</Kbd> <Kbd>→</Kbd> previous / next block
                  </li>
                  <li>
                    <Kbd>↑</Kbd> <Kbd>↓</Kbd> previous / next hour
                  </li>
                  <li>
                    <Kbd>[</Kbd> <Kbd>]</Kbd> previous / next day
                  </li>
                  {org.isManagerView && (
                    <li>
                      <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous member
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </aside>
      )}
      {!wide && (
        <Drawer open={!!block} onOpenChange={(o) => !o && setSelected(null)} title={block ? blockRange(block, tz) : ''} subtitle={memberName} width={560}>
          {detail}
        </Drawer>
      )}

      <SpansDrawer
        kind={spansOpen ?? 'apps'}
        target={spansOpen && member ? { membershipId: member, name: memberName, date: spansDate } : null}
        onDateChange={setSpansDate}
        onClose={() => setSpansOpen(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setRemoveTime(false);
          }
        }}
        title="Delete this screenshot?"
        danger
        confirmLabel="Delete screenshot"
        loading={del.isPending}
        onConfirm={confirmDelete}
        description={
          serverDecides ? (
            <p>
              The screenshot is removed permanently.{' '}
              {policyQ.data?.policy.screenshots.deleteRemovesTime ? (
                <strong className="text-text">Your organization’s policy also removes the 10 minutes of tracked time in this block.</strong>
              ) : (
                'Your tracked time for this block is kept.'
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>The screenshot is removed permanently and the deletion is recorded in the audit log.</p>
              <Checkbox label="Also remove the tracked time in this 10-minute block" checked={removeTime} onChange={(e) => setRemoveTime(e.target.checked)} />
            </div>
          )
        }
      />
    </div>
  );
}

function BlockTile({ block: b, tz, selected, onSelect }: { block: ActivityBlockDto; tz: string; selected: boolean; onSelect: () => void }) {
  const captures = groupCaptures(b.screenshots);
  // The tile previews the first capture with every screen side by side (2 screens: halves; 3–4: quarters).
  const screens = captures[0] ?? [];
  const shot = screens[0];
  const low = isLow(b);
  return (
    <button
      id={`blk-${b.window_start}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${blockRange(b, tz)}, ${b.manual ? 'manual time' : `activity ${b.activity_pct}%`}, ${b.project_name}${screens.length > 1 ? `, ${screens.length} screens` : ''}${b.idle ? ', includes idle' : ''}${low ? ', low activity' : ''}`}
      className={cx(
        'group flex min-w-0 flex-col overflow-hidden rounded-sm border bg-surface text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive/40',
        selected ? 'border-interactive ring-2 ring-interactive/30' : 'border-border hover:border-border-strong',
      )}
    >
      <div className="relative aspect-[16/10] w-full bg-surface-sunken">
        {shot ? (
          <div className={cx('grid size-full gap-px bg-border', screens.length === 2 && 'grid-cols-2', screens.length > 2 && 'grid-cols-2 grid-rows-2')}>
            {screens.slice(0, 4).map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.id} src={s.thumb_url} alt="" loading="lazy" className={cx('size-full min-h-0 min-w-0 object-cover', s.blurred && 'blur-[1.5px]')} />
            ))}
          </div>
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-2xs text-text-faint">
            {b.manual ? <PenLine className="size-4" aria-hidden /> : <ImageOff className="size-4" aria-hidden />}
            {b.manual ? 'Manual time' : 'No screenshot'}
          </span>
        )}
        {shot?.blurred && (
          <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-sm bg-surface/90 px-1 text-[10px] text-text-muted">
            <EyeOff className="size-2.5" aria-hidden />
            Blurred
          </span>
        )}
        {screens.length > 1 && (
          <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded-sm bg-surface/90 px-1 text-[10px] font-medium text-text" title={`${screens.length} screens`}>
            <Monitor className="size-2.5" aria-hidden />
            {screens.length}
          </span>
        )}
        {captures.length > 1 && (
          <span className="tabular absolute right-1 top-1 rounded-sm bg-surface/90 px-1 text-[10px] font-medium text-text" title={`${captures.length} captures in this block`}>
            {captures.length}×
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-1.5 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="tabular truncate text-[11px] text-text-muted">{fmtTime(b.window_start, tz)}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {b.idle && <PauseCircle className="size-3 text-warning" aria-hidden />}
            {b.manual && <PenLine className="size-3 text-info" aria-hidden />}
            {low && <AlertTriangle className="size-3 text-warning" aria-hidden />}
          </span>
        </div>
        {b.manual ? <span className="text-[11px] text-text-faint">No activity data</span> : <ActivityBar pct={b.activity_pct} keyboardPct={b.keyboard_pct} mousePct={b.mouse_pct} />}
        <span className="truncate text-[11px]" title={`${b.project_name}${b.task_title ? ` / ${b.task_title}` : ''}`}>
          {b.project_name}
          {b.task_title && <span className="text-text-muted"> / {b.task_title}</span>}
        </span>
      </div>
    </button>
  );
}
