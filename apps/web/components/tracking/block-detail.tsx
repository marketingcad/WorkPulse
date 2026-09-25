'use client';
import { ChevronLeft, ChevronRight, ExternalLink, EyeOff, Trash2, X } from 'lucide-react';
import type { ActivityBlockDto } from '@tallywork/contracts';
import { ActivityBar, Button, IconButton, Kbd, Stat, StatusBadge, Badge, cx, fmtTime } from '@tallywork/ui';
import { useOrg } from '@/lib/org';

export const LOW_ACTIVITY_PCT = 20;
export const BLOCK_MS = 600_000;

export function blockRange(b: ActivityBlockDto, tz: string): string {
  const t = Date.parse(b.window_start);
  return `${fmtTime(b.window_start, tz)} – ${fmtTime(new Date(t + BLOCK_MS).toISOString(), tz)}`;
}

export function isLow(b: ActivityBlockDto): boolean {
  return !b.manual && b.activity_pct < LOW_ACTIVITY_PCT;
}

export type BlockShot = ActivityBlockDto['screenshots'][number];

/**
 * One capture = every display photographed at the same moment (the agent stamps all
 * displays of one capture with the same captured_at). Captures are in time order and
 * each capture's screens are ordered Screen 1, Screen 2, …
 */
export function groupCaptures(shots: BlockShot[]): BlockShot[][] {
  const byTime = new Map<string, BlockShot[]>();
  for (const s of shots) byTime.set(s.captured_at, [...(byTime.get(s.captured_at) ?? []), s]);
  return [...byTime.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([, group]) => group.sort((a, b) => a.display_index - b.display_index));
}

export function screenLabel(s: BlockShot): string {
  return `Screen ${s.display_index + 1}`;
}

/** Detail body for one 10-minute block: full screenshot(s), activity split, work item, actions. */
export function BlockDetail({
  block,
  tz,
  shotIdx,
  onShotIdx,
  onPrev,
  onNext,
  onClose,
  onDelete,
  canDelete,
  inline,
}: {
  block: ActivityBlockDto;
  tz: string;
  shotIdx: number;
  onShotIdx: (i: number) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose?: () => void;
  onDelete: ((shotId: string) => void) | null;
  canDelete: boolean;
  /** rendered as the inline right pane (shows its own header) */
  inline?: boolean;
}) {
  const org = useOrg();
  // shotIdx selects a capture (a moment in time); every screen of that capture is shown.
  const captures = groupCaptures(block.screenshots);
  const capture = captures[Math.min(shotIdx, captures.length - 1)] ?? [];
  const shot = capture[0];
  const multi = capture.length > 1;
  return (
    <div className="flex flex-col">
      <div className={cx('flex items-center gap-1 border-b border-border px-3 py-2', !inline && 'justify-between')}>
        {inline && (
          <div className="mr-auto min-w-0">
            <div className="tabular truncate text-sm font-semibold">{blockRange(block, tz)}</div>
            <div className="text-2xs text-text-muted">10-minute block</div>
          </div>
        )}
        <Button size="xs" variant="ghost" icon={<ChevronLeft className="size-3.5" />} disabled={!onPrev} onClick={() => onPrev?.()} aria-label="Previous block">
          Prev
        </Button>
        <Button size="xs" variant="ghost" disabled={!onNext} onClick={() => onNext?.()} aria-label="Next block">
          Next
          <ChevronRight className="size-3.5" />
        </Button>
        {inline && onClose && (
          <IconButton label="Close details" size="xs" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>

      {shot ? (
        <div className="border-b border-border bg-surface-sunken p-3">
          <div className="flex flex-col gap-2">
            {capture.map((s) => (
              <figure key={s.id} className="m-0">
                {multi && <figcaption className="mb-1 text-2xs font-medium text-text-muted">{screenLabel(s)}</figcaption>}
                <a href={s.full_url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-sm border border-border bg-surface" title={`Open ${multi ? screenLabel(s).toLowerCase() : 'screenshot'} full size in a new tab`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.full_url} alt={`${multi ? `${screenLabel(s)}, ` : ''}screenshot captured at ${fmtTime(s.captured_at, tz)}${s.blurred ? ' (blurred)' : ''}`} className="block w-full" />
                  <span className="absolute right-1.5 top-1.5 hidden rounded-sm bg-surface/90 p-1 text-text-muted group-hover:block">
                    <ExternalLink className="size-3.5" aria-hidden />
                  </span>
                </a>
              </figure>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="tabular">
              Captured {fmtTime(shot.captured_at, tz)}
              {multi && ` · ${capture.length} screens`}
            </span>
            {capture.some((s) => s.blurred) && (
              <Badge tone="neutral" icon={<EyeOff className="size-3" />}>
                Blurred by policy
              </Badge>
            )}
            {captures.length > 1 && (
              <div className="ml-auto flex gap-1" role="group" aria-label="Captures in this block">
                {captures.map((c, i) => (
                  <button
                    key={c[0]!.id}
                    onClick={() => onShotIdx(i)}
                    aria-pressed={i === shotIdx}
                    className={cx('tabular rounded-sm border px-1.5 py-0.5 text-2xs', i === shotIdx ? 'border-interactive bg-interactive-soft text-interactive' : 'border-border hover:bg-surface-muted')}
                  >
                    {fmtTime(c[0]!.captured_at, tz)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-border px-4 py-6 text-center text-sm text-text-muted">{block.manual ? 'Manual time has no screenshots or activity.' : 'No screenshot was captured in this block.'}</div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
        <Stat label="Tracked" value={org.fmtDuration(block.tracked_seconds)} />
        <div className="min-w-0">
          <dt className="text-xs text-text-muted">Activity</dt>
          <dd className="mt-0.5">{block.manual ? <span className="text-sm text-text-faint">Not measured</span> : <ActivityBar pct={block.activity_pct} keyboardPct={block.keyboard_pct} mousePct={block.mouse_pct} />}</dd>
        </div>
        {!block.manual && (
          <>
            <Stat label="Keyboard" value={`${block.keyboard_pct}%`} />
            <Stat label="Mouse" value={`${block.mouse_pct}%`} />
          </>
        )}
        <Stat label="Project" value={block.project_name || '—'} className="col-span-2" />
        {block.task_title && <Stat label="Task" value={block.task_title} className="col-span-2" />}
      </dl>
      {(block.idle || block.manual || isLow(block)) && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {block.idle && <StatusBadge status="IDLE" label="Includes idle time" />}
          {block.manual && <StatusBadge status="MANUAL" label="Manual time" />}
          {isLow(block) && <StatusBadge status="warning" label={`Low activity (under ${LOW_ACTIVITY_PCT}%)`} />}
        </div>
      )}

      {shot && canDelete && onDelete && (
        <div className="flex flex-wrap gap-1 border-t border-border px-4 py-3">
          {/* Each screen is its own screenshot, so it can be deleted on its own (e.g. only the screen that showed something private). */}
          {capture.map((s) => (
            <Button key={s.id} size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(s.id)}>
              {multi ? `Delete ${screenLabel(s).toLowerCase()}` : 'Delete screenshot'}
            </Button>
          ))}
        </div>
      )}
      <div className="hidden border-t border-border px-4 py-2.5 text-2xs text-text-faint lg:block">
        <Kbd>←</Kbd> <Kbd>→</Kbd> block · <Kbd>↑</Kbd> <Kbd>↓</Kbd> hour · <Kbd>[</Kbd> <Kbd>]</Kbd> day · <Kbd>Esc</Kbd> close
      </div>
    </div>
  );
}
