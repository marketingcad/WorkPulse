import { describe, expect, it } from 'vitest';
import { parseRange, rangeParams } from '../lib/url-range';
import type { DateRange } from '../components/tracking/time';

const week: DateRange = { preset: 'this_week', from: '2026-11-02', to: '2026-11-08' };
const last: DateRange = { preset: 'last_week', from: '2026-10-26', to: '2026-11-01' };
const preset = (name: string): DateRange => (name === 'last_week' ? last : week);
const parse = (p: Partial<{ range: string; from: string; to: string }>) => parseRange({ range: p.range ?? null, from: p.from ?? null, to: p.to ?? null }, week, preset);

describe('list date ranges in the address', () => {
  it('reads a named preset, so a shared "last week" link stays last week', () => {
    expect(parse({ range: 'last_week' })).toEqual(last);
  });

  it('reads custom dates, putting reversed ones in order', () => {
    expect(parse({ from: '2026-10-01', to: '2026-10-15' })).toEqual({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' });
    expect(parse({ from: '2026-10-15', to: '2026-10-01' })).toEqual({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' });
  });

  it('falls back to the default for anything invalid or out of date, never an error', () => {
    for (const p of [{}, { range: 'next_century' }, { from: '2026-13-40', to: '2026-10-01' }, { from: 'yesterday', to: 'today' }, { from: '2020-01-01', to: '2026-01-01' }, { from: '2026-10-01' }]) expect(parse(p)).toEqual(week);
  });

  it('writes presets by name, custom ranges by date, and leaves the default out', () => {
    expect(rangeParams(week, week)).toEqual({ range: null, from: null, to: null });
    expect(rangeParams(last, week)).toEqual({ range: 'last_week', from: null, to: null });
    expect(rangeParams({ preset: 'custom', from: '2026-10-01', to: '2026-10-15' }, week)).toEqual({ range: null, from: '2026-10-01', to: '2026-10-15' });
  });
});
