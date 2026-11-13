import { describe, expect, it } from 'vitest';
import { estimateWords } from '../timing/align';
import { scriptWords } from '../timing/anchors';
import type { WordTime } from '../timing/types';
import { cues, wordCues } from '../format';
import { CHAPTERS } from '../scenes';

/** Word i spoken from i to i + 0.5 s. */
const evenly = (narration: string): WordTime[] => scriptWords(narration).map((word, i) => ({ word, start: i, end: i + 0.5 }));

describe('wordCues', () => {
  // cues(): "Open the Approvals page and pick a week." splits into one cue per sentence here.
  const two = 'Open the Approvals page. Click Approve.';

  it('starts each cue on its first word and ends it after its last', () => {
    const c = wordCues(two, evenly(two), 10);
    expect(c.map((x) => x[2])).toEqual(cues(two));
    expect(c[0]![0]).toBe(10); // "Open" at 0
    expect(c[0]![1]).toBeCloseTo(10 + 3.5 + 0.3); // "page." ends at 3.5, the next cue starts at 4
    expect(c[1]![0]).toBe(14); // "Click" at 4
  });

  it('clips a cue before the next one starts', () => {
    const words: WordTime[] = [
      { word: 'Open', start: 0, end: 0.2 },
      { word: 'it.', start: 0.2, end: 0.4 },
      { word: 'Now', start: 0.5, end: 0.7 },
      { word: 'go.', start: 0.7, end: 0.9 },
    ];
    const c = wordCues('Open it. Now go.', words, 0);
    expect(c[0]![1]).toBeCloseTo(0.45);
    expect(c[1]![0]).toBe(0.5);
  });

  it('never ends a cue before it starts, when two cues start at the same time', () => {
    const words: WordTime[] = [
      { word: 'Alpha', start: 1, end: 1 },
      { word: 'beta.', start: 1, end: 1 },
      { word: 'Gamma', start: 1, end: 1.5 },
      { word: 'delta.', start: 1.5, end: 2 },
    ];
    for (const [start, end] of wordCues('Alpha beta. Gamma delta.', words, 0)) expect(end).toBeGreaterThan(start);
  });

  it('keeps a short last cue on screen for at least a second', () => {
    const c = wordCues('Done.', [{ word: 'Done.', start: 2, end: 2.2 }], 0);
    expect(c[0]![1]).toBeCloseTo(3);
  });

  it('skips symbols the voice does not say', () => {
    const n = 'Open Time › Approvals → the list.';
    const words = evenly(n); // Open Time Approvals → the list.
    const c = wordCues(n, words, 0);
    expect(c).toHaveLength(1);
    expect(c[0]![2]).toBe(cues(n)[0]);
    expect(c[0]![0]).toBe(0);
    expect(c[0]![1]).toBeCloseTo(words.at(-1)!.end + 0.3);
  });

  it('keeps cues on their words when cues() splits a token at a full stop', () => {
    const n = 'It totals $1,250.00 today. Then approve it.';
    const words = evenly(n); // It totals $1,250.00 today. Then approve it.
    const c = wordCues(n, words, 0);
    expect(c.at(-1)![2]).toBe('Then approve it.');
    expect(c.at(-1)![0]).toBe(4); // "Then" is word 4
  });

  it('gives every scene of the tutorial the same cues as cues(), never overlapping', () => {
    for (const s of CHAPTERS.flatMap((c) => c.scenes)) {
      const c = wordCues(s.narration, estimateWords(s.narration, 30), 0);
      expect(c.map((x) => x[2]), s.id).toEqual(cues(s.narration));
      for (let i = 1; i < c.length; i++) expect(c[i - 1]![1], s.id).toBeLessThanOrEqual(c[i]![0]);
    }
  });
});
