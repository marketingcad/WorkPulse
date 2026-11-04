/** Time and caption formatting shared by build-package.ts (planned timings) and render.ts (real ones). */

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
