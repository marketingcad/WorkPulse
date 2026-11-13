/**
 * Word times for the narration as written, from the words a recognizer heard in the voice file.
 *
 * The recognizer's words differ from the script in places ("work pulse", "three", a misheard word), so
 * the two are aligned by minimum edit distance. Matched script words take the heard times; the rest
 * are spread, in order, over the gap between their matched neighbours.
 */
import { normalize, scriptWords } from './anchors';
import type { WordTime } from './types';

/** Below this share of matched script words, the estimate is used instead. */
export const MIN_MATCH = 0.8;

const NUMBERS: Record<string, string> = Object.fromEntries(
  [
    ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
    ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
    ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90], ['hundred', 100],
  ].map(([w, n]) => [w as string, String(n)]),
);
const number = (w: string) => NUMBERS[w] ?? w;
const same = (a: string, b: string) => a === b || number(a) === number(b);
const ms = (n: number) => Math.round(n * 1000) / 1000;
/** How long a word takes to say, roughly: its letters plus a gap. */
const weight = (w: string) => normalize(w).length + 1;

type Op = 'match' | 'sub' | 'del' | 'ins' | 'oneTwo' | 'twoOne';

/**
 * One time per word of `scriptWords(narration)`, and the share of those words the recognizer matched.
 * `voiceSeconds` bounds the words before the first match and after the last.
 */
export function alignToScript(narration: string, heard: WordTime[], voiceSeconds: number): { words: WordTime[]; ratio: number } {
  const script = scriptWords(narration);
  const s = script.map(normalize);
  const h = heard.map((x) => normalize(x.word));
  const n = s.length;
  const m = h.length;

  // cost[i][j]: edits to align the first i script words with the first j heard words.
  const cost = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const op = Array.from({ length: n + 1 }, () => new Array<Op | null>(m + 1).fill(null));
  cost[0]![0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      // Matches are tried first so a tie keeps them.
      const options: Array<[number, Op]> = [];
      if (i >= 1 && j >= 1 && same(s[i - 1]!, h[j - 1]!)) options.push([cost[i - 1]![j - 1]!, 'match']);
      if (i >= 1 && j >= 2 && s[i - 1] === h[j - 2]! + h[j - 1]!) options.push([cost[i - 1]![j - 2]!, 'oneTwo']);
      if (i >= 2 && j >= 1 && s[i - 2]! + s[i - 1]! === h[j - 1]) options.push([cost[i - 2]![j - 1]!, 'twoOne']);
      if (i >= 1 && j >= 1) options.push([cost[i - 1]![j - 1]! + 1, 'sub']);
      if (i >= 1) options.push([cost[i - 1]![j]! + 1, 'del']);
      if (j >= 1) options.push([cost[i]![j - 1]! + 1, 'ins']);
      for (const [c, o] of options)
        if (c < cost[i]![j]!) {
          cost[i]![j] = c;
          op[i]![j] = o;
        }
    }

  // Walk back, giving matched script words their heard times.
  const times: Array<{ start: number; end: number } | null> = new Array(n).fill(null);
  let matched = 0;
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const o = op[i]![j]!;
    if (o === 'match') {
      times[i - 1] = { start: heard[j - 1]!.start, end: heard[j - 1]!.end };
      matched++;
      i--;
      j--;
    } else if (o === 'oneTwo') {
      times[i - 1] = { start: heard[j - 2]!.start, end: heard[j - 1]!.end };
      matched++;
      i--;
      j -= 2;
    } else if (o === 'twoOne') {
      const { start, end } = heard[j - 1]!;
      const a = weight(script[i - 2]!);
      const mid = ms(start + ((end - start) * a) / (a + weight(script[i - 1]!)));
      times[i - 2] = { start, end: mid };
      times[i - 1] = { start: mid, end };
      matched += 2;
      i -= 2;
      j--;
    } else if (o === 'sub') {
      i--;
      j--;
    } else if (o === 'del') i--;
    else j--;
  }

  return { words: fill(script, times, voiceSeconds), ratio: n ? matched / n : 1 };
}

/** The word-count estimate: every word in turn, from `lead` to `voiceSeconds`, by its length. */
export function estimateWords(narration: string, voiceSeconds: number, lead = 0): WordTime[] {
  const script = scriptWords(narration);
  return fill(script, new Array(script.length).fill(null), voiceSeconds, lead);
}

/** Gives every word without a time a share of the gap between the words around it that have one. */
function fill(script: string[], times: Array<{ start: number; end: number } | null>, voiceSeconds: number, lead = 0): WordTime[] {
  const out: WordTime[] = [];
  for (let i = 0; i < script.length; ) {
    const t = times[i];
    if (t) {
      out.push({ word: script[i]!, start: t.start, end: t.end });
      i++;
      continue;
    }
    let k = i;
    while (k < script.length && !times[k]) k++;
    const from = i === 0 ? lead : times[i - 1]!.end;
    const to = Math.max(from, k === script.length ? voiceSeconds : times[k]!.start);
    const total = script.slice(i, k).reduce((sum, w) => sum + weight(w), 0);
    let at = from;
    for (let x = i; x < k; x++) {
      const end = x === k - 1 ? to : ms(at + ((to - from) * weight(script[x]!)) / total);
      out.push({ word: script[x]!, start: ms(at), end: ms(end) });
      at = end;
    }
    i = k;
  }
  // The recognizer's times can step back now and then: a word never starts before the one before it ends.
  let last = lead;
  for (const w of out) {
    w.start = Math.max(w.start, last);
    w.end = Math.max(w.end, w.start);
    last = w.end;
  }
  return out;
}
