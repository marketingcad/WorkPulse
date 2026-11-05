'use client';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cx } from './primitives';
import { EmptyState, ErrorState } from './display';
import { labelEvery, niceTicks, rowTotal, topWithOther } from './chart-math';

/**
 * WorkPulse charts: small SVG/CSS primitives with one visual language (theme tokens only, fine grid,
 * quiet axes), keyboard and screen-reader access, and a text alternative for every chart. They draw
 * the values they are given; formatting comes from the caller's fmt* helpers. Imported from
 * `@tallywork/ui/charts`, so pages without charts do not load them.
 */

/** Series colors in order (theme tokens). Pass a color for data that has its own (a project's). */
export const CHART_COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-6)'];
export const chartColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length]!;
const OTHER = 'var(--color-chart-other)';

// ─── States ──────────────────────────────────────────────────────────────────

/** Loading, error and empty in the chart's own space, so the page does not jump when data arrives. */
export function ChartFrame({
  height,
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  height: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (error)
    return (
      <div style={{ minHeight: height }} className="flex items-center justify-center">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  if (loading) return <ChartSkeleton height={height} />;
  if (empty)
    return (
      <div style={{ minHeight: height }} className="flex items-center justify-center">
        <EmptyState title={emptyTitle ?? 'No data for this period'} description={emptyDescription} action={emptyAction} />
      </div>
    );
  return <>{children}</>;
}

/** Bars of a fixed rhythm while loading (no fake values). */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div style={{ height }} className="flex items-end gap-2 px-11 pb-6" aria-busy="true" aria-label="Loading chart">
      {[40, 65, 50, 80, 55, 70, 45].map((h, i) => (
        <span key={i} className="flex-1 animate-pulse rounded-t-sm bg-surface-sunken motion-reduce:animate-none" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-[3px]', dashed && 'border border-dashed border-text-faint bg-transparent')} style={dashed ? undefined : { background: color }} />;
}

/** A legend; with `onToggle`, each item shows or hides its series (a toggle button, so keyboard-friendly). */
export function ChartLegend({ items, onToggle }: { items: Array<{ key: string; label: string; color: string; hidden?: boolean; dashed?: boolean }>; onToggle?: (key: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted">
      {items.map((it) =>
        onToggle && !it.dashed ? (
          <button
            key={it.key}
            type="button"
            aria-pressed={!it.hidden}
            onClick={() => onToggle(it.key)}
            className={cx('inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 transition-opacity hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', it.hidden && 'opacity-45 line-through')}
          >
            <Swatch color={it.color} />
            {it.label}
          </button>
        ) : (
          <span key={it.key} className="inline-flex items-center gap-1.5 px-1 py-0.5">
            <Swatch color={it.color} dashed={it.dashed} />
            {it.label}
          </span>
        ),
      )}
    </div>
  );
}

/** The tooltip box (theme colors: readable in light and dark). */
function TooltipBox({ title, rows, footer }: { title: string; rows: Array<{ label: string; value: string; color?: string; dashed?: boolean }>; footer?: string }) {
  return (
    <div className="w-max max-w-60 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-text shadow-overlay">
      <div className="mb-1 font-semibold">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-muted">
            {r.color && <Swatch color={r.color} dashed={r.dashed} />}
            {r.label}
          </span>
          <span className="tabular font-medium">{r.value}</span>
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-border pt-1 text-text-muted">{footer}</div>}
    </div>
  );
}

/** "↑ 12% vs last week": arrow, sign and words (never color alone); neutral, as more is not "better". */
export function TrendDelta({ change, label, toDate }: { change: number | null; label: string; toDate?: boolean }) {
  if (change === null) return <span className="text-2xs text-text-faint">{toDate ? `${label} (so far): no time yet` : `${label}: no time to compare`}</span>;
  const pct = Math.round(change * 100);
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const words = pct === 0 ? 'same as' : pct > 0 ? `${pct}% more than` : `${-pct}% less than`;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-text-muted" title={`${words} ${label}${toDate ? ' at this point' : ''}`}>
      <Icon className="size-3" aria-hidden />
      <span aria-hidden>
        {pct > 0 ? '+' : ''}
        {pct}%
      </span>
      <span className="sr-only">{words}</span> {label}
      {toDate && <span className="text-text-faint"> so far</span>}
    </span>
  );
}

// ─── Columns ─────────────────────────────────────────────────────────────────

type Row = Record<string, string | number | null | undefined>;

/**
 * Vertical columns over a category (dates), stacked by series, on a zero-based axis with round ticks.
 * A row whose values are all missing is drawn as "no data", never as zero. `compare` draws the
 * previous period's total as a dashed outline behind each column. Arrow keys move between columns.
 */
export function ColumnChart({
  data,
  x,
  series,
  format,
  axisFormat,
  axisUnit,
  xFormat,
  height = 200,
  title,
  compare,
}: {
  data: Row[];
  x: string;
  series: Array<{ key: string; label: string; color?: string }>;
  format: (v: number) => string;
  /** shorter labels for the axis (e.g. "8h"); defaults to `format` */
  axisFormat?: (v: number) => string;
  /** ticks in whole units of this size (3600: whole hours) */
  axisUnit?: number;
  xFormat?: (v: string) => string;
  height?: number;
  /** what the chart shows, for screen readers */
  title: string;
  compare?: { label: string; values: Array<number | null> };
}) {
  const id = useId();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const shown = series.filter((s) => !hidden.has(s.key));
  const colorOf = (key: string) => {
    const i = series.findIndex((s) => s.key === key);
    return series[i]?.color ?? chartColor(i);
  };
  const totals = useMemo(() => data.map((d) => rowTotal(d, shown.map((s) => s.key))), [data, shown]);
  const max = Math.max(0, ...totals.map((t) => t ?? 0), ...(compare?.values ?? []).map((v) => v ?? 0));
  const ticks = niceTicks(max, 4, axisUnit ?? 1);
  const top = ticks[ticks.length - 1] || 1;
  const xl = (i: number) => (xFormat ? xFormat(String(data[i]![x])) : String(data[i]![x]));
  const every = labelEvery(data.length, 12);
  const everyPhone = labelEvery(data.length, 6);
  // Whole-hour ticks read as "8h" on the axis; the full format stays in the tooltip and table.
  const axis = axisFormat ?? (axisUnit === 3600 ? (v: number) => `${Math.round(v / 3600)}h` : format);

  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const step = keys[e.key]!;
    setActive((a) => (step === -Infinity ? 0 : step === Infinity ? data.length - 1 : Math.min(data.length - 1, Math.max(0, (a ?? -1) + step))));
  };
  const describe = (i: number) => {
    const t = totals[i] ?? null;
    const parts = shown.map((s) => `${s.label} ${typeof data[i]![s.key] === 'number' ? format(data[i]![s.key] as number) : 'no data'}`);
    const prev = compare?.values[i];
    return `${xl(i)}: ${t === null ? 'no data' : `${format(t)} total`}${shown.length > 1 ? ` (${parts.join(', ')})` : ''}${prev !== undefined && prev !== null ? `, ${compare!.label} ${format(prev)}` : ''}`;
  };

  return (
    <figure className="flex flex-col gap-3">
      {/* pt-2: room for the top tick's label, which is centred on the top gridline */}
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] pt-2">
        {/* Axis labels */}
        <div data-chart-axis className="relative text-right text-[10px] tabular text-text-faint" style={{ height }} aria-hidden>
          {ticks.map((tk) => (
            // `bottom` places the label's bottom edge on the gridline; half its height down centres it there.
            <span key={tk} className="absolute right-2 translate-y-1/2 whitespace-nowrap leading-none" style={{ bottom: `${(tk / top) * 100}%` }}>
              {axis(tk)}
            </span>
          ))}
        </div>
        <div>
          <div
            className="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            style={{ height }}
            role="group"
            aria-label={`${title}. Use the left and right arrow keys to read each column.`}
            aria-describedby={`${id}-live`}
            tabIndex={0}
            onKeyDown={onKey}
            onFocus={() => setActive((a) => a ?? data.length - 1)}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
          >
            {/* Grid */}
            {ticks.map((tk) => (
              <span key={tk} aria-hidden className={cx('absolute inset-x-0 border-t', tk === 0 ? 'border-border-strong' : 'border-chart-grid')} style={{ bottom: `${(tk / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1">
              {data.map((d, i) => {
                const t = totals[i] ?? null;
                const prev = compare?.values[i];
                return (
                  <div key={String(d[x])} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setActive(i)}>
                    {prev !== undefined && prev !== null && prev > 0 && (
                      <span aria-hidden className="absolute bottom-0 w-full rounded-t-sm border border-b-0 border-dashed border-text-faint" style={{ height: `${(prev / top) * 100}%` }} />
                    )}
                    {t === null ? (
                      <span aria-hidden className="mb-px h-1 w-1/2 rounded-full bg-surface-sunken" title="No data" />
                    ) : (
                      <div
                        className={cx('relative flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-t-[4px] transition-[height,opacity] duration-300 motion-reduce:transition-none', active !== null && active !== i && 'opacity-55')}
                        style={{ height: `${(t / top) * 100}%`, minHeight: t > 0 ? 2 : 0 }}
                      >
                        {shown.map((s) => {
                          const v = d[s.key];
                          return typeof v === 'number' && v > 0 ? <div key={s.key} style={{ height: `${(v / (t || 1)) * 100}%`, background: colorOf(s.key) }} /> : null;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {active !== null && data[active] && (
              <div
                className="pointer-events-none absolute bottom-full z-20 mb-2"
                style={active < data.length * 0.2 ? { left: `${(active / data.length) * 100}%` } : active > data.length * 0.8 ? { right: `${((data.length - 1 - active) / data.length) * 100}%` } : { left: `${((active + 0.5) / data.length) * 100}%`, transform: 'translateX(-50%)' }}
              >
                <TooltipBox
                  title={xl(active)}
                  rows={[
                    ...shown.map((s) => ({ label: s.label, value: typeof data[active]![s.key] === 'number' ? format(data[active]![s.key] as number) : 'No data', color: colorOf(s.key) })),
                    ...(compare && compare.values[active] !== null && compare.values[active] !== undefined ? [{ label: compare.label, value: format(compare.values[active]!), color: 'transparent', dashed: true }] : []),
                  ]}
                  footer={shown.length > 1 && totals[active] !== null ? `Total ${format(totals[active]!)}` : undefined}
                />
              </div>
            )}
          </div>
          {/* X labels */}
          <div className="mt-1.5 flex gap-[3px] sm:gap-1" aria-hidden>
            {data.map((d, i) => (
              <span key={String(d[x])} className={cx('min-w-0 flex-1 truncate text-center text-[10px] text-text-faint', i % everyPhone !== 0 && 'hidden sm:block', i % every !== 0 && 'sm:invisible', active === i && 'font-semibold text-text')}>
                {xl(i)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p id={`${id}-live`} className="sr-only" aria-live="polite">
        {active !== null && data[active] ? describe(active) : ''}
      </p>
      {(series.length > 1 || compare) && (
        <ChartLegend
          items={[
            ...series.map((s, i) => ({ key: s.key, label: s.label, color: s.color ?? chartColor(i), hidden: hidden.has(s.key) })),
            ...(compare ? [{ key: '__compare', label: compare.label, color: 'transparent', dashed: true }] : []),
          ]}
          onToggle={
            series.length > 1
              ? (k) =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (next.has(k)) next.delete(k);
                    else if (series.length - next.size > 1) next.add(k); // keep at least one series
                    return next;
                  })
              : undefined
          }
        />
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{x}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
            {compare && <th scope="col">{compare.label}</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={String(d[x])}>
              <th scope="row">{xl(i)}</th>
              {series.map((s) => (
                <td key={s.key}>{typeof d[s.key] === 'number' ? format(d[s.key] as number) : 'No data'}</td>
              ))}
              {compare && <td>{compare.values[i] === null || compare.values[i] === undefined ? 'No data' : format(compare.values[i]!)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ─── Ranked bars ─────────────────────────────────────────────────────────────

/** Horizontal ranked bars (the top items of a breakdown), each labelled with its value. */
export function BarList({ rows, format, max: maxProp }: { rows: Array<{ label: string; value: number; color?: string; sub?: string }>; format: (v: number) => string; max?: number }) {
  const max = maxProp ?? Math.max(1, ...rows.map((r) => r.value));
  const [active, setActive] = useState<number | null>(null);
  return (
    <ul className="flex flex-col gap-3" onMouseLeave={() => setActive(null)}>
      {rows.map((r, i) => (
        <li key={r.label + i} onMouseEnter={() => setActive(i)} className={cx('transition-opacity duration-150 motion-reduce:transition-none', active !== null && active !== i && 'opacity-60')}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Swatch color={r.color ?? chartColor(i)} />
              <span className="truncate font-medium">{r.label}</span>
              {r.sub && <span className="truncate text-xs text-text-faint">{r.sub}</span>}
            </span>
            <span className="tabular shrink-0 text-xs font-semibold text-text-muted">{format(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
            <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${Math.min(100, (r.value / max) * 100)}%`, background: r.color ?? chartColor(i) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Donut ───────────────────────────────────────────────────────────────────

/**
 * Parts of a whole (at most five slices: the rest grouped as "Other"), with the total in the center.
 * Hovering or focusing a legend item shows that part in the center. Shares are of the total shown.
 */
export function Donut({
  segments,
  format,
  centerLabel,
  title,
  size = 152,
  keep = 4,
}: {
  segments: Array<{ key: string; label: string; value: number; color?: string }>;
  format: (v: number) => string;
  centerLabel: string;
  title: string;
  size?: number;
  keep?: number;
}) {
  const parts = topWithOther(
    segments.map((s, i) => ({ ...s, color: s.color ?? chartColor(i) })),
    keep,
    (value, count) => ({ key: '__other', label: `Other (${count})`, value, color: OTHER }),
  );
  const total = parts.reduce((s, p) => s + p.value, 0);
  // Parts with no value stay in the list (at 0), so a fixed breakdown is complete; the ring skips them.
  const listed = [...parts, ...segments.map((sg, i) => ({ ...sg, color: sg.color ?? chartColor(i) })).filter((sg) => !(sg.value > 0))];
  const [active, setActive] = useState<string | null>(null);
  const focus = parts.find((p) => p.key === active);
  const share = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  let offset = 0;
  return (
    // Side by side only when its own box is wide enough (a narrow column on a wide screen stacks).
    <div className="@container min-w-0">
    <figure className="flex flex-col items-center gap-4 @sm:flex-row @sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" className="size-full -rotate-90" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
          <circle cx="18" cy="18" r="14" fill="none" className="stroke-surface-sunken" strokeWidth="4.5" />
          {parts.map((p) => {
            const len = total ? (p.value / total) * 100 : 0;
            const gap = parts.length > 1 ? Math.min(0.8, len / 3) : 0;
            const el = (
              <circle
                key={p.key}
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke={p.color}
                strokeWidth={active === p.key ? 5.5 : 4.5}
                pathLength={100}
                strokeDasharray={`${Math.max(0, len - gap)} ${100 - Math.max(0, len - gap)}`}
                strokeDashoffset={-offset}
                className={cx('transition-[stroke-width,opacity] duration-150 motion-reduce:transition-none', active && active !== p.key && 'opacity-40')}
                onMouseEnter={() => setActive(p.key)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
          <span className="tabular text-lg font-semibold leading-tight">{format(focus ? focus.value : total)}</span>
          <span className="max-w-24 truncate text-2xs text-text-muted">{focus ? `${focus.label} · ${share(focus.value)}%` : centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
        {listed.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onMouseEnter={() => setActive(p.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              className="flex w-full items-center justify-between gap-3 rounded-sm px-1.5 py-1 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Swatch color={p.color} />
                <span className="truncate">{p.label}</span>
              </span>
              <span className="tabular shrink-0 text-xs text-text-muted">
                {format(p.value)} <span className="text-text-faint">· {share(p.value)}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
    </div>
  );
}

// ─── Meters ──────────────────────────────────────────────────────────────────

/** A percentage as a ring (e.g. average activity), with the value in the middle. */
export function RingMeter({ pct, label, size = 64 }: { pct: number | null; label: string; size?: number }) {
  const id = useId();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label={pct === null ? `${label}: no data` : `${label}: ${pct}%`}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-surface-sunken" strokeWidth="3.5" />
        {pct !== null && <circle cx="18" cy="18" r="15.5" fill="none" stroke={`url(#${id})`} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${Math.min(100, Math.max(0, pct))} 100`} pathLength="100" className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none" />}
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--color-chart-1)' }} />
            <stop offset="1" style={{ stopColor: 'var(--color-chart-2)' }} />
          </linearGradient>
        </defs>
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-sm font-bold" aria-hidden>
        {pct === null ? '—' : `${pct}%`}
      </span>
    </span>
  );
}

/** Use of a limit (a budget, a daily cap): warning from `warnAt`, danger at or over the limit. */
export function Meter({ value, max, warnAt = 0.9, label }: { value: number; max: number; warnAt?: number; label: string }) {
  const r = max > 0 ? value / max : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div className={cx('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', r >= 1 ? 'bg-danger' : r >= warnAt ? 'bg-warning' : 'bg-interactive')} style={{ width: `${Math.min(100, r * 100)}%` }} />
    </div>
  );
}

/** The arithmetic charts use, for pages that compare periods themselves. */
export { niceTicks, periodChange, rowTotal, topWithOther } from './chart-math';
