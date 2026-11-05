'use client';
import { Suspense, lazy, type ComponentProps } from 'react';
import type * as C from '@tallywork/ui/charts';

/**
 * The shared charts (`@tallywork/ui/charts`), loaded when a chart is first drawn rather than with
 * every page (the 250 KB first-load budget). Each keeps its size while it loads, so nothing shifts.
 */
const charts = () => import('@tallywork/ui/charts');
const LazyColumn = lazy(() => charts().then((m) => ({ default: m.ColumnChart })));
const LazyBars = lazy(() => charts().then((m) => ({ default: m.BarList })));
const LazyDonut = lazy(() => charts().then((m) => ({ default: m.Donut })));
const LazyRing = lazy(() => charts().then((m) => ({ default: m.RingMeter })));
const LazyMeter = lazy(() => charts().then((m) => ({ default: m.Meter })));
const LazyDelta = lazy(() => charts().then((m) => ({ default: m.TrendDelta })));

type P<T extends 'ColumnChart' | 'BarList' | 'Donut' | 'RingMeter' | 'Meter' | 'TrendDelta'> = ComponentProps<(typeof C)[T]>;
const Hold = ({ height, className }: { height: number; className?: string }) => <div aria-hidden className={`animate-pulse rounded-md bg-surface-sunken/60 motion-reduce:animate-none ${className ?? ''}`} style={{ height }} />;

export function ColumnChart(p: P<'ColumnChart'>) {
  // The chart, its x labels and legend.
  return (
    <Suspense fallback={<Hold height={(p.height ?? 200) + 8 + (p.series.length > 1 || p.compare ? 56 : 24)} />}>
      <LazyColumn {...p} />
    </Suspense>
  );
}
export function BarList(p: P<'BarList'>) {
  return (
    <Suspense fallback={<Hold height={p.rows.length * 36} />}>
      <LazyBars {...p} />
    </Suspense>
  );
}
export function Donut(p: P<'Donut'>) {
  return (
    <Suspense fallback={<Hold height={p.size ?? 152} />}>
      <LazyDonut {...p} />
    </Suspense>
  );
}
export function RingMeter(p: P<'RingMeter'>) {
  return (
    <Suspense fallback={<Hold height={p.size ?? 64} className="aspect-square rounded-full" />}>
      <LazyRing {...p} />
    </Suspense>
  );
}
export function Meter(p: P<'Meter'>) {
  return (
    <Suspense fallback={<Hold height={8} className="rounded-full" />}>
      <LazyMeter {...p} />
    </Suspense>
  );
}
export function TrendDelta(p: P<'TrendDelta'>) {
  return (
    <Suspense fallback={<span className="inline-block h-5 w-24" />}>
      <LazyDelta {...p} />
    </Suspense>
  );
}
