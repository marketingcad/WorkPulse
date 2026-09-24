'use client';
import { Input, Select } from '@tallywork/ui';
import { addDays, todayIn, weekStartOf } from '@/lib/org';

export type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30' | 'custom';

export const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

/** Resolve a preset to an inclusive [from, to] pair of local dates in the org timezone. */
export function rangeFor(preset: Exclude<Preset, 'custom'>, tz: string, weekStart: number): { from: string; to: string } {
  const today = todayIn(tz);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'this_week': {
      const s = weekStartOf(today, weekStart);
      return { from: s, to: addDays(s, 6) };
    }
    case 'last_week': {
      const s = addDays(weekStartOf(today, weekStart), -7);
      return { from: s, to: addDays(s, 6) };
    }
    case 'this_month': {
      const next = addDays(monthStart, 32);
      return { from: monthStart, to: addDays(`${next.slice(0, 8)}01`, -1) };
    }
    case 'last_month': {
      const end = addDays(monthStart, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today };
  }
}

export function isPreset(v: unknown): v is Preset {
  return PRESETS.some((p) => p.value === v);
}

export function DateRangeFilter({ preset, from, to, onChange, tz, weekStart }: { preset: Preset; from: string; to: string; onChange: (v: { preset: Preset; from: string; to: string }) => void; tz: string; weekStart: number }) {
  const tooLong = (Date.parse(to) - Date.parse(from)) / 86_400_000 > 400;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Date range"
        className="w-40"
        value={preset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          onChange(p === 'custom' ? { preset: p, from, to } : { preset: p, ...rangeFor(p, tz, weekStart) });
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <>
          <Input type="date" aria-label="From" className="w-36" value={from} max={to} onChange={(e) => e.target.value && onChange({ preset, from: e.target.value, to })} />
          <span className="text-text-faint">–</span>
          <Input type="date" aria-label="To" className="w-36" value={to} min={from} onChange={(e) => e.target.value && onChange({ preset, from, to: e.target.value })} aria-invalid={tooLong} />
          {tooLong && <span className="text-xs text-danger">Ranges are limited to 400 days</span>}
        </>
      ) : (
        <span className="tabular text-xs text-text-muted">
          {from} – {to}
        </span>
      )}
    </div>
  );
}

