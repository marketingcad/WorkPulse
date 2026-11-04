'use client';
import { useState, type ReactNode } from 'react';
import {
  Award,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Flag,
  Gem,
  Heart,
  Repeat,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { addDaysToDate, periodBounds, type PerformancePeriod } from '@tallywork/domain';
import { Button, SegmentedControl, cx } from '@tallywork/ui';
import { t } from '@/lib/i18n';

/** Shared pieces of the Performance Center pages (designs: the "Performance Center designs" canvas). */

export type Tier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
export type MetricKey = 'goals' | 'delivery' | 'consistency' | 'quality' | 'attendance';
export const METRICS: MetricKey[] = ['goals', 'delivery', 'consistency', 'quality', 'attendance'];
/** Each metric keeps one chart colour everywhere (ring, bars, legends). */
export const METRIC_COLOR: Record<MetricKey, string> = {
  goals: 'var(--color-chart-1)',
  delivery: 'var(--color-chart-2)',
  consistency: 'var(--color-chart-3)',
  quality: 'var(--color-chart-4)',
  attendance: 'var(--color-chart-5)',
};
export const metricLabel = (m: MetricKey) => t(`perf.metric.${m}`);
export const metricSource = (m: MetricKey) => t(`perf.metricSource.${m}`);

const ICONS: Record<string, LucideIcon> = {
  award: Award,
  'check-circle': CheckCircle2,
  'calendar-check': CalendarCheck,
  flag: Flag,
  repeat: Repeat,
  clock: Clock,
  crown: Crown,
  heart: Heart,
  star: Star,
  gem: Gem,
  smile: Smile,
  trophy: Trophy,
  target: Target,
  zap: Zap,
  rocket: Rocket,
  'shield-check': ShieldCheck,
  users: Users,
  sparkles: Sparkles,
};
export const achievementIcon = (name: string): LucideIcon => ICONS[name] ?? Award;

const TIER_CLASS: Record<Tier, { rim: string; soft: string; text: string }> = {
  BRONZE: { rim: 'bg-tier-bronze', soft: 'bg-tier-bronze-soft', text: 'text-tier-bronze' },
  SILVER: { rim: 'bg-tier-silver', soft: 'bg-tier-silver-soft', text: 'text-tier-silver' },
  GOLD: { rim: 'bg-tier-gold', soft: 'bg-tier-gold-soft', text: 'text-tier-gold' },
  PLATINUM: { rim: 'bg-tier-platinum', soft: 'bg-tier-platinum-soft', text: 'text-tier-platinum' },
};
export const tierText = (tier: Tier) => TIER_CLASS[tier].text;
export const tierSoft = (tier: Tier) => TIER_CLASS[tier].soft;
export const tierLabel = (tier: Tier | null) => (tier ? t(`perf.tier.${tier.toLowerCase()}`) : '');

const HEX = 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)';

/** A hexagonal medallion (the WorkPulse logo shape) with a level-coloured rim. */
export function HexBadge({ icon, tier, size = 48, label, dim, children }: { icon?: string; tier: Tier | null; size?: number; label?: string; dim?: boolean; children?: ReactNode }) {
  const c = TIER_CLASS[tier ?? 'GOLD'];
  const Icon = icon ? achievementIcon(icon) : null;
  const h = Math.round(size * 1.13);
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx('relative inline-grid shrink-0 place-items-center', c.rim, dim && 'opacity-45')} style={{ width: size, height: h, clipPath: HEX }}>
      <span className="grid place-items-center bg-surface" style={{ width: size - 6, height: h - 7, clipPath: HEX }}>
        <span className={cx('grid place-items-center', c.soft, c.text)} style={{ width: size - 12, height: h - 14, clipPath: HEX }}>
          {children ?? (Icon && <Icon className="size-[45%]" strokeWidth={2.2} />)}
        </span>
      </span>
    </span>
  );
}

export interface RingPart {
  value: number | null;
  weight: number;
}

/**
 * The score ring: one arc per metric, as long as its weight, filled as far as its value. A metric
 * not measured shows an empty arc, never a zero.
 */
export function ScoreRing({ parts, score, size = 168, onDark, caption }: { parts: Record<MetricKey, RingPart> | null; score: number | null; size?: number; onDark?: boolean; caption?: string }) {
  let start = 0;
  const arcs = METRICS.map((m) => {
    const p = parts?.[m] ?? { value: null, weight: 20 };
    const len = Math.max(0, p.weight - 1.6);
    const fill = p.value === null ? 0 : (len * Math.max(0, Math.min(100, p.value))) / 100;
    const a = { m, len, fill, off: -start, missing: p.value === null };
    start += p.weight;
    return a;
  });
  const track = onDark ? 'color-mix(in srgb, var(--color-nav-fg) 14%, transparent)' : 'var(--color-surface-sunken)';
  const label = `${t('perf.score')}: ${score === null ? t('perf.notEnoughData') : Math.round(score)}. ${METRICS.map((m) => `${metricLabel(m)} ${parts?.[m]?.value === null || !parts ? t('perf.notMeasured') : Math.round(parts[m].value!)}`).join(', ')}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={label}>
        {arcs.map((a) => (
          <g key={a.m}>
            <circle cx="50" cy="50" r="42" fill="none" stroke={track} strokeWidth="9" pathLength={100} strokeDasharray={`${a.len} ${100 - a.len}`} strokeDashoffset={a.off} strokeOpacity={a.missing ? 0.5 : 1} />
            {a.fill > 0 && <circle cx="50" cy="50" r="42" fill="none" stroke={METRIC_COLOR[a.m]} strokeWidth="9" pathLength={100} strokeDasharray={`${a.fill} ${100 - a.fill}`} strokeDashoffset={a.off} />}
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
        <span className={cx('tabular font-extrabold leading-none tracking-tight', size >= 150 ? 'text-5xl' : 'text-3xl')}>{score === null ? '—' : Math.round(score)}</span>
        <span className={cx('mt-1 text-xs', onDark ? 'text-nav-muted' : 'text-text-faint')}>{caption ?? (score === null ? t('perf.notEnoughData') : t('perf.of100'))}</span>
      </div>
    </div>
  );
}

/** A small line of recent scores (nulls are gaps). */
export function Sparkline({ values, label, className }: { values: Array<number | null>; label: string; className?: string }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className={cx('text-xs text-text-faint', className)}>—</span>;
  const lo = Math.min(...nums) - 2;
  const hi = Math.max(...nums) + 2;
  const pts = values.map((v, i) => (v === null ? null : `${((i * 80) / (values.length - 1)).toFixed(1)},${(24 - ((v - lo) / (hi - lo)) * 24).toFixed(1)}`)).filter(Boolean);
  const up = nums.at(-1)! >= nums[0]!;
  return (
    <svg viewBox="0 0 80 24" className={cx('h-6 w-20 overflow-visible', className)} role="img" aria-label={label}>
      <polyline points={pts.join(' ')} fill="none" stroke={up ? 'var(--color-success)' : 'var(--color-danger)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The dark highlight band at the top of the main Performance pages. */
export function HeroBand({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section
      aria-label={label}
      className={cx('relative overflow-hidden rounded-lg bg-nav text-nav-fg shadow-card', className)}
      style={{
        backgroundImage:
          'radial-gradient(60% 90% at 100% 100%, color-mix(in srgb, var(--color-interactive) 42%, transparent), transparent 70%), radial-gradient(40% 70% at 0% 0%, color-mix(in srgb, var(--color-secondary) 30%, transparent), transparent 70%)',
      }}
    >
      {children}
    </section>
  );
}

/** A frosted tile inside the hero band. */
export function HeroTile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center gap-3 rounded-md border border-nav-fg/12 bg-nav-fg/6 px-3.5 py-3', className)}>{children}</div>;
}

// ─── Periods ─────────────────────────────────────────────────────────────────

const PERIOD_OPTS: Array<{ value: PerformancePeriod; key: string }> = [
  { value: 'WEEK', key: 'perf.period.week' },
  { value: 'MONTH', key: 'perf.period.month' },
  { value: 'QUARTER', key: 'perf.period.quarter' },
  { value: 'YEAR', key: 'perf.period.year' },
];

/** The chosen period and how many periods back from the current one. */
export function usePerfPeriod(today: string, weekStart: number, initial: PerformancePeriod = 'MONTH') {
  const [period, setPeriod] = useState<PerformancePeriod>(initial);
  const [offset, setOffset] = useState(0);
  let d = today;
  for (let i = 0; i < -offset; i++) d = addDaysToDate(periodBounds(period, d, weekStart).start, -1);
  const bounds = periodBounds(period, d, weekStart);
  return { period, offset, date: bounds.start, start: bounds.start, end: bounds.end, label: periodLabel(period, bounds.start, bounds.end), setPeriod: (p: PerformancePeriod) => (setPeriod(p), setOffset(0)), setOffset };
}

export function periodLabel(period: PerformancePeriod, start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });
  if (period === 'YEAR') return String(s.getUTCFullYear());
  if (period === 'QUARTER') return `Q${Math.floor(s.getUTCMonth() / 3) + 1} ${s.getUTCFullYear()}`;
  if (period === 'MONTH') return f(s, { month: 'long', year: 'numeric' });
  return `${f(s, { month: 'short', day: 'numeric' })} – ${f(e, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function PeriodPicker({ p, periods = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] }: { p: ReturnType<typeof usePerfPeriod>; periods?: PerformancePeriod[] }) {
  return (
    <>
      <Button size="sm" aria-label={t('perf.previousPeriod')} icon={<ChevronLeft className="size-3.5" />} onClick={() => p.setOffset(p.offset - 1)} />
      <span className="min-w-40 text-center text-sm font-medium tabular" aria-live="polite">
        {p.label}
      </span>
      <Button size="sm" aria-label={t('perf.nextPeriod')} icon={<ChevronRight className="size-3.5" />} onClick={() => p.setOffset(p.offset + 1)} disabled={p.offset >= 0} />
      {p.offset !== 0 && (
        <Button size="sm" variant="ghost" onClick={() => p.setOffset(0)}>
          {t('perf.current')}
        </Button>
      )}
      <SegmentedControl label={t('perf.periodLabel')} value={p.period} onChange={p.setPeriod} options={PERIOD_OPTS.filter((o) => periods.includes(o.value)).map((o) => ({ value: o.value, label: t(o.key) }))} />
    </>
  );
}

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);
export const scoreText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n)));
export const ratio = (a: { on_time?: number; completed?: number; due: number } | null | undefined) => {
  if (!a || !a.due) return '—';
  return `${a.on_time ?? a.completed} ${t('perf.of')} ${a.due}`;
};
