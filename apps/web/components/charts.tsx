'use client';
import { cx, fmtTime } from '@tallywork/ui';

/**
 * The web app's charts come from `@tallywork/ui/charts` (columns, ranked bars, donut, meters); this
 * file keeps the one chart only the web app has: the day ribbon of the activity review.
 */

const KIND_LABEL: Record<string, string> = { IDLE: 'Idle', MANUAL: 'Manual time', WORK: 'Tracked' };

/** 24h day ribbon: work blocks colored by project, idle hatched, manual dashed. */
export function DayRibbon({ segments, dayStart, dayEnd, onSelect, timeZone }: { segments: Array<{ start: string; end: string; kind: string; color: string | null }>; dayStart: number; dayEnd: number; onSelect?: (hour: number) => void; timeZone?: string }) {
  const span = dayEnd - dayStart;
  const label = (s: { start: string; end: string; kind: string }) => `${KIND_LABEL[s.kind] ?? s.kind}, ${fmtTime(s.start, timeZone)} – ${fmtTime(s.end, timeZone)}`;
  const shown = segments.filter((s) => Math.min(1, (Date.parse(s.end) - dayStart) / span) > Math.max(0, (Date.parse(s.start) - dayStart) / span));
  return (
    <div>
      <div className="relative h-8 overflow-hidden rounded-md bg-surface-sunken ring-1 ring-inset ring-border" role="group" aria-label="Timeline of the day">
        {/* Hour grid */}
        {Array.from({ length: 23 }, (_, h) => (
          <span key={h} aria-hidden className={cx('absolute inset-y-0 border-l', (h + 1) % 6 === 0 ? 'border-chart-grid' : 'border-transparent')} style={{ left: `${((h + 1) / 24) * 100}%` }} />
        ))}
        {shown.map((s, i) => {
          const a = Math.max(0, (Date.parse(s.start) - dayStart) / span);
          const b = Math.min(1, (Date.parse(s.end) - dayStart) / span);
          const pos = { left: `${a * 100}%`, width: `${(b - a) * 100}%` };
          const style: React.CSSProperties =
            s.kind === 'IDLE'
              ? { ...pos, backgroundImage: 'repeating-linear-gradient(135deg, var(--color-warning) 0 2px, transparent 2px 6px)', opacity: 0.75 }
              : s.kind === 'MANUAL'
                ? { ...pos, background: s.color ?? 'var(--color-info)', opacity: 0.45, outline: '1px dashed var(--color-info)', outlineOffset: -1 }
                : { ...pos, background: s.color ?? 'var(--color-chart-2)' };
          return <span key={i} className="absolute inset-y-1 rounded-[2px]" style={style} title={label(s)} />;
        })}
        {onSelect && (
          <div className="absolute inset-0 grid grid-cols-24">
            {Array.from({ length: 24 }, (_, h) => (
              <button key={h} className="hover:bg-text/5 focus-visible:bg-text/10 focus-visible:outline-none" aria-label={`Jump to ${h}:00`} onClick={() => onSelect(h)} />
            ))}
          </div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-6 text-[10px] tabular text-text-faint sm:grid-cols-12" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={cx(i % 2 === 1 && 'hidden sm:block')}>
            {String(i * 2).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      {/* Text alternative */}
      <ul className="sr-only">
        {shown.length ? shown.map((s, i) => <li key={i}>{label(s)}</li>) : <li>No time on this day</li>}
      </ul>
    </div>
  );
}
