import { describe, expect, it } from 'vitest';
import { charsToWords, parseWhisper } from '../timing/voice-timing';

describe('parseWhisper', () => {
  it('reads one word per item, in seconds, without blanks and lone punctuation', () => {
    const json = {
      transcription: [
        { offsets: { from: 0, to: 400 }, text: '[BLANK_AUDIO]' },
        { offsets: { from: 420, to: 710 }, text: ' Click' },
        { offsets: { from: 710, to: 720 }, text: '' },
        { offsets: { from: 720, to: 730 }, text: ' .' },
        { offsets: { from: 800, to: 1200 }, text: ' Approve,' },
      ],
    };
    expect(parseWhisper(json)).toEqual([
      { word: 'Click', start: 0.42, end: 0.71 },
      { word: 'Approve,', start: 0.8, end: 1.2 },
    ]);
  });

  it('uses the DTW token times of full JSON (-ojf): each word starts at its first spoken token, ends where the next starts', () => {
    const tok = (text: string, from: number, t_dtw: number) => ({ text, offsets: { from, to: from }, t_dtw });
    const json = {
      transcription: [
        { offsets: { from: 0, to: 60 }, text: '', tokens: [tok('[_BEG_]', 0, -1)] },
        { offsets: { from: 1470, to: 2200 }, text: ' home', tokens: [tok(' home', 1470, 104)] },
        { offsets: { from: 2200, to: 2280 }, text: ' page.', tokens: [tok(' page', 2200, 142), tok('.', 2270, 222)] },
        { offsets: { from: 2280, to: 2460 }, text: ' It', tokens: [tok(' It', 2340, -1)] },
      ],
    };
    expect(parseWhisper(json)).toEqual([
      { word: 'home', start: 1.04, end: 1.42 },
      { word: 'page.', start: 1.42, end: 2.34 },
      { word: 'It', start: 2.34, end: 2.46 },
    ]);
  });

  it('rejects output that is not whisper JSON', () => {
    expect(() => parseWhisper({ nope: true })).toThrow('whisper');
  });
});

describe('charsToWords', () => {
  it('joins characters into words between spaces', () => {
    const words = charsToWords({
      characters: ['H', 'i', ' ', 'y', 'o', 'u', '.'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65],
    });
    expect(words).toEqual([
      { word: 'Hi', start: 0, end: 0.2 },
      { word: 'you.', start: 0.3, end: 0.65 },
    ]);
  });
});
