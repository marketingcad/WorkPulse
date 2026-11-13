import { describe, expect, it } from 'vitest';
import { placeTimeline, syncReport } from '../timing/timeline';
import type { AnchorResult, SceneTimeline } from '../timing/types';

const scene = (id: string, anchors: AnchorResult[]): SceneTimeline => ({
  scene: id, start: 0, seconds: 10,
  voice: { start: 0.4, seconds: 8, aligner: 'whisper' },
  words: [], anchors, pieces: [], captions: [],
});
const a = (on: string, driftMs: number | null, note?: AnchorResult['note']): AnchorResult => ({ label: `mark ${on}`, on, wordAt: 2, shownAt: driftMs === null ? null : 2 + driftMs / 1000, driftMs, ...(note ? { note } : {}) });

describe('syncReport', () => {
  it('lists late and dropped anchors, and nothing within 150 ms', () => {
    const r = syncReport([
      scene('07.3', [a('the timer', 620, 'late'), a('Coffee', 140), a('Lunch', null, 'out of order')]),
      scene('09.2', [a('Approve', 0)]),
    ]);
    expect(r.lines).toEqual(['07.3 "the timer": 620 ms late', '07.3 "Lunch": out of order (dropped)']);
    expect(r.json).toEqual([{ scene: '07.3', anchors: [a('the timer', 620, 'late'), a('Lunch', null, 'out of order')] }]);
  });
});

describe('placeTimeline', () => {
  it('sets each scene\'s start in the whole video', () => {
    const placed = placeTimeline([scene('01.1', []), scene('01.2', [])], [4, 17.5]);
    expect(placed.map((s) => s.start)).toEqual([4, 17.5]);
  });
});
