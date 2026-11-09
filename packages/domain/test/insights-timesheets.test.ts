import { describe, expect, it } from 'vitest';
import { findDuplicates, findOverlaps, timesheetFindings, type EntrySpan, type SheetSummary } from '../src/insights';

const at = (day: string, hm: string) => `${day}T${hm}:00.000Z`;
let n = 0;
const span = (member: string, start: string, end: string | null, extra: Partial<EntrySpan> = {}): EntrySpan => ({
  id: `e${++n}`,
  membershipId: member,
  memberName: member.toUpperCase(),
  projectId: 'p1',
  start,
  end,
  source: 'TRACKED',
  ...extra,
});
const period = { from: '2026-11-02', to: '2026-11-08' };
const sheet = (s: Partial<SheetSummary>): SheetSummary => ({
  timesheetId: 't1',
  membershipId: 'm1',
  memberName: 'Ana',
  periodStart: '2026-11-02',
  status: 'SUBMITTED',
  totalSeconds: 0,
  manualSeconds: 0,
  previousTotalSeconds: null,
  flags: [],
  ...s,
});

describe('findOverlaps', () => {
  it('finds two entries of one member that overlap, with the overlap length', () => {
    const r = findOverlaps([span('m1', at('2026-11-02', '09:00'), at('2026-11-02', '11:00')), span('m1', at('2026-11-02', '10:30'), at('2026-11-02', '12:00'))]);
    expect(r).toHaveLength(1);
    expect(r[0]!.overlapSeconds).toBe(1800);
  });
  it('ignores the same times for different members', () => {
    expect(findOverlaps([span('m1', at('2026-11-02', '09:00'), at('2026-11-02', '11:00')), span('m2', at('2026-11-02', '10:00'), at('2026-11-02', '12:00'))])).toHaveLength(0);
  });
  it('finds an overlap across midnight once', () => {
    const r = findOverlaps([span('m1', at('2026-11-02', '23:00'), at('2026-11-03', '01:00')), span('m1', at('2026-11-03', '00:30'), at('2026-11-03', '02:00'))]);
    expect(r).toHaveLength(1);
    expect(r[0]!.overlapSeconds).toBe(1800);
  });
  it('ignores a running entry and touching ends', () => {
    expect(findOverlaps([span('m1', at('2026-11-02', '09:00'), at('2026-11-02', '12:00')), span('m1', at('2026-11-02', '10:00'), null)])).toHaveLength(0);
    expect(findOverlaps([span('m1', at('2026-11-02', '09:00'), at('2026-11-02', '10:00')), span('m1', at('2026-11-02', '10:00'), at('2026-11-02', '11:00'))])).toHaveLength(0);
  });
  it('reports each overlapping pair when three entries overlap', () => {
    const r = findOverlaps([
      span('m1', at('2026-11-02', '09:00'), at('2026-11-02', '12:00')),
      span('m1', at('2026-11-02', '10:00'), at('2026-11-02', '11:00')),
      span('m1', at('2026-11-02', '10:30'), at('2026-11-02', '13:00')),
    ]);
    expect(r).toHaveLength(3);
  });
});

describe('findDuplicates', () => {
  it('groups identical entries of one member and project', () => {
    const s = at('2026-11-02', '09:00');
    const e = at('2026-11-02', '10:00');
    const groups = findDuplicates([span('m1', s, e), span('m1', s, e), span('m1', s, e), span('m1', s, e, { projectId: 'p2' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

describe('timesheetFindings', () => {
  const neutral = (text: string) => expect(text).not.toMatch(/suspicious|fraud|misconduct|cheat/i);

  it('notes a heavy manual share, with the measure', () => {
    const f = timesheetFindings({ period, entries: [], sheets: [sheet({ totalSeconds: 10 * 3600, manualSeconds: 3 * 3600 })], missing: [] });
    const m = f.find((x) => x.category === 'manual_heavy')!;
    expect(m.metrics).toContainEqual({ label: 'Manual share', value: 30, unit: 'percent' });
    expect(m.basis).toBe('observation');
    expect(m.links).toContain('timesheets.approvals');
  });
  it('notes a large change against the previous period only with a real baseline', () => {
    const big = timesheetFindings({ period, entries: [], sheets: [sheet({ totalSeconds: 30 * 3600, previousTotalSeconds: 10 * 3600 })], missing: [] });
    expect(big.find((x) => x.category === 'hours_change')!.metrics[0]).toMatchObject({ value: 200, unit: 'percent' });
    const small = timesheetFindings({ period, entries: [], sheets: [sheet({ totalSeconds: 3 * 3600, previousTotalSeconds: 2 * 3600 })], missing: [] });
    expect(small.find((x) => x.category === 'hours_change')).toBeUndefined();
  });
  it('turns overlaps, duplicates, long days and missing timesheets into findings', () => {
    const s = at('2026-11-02', '09:00');
    const e = at('2026-11-02', '10:00');
    const f = timesheetFindings({
      period,
      entries: [
        span('m1', at('2026-11-03', '09:00'), at('2026-11-03', '11:00')),
        span('m1', at('2026-11-03', '10:00'), at('2026-11-03', '12:00')),
        span('m2', s, e),
        span('m2', s, e),
        span('m3', at('2026-11-04', '06:00'), at('2026-11-04', '21:00')),
      ],
      sheets: [],
      missing: [{ membershipId: 'm9', memberName: 'Nina' }],
    });
    const cats = f.map((x) => x.category);
    expect(cats).toEqual(expect.arrayContaining(['overlap', 'duplicate', 'long_day', 'missing']));
    expect(f.find((x) => x.category === 'overlap')!.basis).toBe('fact');
    expect(f.find((x) => x.category === 'long_day')!.metrics[0]).toMatchObject({ value: 15, unit: 'hours' });
    expect(f.find((x) => x.category === 'missing')!.summary).toContain('Nina');
    for (const x of f) neutral(`${x.title} ${x.summary} ${x.next_step}`);
  });
  it('passes the approval queue flags through, and nothing for a clean period', () => {
    const f = timesheetFindings({ period, entries: [], sheets: [sheet({ totalSeconds: 8 * 3600, flags: ['late_time'] })], missing: [] });
    expect(f.find((x) => x.category === 'flagged')!.summary).toContain('late');
    expect(timesheetFindings({ period, entries: [], sheets: [sheet({ totalSeconds: 8 * 3600 })], missing: [] })).toEqual([]);
  });
});
