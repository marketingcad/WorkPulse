/** Time and caption formatting shared by build-package.ts (planned timings) and render.ts (real ones). */
import { normalize, scriptWords } from './timing/anchors';
import type { WordTime } from './timing/types';

/** 75 → "1:15"; with hours when the video is that long. */
export function clock(total: number): string {
  const s = Math.round(total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** SRT time: 00:01:02,500 */
export function srtTime(total: number): string {
  const ms = Math.round(total * 1000);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Splits narration into subtitle cues of at most two lines of 42 characters. */
export function cues(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()) ?? [];
  const out: string[] = [];
  for (const sentence of sentences) {
    let line = '';
    let cue: string[] = [];
    for (const w of sentence.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > 42) {
        cue.push(line);
        line = w;
        if (cue.length === 2) {
          out.push(cue.join('\n'));
          cue = [];
        }
      } else line = (line + ' ' + w).trim();
    }
    if (line) cue.push(line);
    if (cue.length) out.push(cue.join('\n'));
  }
  return out;
}

/** Spreads a scene's cues over its narration, in proportion to their words: [start, end, text] from `at`. */
export function timedCues(narration: string, at: number, seconds: number): Array<[number, number, string]> {
  const total = words(narration);
  const out: Array<[number, number, string]> = [];
  for (const p of cues(narration)) {
    const len = (words(p) / total) * seconds;
    out.push([at, at + len - 0.05, p]);
    at += len;
  }
  return out;
}

/** How long a caption stays after its last word, and the least time one is on screen. */
const CUE_AFTER = 0.3;
const CUE_MIN = 1;

/**
 * The scene's cues timed to its spoken words: [start, end, text] from `at`. `words` are the scene's
 * script words (one per scriptWords(narration)), timed from the start of its voice. A cue starts on its
 * first word and ends a little after its last, at least CUE_MIN later, and always before the next cue.
 */
export function wordCues(narration: string, words: WordTime[], at: number): Array<[number, number, string]> {
  // Cues and words are matched by their letters, so a token that cues() splits (as "$1,250.00" at its
  // full stop) still finds its word.
  const ends: number[] = [];
  let chars = 0;
  for (const w of scriptWords(narration)) ends.push((chars += normalize(w).length));
  const wordAt = (char: number) => Math.min(words.length - 1, Math.max(0, ends.findIndex((e) => e > char)));
  const spans: Array<{ first: number; last: number; text: string }> = [];
  let pos = 0;
  for (const text of cues(narration)) {
    const len = normalize(text).length;
    if (!len || !words.length) continue;
    spans.push({ first: wordAt(pos), last: wordAt(pos + len - 1), text });
    pos += len;
  }
  // Each cue starts a little after the one before, even when estimated words share a time, so no cue
  // ends before it starts (players drop those).
  const starts: number[] = [];
  for (const c of spans) starts.push(Math.max(at + words[c.first]!.start, (starts.at(-1) ?? -Infinity) + 0.1));
  return spans.map((c, i) => {
    const start = starts[i]!;
    const next = i + 1 < starts.length ? starts[i + 1]! - 0.05 : Infinity;
    const end = Math.min(next, Math.max(at + words[c.last]!.end + CUE_AFTER, start + CUE_MIN));
    return [start, end, c.text];
  });
}
