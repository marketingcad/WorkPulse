import { describe, expect, it } from 'vitest';
import { alignToScript, estimateWords, MIN_MATCH } from '../timing/align';
import type { WordTime } from '../timing/types';

const w = (word: string, start: number, end: number): WordTime => ({ word, start, end });
const rising = (words: WordTime[]) => words.every((x, i) => x.start <= x.end && (i === 0 || words[i - 1]!.end <= x.start + 1e-9));

describe('alignToScript', () => {
  it('takes the heard times when every word matches', () => {
    const r = alignToScript('Click Approve now.', [w('click', 0.1, 0.4), w('approve', 0.5, 0.8), w('now', 0.9, 1.1)], 2);
    expect(r.words).toEqual([w('Click', 0.1, 0.4), w('Approve', 0.5, 0.8), w('now.', 0.9, 1.1)]);
    expect(r.ratio).toBe(1);
  });

  it('places a misheard word between its matched neighbours', () => {
    const r = alignToScript('Open the Payroll page', [w('open', 0, 0.3), w('the', 0.4, 0.5), w('payrolls', 0.6, 1), w('page', 1.2, 1.5)], 2);
    expect(r.ratio).toBe(0.75);
    const payroll = r.words[2]!;
    expect(payroll.word).toBe('Payroll');
    expect(payroll.start).toBeGreaterThanOrEqual(0.5);
    expect(payroll.end).toBeLessThanOrEqual(1.2);
    expect(rising(r.words)).toBe(true);
  });

  it('matches one script word heard as two', () => {
    const r = alignToScript('Welcome to WorkPulse.', [w('welcome', 0, 0.4), w('to', 0.5, 0.6), w('work', 0.7, 0.9), w('pulse', 0.95, 1.3)], 2);
    expect(r.words[2]).toEqual(w('WorkPulse.', 0.7, 1.3));
    expect(r.ratio).toBe(1);
  });

  it('matches two script words heard as one, splitting its time', () => {
    const r = alignToScript('Click sign in', [w('click', 0, 0.3), w('signin', 0.4, 1)], 2);
    expect(r.ratio).toBe(1);
    expect(r.words[1]!.start).toBe(0.4);
    expect(r.words[2]!.end).toBe(1);
    expect(r.words[1]!.end).toBeCloseTo(r.words[2]!.start);
    expect(r.words[1]!.end).toBeGreaterThan(0.4);
    expect(r.words[1]!.end).toBeLessThan(1);
  });

  it('matches numbers said as words', () => {
    expect(alignToScript('Pick 3 projects', [w('pick', 0, 0.2), w('three', 0.3, 0.5), w('projects', 0.6, 1)], 2).ratio).toBe(1);
  });

  it('spreads every word over the voice when nothing was heard', () => {
    const r = alignToScript('one two three', [], 3);
    expect(r.ratio).toBe(0);
    expect(r.words[0]!.start).toBe(0);
    expect(r.words[2]!.end).toBe(3);
    expect(rising(r.words)).toBe(true);
  });

  it('never lets word times go backwards, even when the recognizer does', () => {
    const r = alignToScript('a b c d', [w('a', 1, 1.2), w('d', 0.5, 0.7)], 3);
    expect(rising(r.words)).toBe(true);
  });

  it('keeps times in order with spoken-out money and extra heard words', () => {
    const r = alignToScript(
      'The invoice totals $1,250.00 for March.',
      [w('the', 0, 0.2), w('invoice', 0.3, 0.7), w('totals', 0.8, 1.1), w('one', 1.2, 1.3), w('thousand', 1.3, 1.6), w('two', 1.6, 1.7), w('hundred', 1.7, 2), w('fifty', 2, 2.3), w('dollars', 2.3, 2.7), w('for', 2.8, 2.9), w('march', 3, 3.4)],
      4,
    );
    expect(r.ratio).toBeGreaterThanOrEqual(MIN_MATCH);
    expect(r.words[3]!.start).toBeGreaterThanOrEqual(1.1);
    expect(r.words[3]!.end).toBeLessThanOrEqual(2.8);
    expect(rising(r.words)).toBe(true);
  });
});

describe('estimateWords', () => {
  it('covers the voice from lead to end, word after word', () => {
    const e = estimateWords('one two', 2);
    expect(e).toHaveLength(2);
    expect(e[0]!.start).toBe(0);
    expect(e[1]!.end).toBe(2);
    expect(e[0]!.end).toBe(e[1]!.start);
  });
});
