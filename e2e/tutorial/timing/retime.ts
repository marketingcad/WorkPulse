/**
 * Retiming a scene's footage so each anchored moment is shown when its words are spoken.
 *
 * Between anchors the footage plays faster (up to `maxSpeed`) when it outlasts the words, and holds its
 * last frame before the anchor when it is shorter: the presenter waiting, the cursor on the target.
 * It is never slowed. After the last anchor (or for a scene without anchors) the rule is the renderer's
 * original one, so unanchored scenes come out exactly as before.
 */
import type { AnchorResult, Piece } from './types';

export interface RetimeInput {
  /** trimmed footage length, seconds (scene end - scene start) */
  clip: number;
  /** LEAD + speech + TAIL: the least the scene lasts */
  target: number;
  maxSpeed: number;
  /** clipAt from the trimmed start; wordAt = LEAD + the start of the anchor's first word */
  anchors: Array<{ label: string; on: string; clipAt: number; wordAt: number }>;
}

export interface RetimePlan {
  pieces: Piece[];
  length: number;
  anchors: AnchorResult[];
}

/** An anchor this far behind its word or more is reported. */
export const LATE_MS = 150;

const ms = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function planRetime({ clip, target, maxSpeed, anchors }: RetimeInput): RetimePlan {
  const inside = anchors.filter((a) => a.clipAt >= 0 && a.clipAt <= clip).sort((a, b) => a.clipAt - b.clipAt);
  const results: AnchorResult[] = [];
  const kept: Array<(typeof inside)[number] & { result: AnchorResult }> = [];
  for (const a of inside) {
    const result: AnchorResult = { label: a.label, on: a.on, wordAt: a.wordAt, shownAt: null, driftMs: null };
    results.push(result);
    if (kept.length && a.wordAt < kept.at(-1)!.wordAt) result.note = 'out of order';
    else kept.push({ ...a, result });
  }

  const pieces: Piece[] = [];
  // A piece with no footage gives ffmpeg no frame to hold, so a hold where no footage has played yet
  // waits here for the first piece (held before it), and a hold between two anchors recorded at the
  // same moment goes onto the piece before.
  let before = 0;
  const add = (from: number, to: number, speed: number, hold: number) => {
    if (to > from) {
      pieces.push({ from: ms(from), to: ms(to), speed: ms(speed), ...(before > 0 ? { holdBefore: ms(before) } : {}), holdAfter: ms(hold) });
      before = 0;
    } else if (pieces.length) pieces.at(-1)!.holdAfter = ms(pieces.at(-1)!.holdAfter + hold);
    else before += hold;
  };
  let v = 0;
  let from = 0;
  for (const a of kept) {
    const need = a.wordAt - v;
    const footage = a.clipAt - from;
    const speed = need > 0 && footage > 0 ? clamp(footage / need, 1, maxSpeed) : need > 0 ? 1 : maxSpeed;
    const hold = Math.max(0, need - footage / speed);
    v += footage / speed + hold;
    add(from, a.clipAt, speed, hold);
    const r = a.result;
    r.shownAt = ms(v);
    r.driftMs = Math.round((v - a.wordAt) * 1000);
    if (r.driftMs > LATE_MS) r.note = 'late';
    from = a.clipAt;
  }

  // The rest: the original whole-scene rule, measured from where the anchors left off.
  const footage = clip - from;
  const room = target + 1 - v;
  const speed = room > 0 ? clamp(footage / room, 1, maxSpeed) : maxSpeed;
  const hold = Math.max(0, target - (v + footage / speed));
  // A clip with no footage at all still needs one piece to show.
  if (footage > 0 || !pieces.length) pieces.push({ from: ms(from), to: ms(clip), speed: ms(speed), ...(before > 0 ? { holdBefore: ms(before) } : {}), holdAfter: ms(hold) });
  else add(from, clip, speed, hold);
  return { pieces, length: ms(v + footage / speed + hold), anchors: results };
}

/** The video time (seconds from the scene's start) at which a clip time is shown. */
export function mapTime(pieces: Piece[], clipT: number): number {
  // Before the scene starts (marks made before d.begin()): stays negative, as the renderer skips those.
  if (clipT < 0) return ms(clipT / (pieces[0]?.speed ?? 1));
  let v = 0;
  for (const p of pieces) {
    v += p.holdBefore ?? 0;
    if (clipT < p.to) return ms(v + (Math.max(clipT, p.from) - p.from) / p.speed);
    v += (p.to - p.from) / p.speed + p.holdAfter;
  }
  return ms(v - (pieces.at(-1)?.holdAfter ?? 0));
}

/**
 * The ffmpeg filter from the trimmed clip ([0:v]) to the retimed picture ([rt]): each piece trimmed,
 * played at its speed and held, then joined. The last piece holds 0.1 s longer, as the renderer always
 * has, so the picture never ends before the audio. One piece is the renderer's original chain.
 */
export function retimeChain(pieces: Piece[]): string {
  const play = (p: Piece, last: boolean) => {
    const hold = ms(p.holdAfter + (last ? 0.1 : 0));
    const pad = [...(p.holdBefore ? [`start_mode=clone:start_duration=${p.holdBefore}`] : []), ...(hold > 0 ? [`stop_mode=clone:stop_duration=${hold}`] : [])];
    return `setpts=(PTS-STARTPTS)/${p.speed},fps=30,scale=1920:1080${pad.length ? `,tpad=${pad.join(':')}` : ''}`;
  };
  if (pieces.length === 1) return `[0:v]${play(pieces[0]!, true)}[rt]`;
  const n = pieces.length;
  return [
    `[0:v]split=${n}${pieces.map((_, i) => `[c${i}]`).join('')}`,
    ...pieces.map((p, i) => `[c${i}]trim=start=${p.from}:end=${p.to},${play(p, i === n - 1)}[p${i}]`),
    `${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${n}:v=1:a=0[rt]`,
  ].join(';\n');
}
