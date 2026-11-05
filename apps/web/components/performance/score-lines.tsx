'use client';
import { fmtDate } from '@tallywork/ui';

/**
 * Scores (0–100) of a few subjects over the same periods, one line each. Gaps stay gaps: a period
 * with no score is not drawn as zero. Screen readers get the same numbers as a table.
 */
export function ScoreLines({ periods, series, label, height = 200 }: { periods: string[]; series: Array<{ key: string; name: string; color: string; values: Array<number | null> }>; label: string; height?: number }) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...all, 100) - 5) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...all, 0) + 5) / 10) * 10);
  const span = Math.max(10, hi - lo);
  const ticks = Array.from({ length: span / 10 + 1 }, (_, i) => hi - i * 10).filter((v) => v >= lo);
  const x = (i: number) => (periods.length < 2 ? 50 : (i / (periods.length - 1)) * 100);
  const y = (v: number) => ((hi - v) / span) * 100;
  // Runs of consecutive scored periods, so a gap breaks the line.
  const runs = (values: Array<number | null>) => {
    const out: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push([x(i), y(v)]);
    });
    if (cur.length) out.push(cur);
    return out;
  };
  return (
    <figure className="space-y-2">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
        <div className="flex flex-col justify-between text-right text-2xs text-text-muted tabular" style={{ height }} aria-hidden>
          {ticks.map((v) => (
            <span key={v} className="leading-none">
              {v}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }} aria-hidden>
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((v) => (
              <span key={v} className="border-t border-border" />
            ))}
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {series.map((s) =>
              runs(s.values).map((run, i) =>
                run.length === 1 ? (
                  <circle key={`${s.key}-${i}`} cx={run[0]![0]} cy={run[0]![1]} r={1.4} fill={s.color} vectorEffect="non-scaling-stroke" />
                ) : (
                  <polyline key={`${s.key}-${i}`} points={run.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ),
              ),
            )}
          </svg>
        </div>
        <span />
        <div className="mt-1 flex justify-between text-2xs text-text-muted" aria-hidden>
          {periods.map((p) => (
            <span key={p}>{fmtDate(p, { month: 'short', day: 'numeric' })}</span>
          ))}
        </div>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {periods.map((p) => (
              <th key={p} scope="col">
                {fmtDate(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.name}</th>
              {s.values.map((v, i) => (
                <td key={i}>{v === null ? '—' : Math.round(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
