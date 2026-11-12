import { describe, expect, it } from 'vitest';
import { mapTime, planRetime, retimeChain, type RetimeInput } from '../timing/retime';

const base = { maxSpeed: 1.5, anchors: [] } satisfies Partial<RetimeInput>;
const at = (clipAt: number, wordAt: number, on = 'x') => ({ label: `mark ${on}`, on, clipAt, wordAt });

describe('planRetime without anchors (today\'s rule)', () => {
  it('speeds long footage up to 1.5×', () => {
    const p = planRetime({ ...base, clip: 30, target: 12 });
    expect(p.pieces).toEqual([{ from: 0, to: 30, speed: 1.5, holdAfter: 0 }]);
    expect(p.length).toBe(20);
    expect(p.anchors).toEqual([]);
  });

  it('holds the last frame of short footage until the words end', () => {
    const p = planRetime({ ...base, clip: 8, target: 12 });
    expect(p.pieces).toEqual([{ from: 0, to: 8, speed: 1, holdAfter: 4 }]);
    expect(p.length).toBe(12);
  });

  it('leaves a little extra footage at 1× room, as before (clip / (target + 1))', () => {
    const p = planRetime({ ...base, clip: 14, target: 12 });
    expect(p.pieces[0]!.speed).toBeCloseTo(14 / 13, 3);
    expect(p.length).toBeCloseTo(13, 3);
  });
});

describe('planRetime with anchors', () => {
  it('holds the frame before an anchor until its word', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 5)] });
    expect(p.pieces[0]).toEqual({ from: 0, to: 2, speed: 1, holdAfter: 3 });
    expect(p.anchors[0]).toMatchObject({ on: 'x', wordAt: 5, shownAt: 5, driftMs: 0 });
    expect(p.anchors[0]!.note).toBeUndefined();
  });

  it('speeds up footage that outlasts the words, within the cap', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(6, 5)] });
    expect(p.pieces[0]).toEqual({ from: 0, to: 6, speed: 1.2, holdAfter: 0 });
    expect(p.anchors[0]).toMatchObject({ shownAt: 5, driftMs: 0 });
  });

  it('reports an anchor that is late even at 1.5×', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(9, 3)] });
    expect(p.pieces[0]!.speed).toBe(1.5);
    expect(p.anchors[0]).toMatchObject({ shownAt: 6, driftMs: 3000, note: 'late' });
  });

  it('lands two anchors on the same word, the second without a hold', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 5, 'a'), at(4, 5, 'b')] });
    expect(p.anchors.map((a) => a.on)).toEqual(['a', 'b']);
    expect(p.pieces[1]).toMatchObject({ from: 2, to: 4, speed: 1.5, holdAfter: 0 });
  });

  it('drops an anchor whose word comes before the previous one', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 8, 'a'), at(5, 4, 'b')] });
    expect(p.pieces.map((x) => [x.from, x.to])).toEqual([[0, 2], [2, 10]]);
    expect(p.anchors[1]).toMatchObject({ on: 'b', shownAt: null, driftMs: null, note: 'out of order' });
  });

  it('ignores anchors outside the clip (before begin(), after finish())', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(-1, 2), at(11, 9)] });
    expect(p.anchors).toEqual([]);
    expect(p.pieces).toHaveLength(1);
  });

  it('holds the first frame before footage that starts on an anchor (no empty piece)', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(0, 5)] });
    expect(p.pieces).toEqual([{ from: 0, to: 10, speed: 1.25, holdBefore: 5, holdAfter: 0 }]);
    expect(p.anchors[0]).toMatchObject({ shownAt: 5, driftMs: 0 });
    expect(p.length).toBe(13);
  });

  it('adds the hold of a second anchor recorded at the same moment to the piece before', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 5, 'a'), at(2, 8, 'b')] });
    expect(p.pieces[0]).toEqual({ from: 0, to: 2, speed: 1, holdAfter: 6 });
    expect(p.anchors[1]).toMatchObject({ on: 'b', shownAt: 8, driftMs: 0 });
  });

  it('never makes an empty piece, even with an anchor at the very end', () => {
    for (const anchors of [[at(0, 5)], [at(2, 5), at(2, 8)], [at(10, 11)], [at(0, 1), at(0, 2), at(10, 12)]])
      for (const piece of planRetime({ ...base, clip: 10, target: 12, anchors }).pieces) expect(piece.to).toBeGreaterThan(piece.from);
  });

  it('sorts anchors by when they were recorded', () => {
    const p = planRetime({ ...base, clip: 10, target: 12, anchors: [at(6, 7, 'late'), at(2, 5, 'early')] });
    expect(p.anchors.map((a) => a.on)).toEqual(['early', 'late']);
  });
});

describe('mapTime', () => {
  const held = planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 5)] }).pieces;

  it('maps an anchor to when it is shown, after its hold', () => {
    expect(mapTime(held, 2)).toBe(5);
    expect(mapTime(held, 1)).toBe(1);
  });

  it('counts a hold before the footage', () => {
    const pieces = planRetime({ ...base, clip: 10, target: 12, anchors: [at(0, 5)] }).pieces;
    expect(mapTime(pieces, 0)).toBe(5);
    expect(mapTime(pieces, 1)).toBe(5.8);
  });

  it('scales time in a faster piece', () => {
    expect(mapTime([{ from: 0, to: 30, speed: 1.5, holdAfter: 0 }], 15)).toBe(10);
  });

  it('keeps times before the clip before it, so the renderer still skips them', () => {
    expect(mapTime([{ from: 0, to: 30, speed: 1.5, holdAfter: 0 }], -3)).toBeLessThan(0);
  });

  it('puts times past the end at the last frame of footage', () => {
    expect(mapTime([{ from: 0, to: 8, speed: 1, holdAfter: 4 }], 9)).toBe(8);
  });
});

describe('retimeChain', () => {
  it('is today\'s filter for a single piece', () => {
    expect(retimeChain([{ from: 0, to: 8, speed: 1, holdAfter: 4 }])).toBe('[0:v]setpts=(PTS-STARTPTS)/1,fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=4.1[rt]');
  });

  it('holds the first frame for a hold before the footage', () => {
    expect(retimeChain([{ from: 0, to: 10, speed: 1.25, holdBefore: 5, holdAfter: 0 }])).toBe(
      '[0:v]setpts=(PTS-STARTPTS)/1.25,fps=30,scale=1920:1080,tpad=start_mode=clone:start_duration=5:stop_mode=clone:stop_duration=0.1[rt]',
    );
  });

  it('splits, retimes, holds and joins the pieces', () => {
    const chain = retimeChain(planRetime({ ...base, clip: 10, target: 12, anchors: [at(2, 5)] }).pieces);
    expect(chain).toContain('[0:v]split=2[c0][c1]');
    expect(chain).toContain('[c0]trim=start=0:end=2,setpts=(PTS-STARTPTS)/1,fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=3[p0]');
    expect(chain).toContain('[c1]trim=start=2:end=10,setpts=(PTS-STARTPTS)/1,fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=0.1[p1]');
    expect(chain).toContain('[p0][p1]concat=n=2:v=1:a=0[rt]');
  });
});
