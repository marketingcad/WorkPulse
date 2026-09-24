'use client';
import { useState } from 'react';
import { cx } from '@tallywork/ui';

/**
 * Small, accessible SVG/CSS charts. Every chart has a text alternative; charts
 * answer one question each (see docs/plan/06-design-ux.md "Charts").
 */

const PALETTE = ['#4B4FC4', '#1F5FD1', '#0E7490', '#16794A', '#9A5B00', '#7C3AED', '#DB2777', '#475569'];

/** Horizontal ranked bars (top N). */
export function StackedBars({ rows, format, max: maxProp }: { rows: Array<{ label: string; value: number; color?: string; sub?: string }>; format: (v: number) => string; max?: number }) {
  const max = maxProp ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={r.label + i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: r.color ?? PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{r.label}</span>
              {r.sub && <span className="truncate text-xs text-text-faint">{r.sub}</span>}
            </span>
            <span className="tabular shrink-0 text-xs font-medium text-text-muted">{format(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? PALETTE[i % PALETTE.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical stacked column chart over an x category (e.g. dates). */
export function ColumnChart({ data, x, series, format, height = 180, xFormat }: { data: Array<Record<string, string | number>>; x: string; series: Array<{ key: string; label: string; color?: string }>; format: (v: number) => string; height?: number; xFormat?: (v: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, se) => s + (Number(d[se.key]) || 0), 0));
  const max = Math.max(1, ...totals);
  const colorOf = (i: number, s?: string) => s ?? (series[i]?.key === 'Other' ? 'var(--color-border-strong)' : PALETTE[i % PALETTE.length]);
  return (
    <figure>
      <div className="relative flex items-end gap-[3px]" style={{ height }} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(', ')} by ${x}`}>
        {data.map((d, i) => (
          <div key={String(d[x])} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
            <div className="flex flex-col-reverse overflow-hidden rounded-t-[2px]" style={{ height: `${(totals[i]! / max) * 100}%` }}>
              {series.map((s, si) => {
                const v = Number(d[s.key]) || 0;
                return v ? <div key={s.key} style={{ height: `${(v / (totals[i] || 1)) * 100}%`, background: colorOf(si, s.color) }} /> : null;
              })}
            </div>
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-sm bg-[#0f2240] px-2 py-1.5 text-2xs text-white shadow-overlay">
                <div className="mb-0.5 font-semibold">{xFormat ? xFormat(String(d[x])) : String(d[x])}</div>
                {series.map((s, si) =>
                  Number(d[s.key]) ? (
                    <div key={s.key} className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: colorOf(si, s.color) }} />
                      {s.label}: {format(Number(d[s.key]))}
                    </div>
                  ) : null,
                )}
                <div className="mt-0.5 border-t border-white/20 pt-0.5">Total {format(totals[i]!)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]" aria-hidden>
        {data.map((d, i) => (
          <span key={String(d[x])} className={cx('min-w-0 flex-1 truncate text-center text-[10px] text-text-faint', data.length > 16 && i % Math.ceil(data.length / 12) !== 0 && 'invisible')}>
            {xFormat ? xFormat(String(d[x])) : String(d[x])}
          </span>
        ))}
      </div>
      {series.length > 1 && (
        <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {series.map((s, si) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: colorOf(si, s.color) }} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      {/* Text alternative */}
      <table className="sr-only">
        <caption>Chart data</caption>
        <thead>
          <tr>
            <th>{x}</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={String(d[x])}>
              <td>{String(d[x])}</td>
              {series.map((s) => (
                <td key={s.key}>{format(Number(d[s.key]) || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 24h day ribbon: work blocks coloured by project, idle hatched, manual dotted. */
export function DayRibbon({ segments, dayStart, dayEnd, onSelect }: { segments: Array<{ start: string; end: string; kind: string; color: string | null }>; dayStart: number; dayEnd: number; onSelect?: (hour: number) => void }) {
  const span = dayEnd - dayStart;
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-sm bg-surface-sunken" role="img" aria-label="Timeline of the day">
        {segments.map((s, i) => {
          const a = Math.max(0, (Date.parse(s.start) - dayStart) / span);
          const b = Math.min(1, (Date.parse(s.end) - dayStart) / span);
          if (b <= a) return null;
          const style: React.CSSProperties =
            s.kind === 'IDLE'
              ? { left: `${a * 100}%`, width: `${(b - a) * 100}%`, backgroundImage: 'repeating-linear-gradient(135deg, var(--color-warning) 0 2px, transparent 2px 6px)', opacity: 0.7 }
              : s.kind === 'MANUAL'
                ? { left: `${a * 100}%`, width: `${(b - a) * 100}%`, background: s.color ?? 'var(--color-info)', opacity: 0.45, outline: '1px dashed var(--color-info)' }
                : { left: `${a * 100}%`, width: `${(b - a) * 100}%`, background: s.color ?? 'var(--color-secondary)' };
          return <span key={i} className="absolute inset-y-0" style={style} title={`${s.kind.toLowerCase()} ${new Date(s.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(s.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`} />;
        })}
        {onSelect && (
          <div className="absolute inset-0 grid grid-cols-24">
            {Array.from({ length: 24 }, (_, h) => (
              <button key={h} className="hover:bg-black/5" aria-label={`Jump to ${h}:00`} onClick={() => onSelect(h)} />
            ))}
          </div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-6 text-[10px] text-text-faint sm:grid-cols-12" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={cx(i % 2 === 1 && 'hidden sm:block')}>
            {String(i * 2).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}
