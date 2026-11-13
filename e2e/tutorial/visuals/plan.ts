/**
 * The animated visuals of one scene, timed to its narration (spec 2026-11-14 visual layer):
 * a highlight ring and a name label on each anchored item, step numbers, callouts, concept cards and
 * the scene tag. Times are video seconds from the scene's start; x/y/w/h are video pixels of the
 * element's own clip. `point` elements are laid over the footage before the zoom (they follow the
 * item), `fixed` ones after it (they keep their size).
 */
import { anchorWords, normalize, scriptWords } from '../timing/anchors';
import { mentions } from '../timing/coverage';
import { mapTime, type RetimePlan } from '../timing/retime';
import type { Box, Marker, WordTime } from '../timing/types';
import { CONCEPTS, conceptHits, type ConceptId, type SceneVisuals } from './concepts';

export type VisualKind = 'ring' | 'label' | 'callout' | 'card' | 'tag';

export interface Visual {
  kind: VisualKind;
  layer: 'point' | 'fixed';
  from: number;
  to: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** what the overlay page draws (overlay.html); never the position, so identical elements share a clip */
  spec: Record<string, unknown> & { step?: number };
}

export interface PlanInput {
  scene: { id: string; title: string; narration: string; actions: string[]; visuals?: SceneVisuals };
  chapter: number;
  /** where the voice starts in the scene (render.ts LEAD) */
  lead: number;
  /** the scene's words, timed from the start of its voice */
  words: WordTime[];
  markers: Marker[];
  /** the clip time of the scene start marker */
  start: number;
  retime: RetimePlan;
  /** the scene's callout texts */
  callouts: string[];
}

const FRAME = { w: 1920, h: 1080 };
/** How long a ring may stay, and the least it shows. */
const RING_MAX = 1.5;
const RING_MIN = 0.5;
/** Room around the item for the ring's glow. */
const RING_MARGIN = 26;
const CALLOUT_SECONDS = 3.5;
const CARD_SECONDS = 3.5;
const FLOW_SECONDS = 5;
const CARD = { w: 440, h: 300 };
const FLOW_CARD = { w: 680, h: 300 };
const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'from', 'into', 'what', 'they', 'their', 'when', 'each', 'here', 'then', 'only', 'have', 'will']);

const round = (n: number) => Math.round(n * 1000) / 1000;
const clampX = (x: number, w: number) => Math.round(Math.min(FRAME.w - w - 8, Math.max(8, x)));

export function planVisuals(input: PlanInput): Visual[] {
  const { scene, lead, words, markers, start, retime } = input;
  const at = (clipAt: number) => mapTime(retime.pieces, clipAt - start);
  const wordAt = (i: number) => round(lead + (words[Math.min(i, words.length - 1)]?.start ?? 0));
  const out: Visual[] = [];

  // ─── Rings and labels, on the anchored items ─────────────────────────────
  const interactions = markers.filter((m) => m.interaction).map((m) => ({ t: at(m.at), kind: m.interaction! }));
  const sceneMentions = mentions(scene);
  let step = 0;
  markers.forEach((m, key) => {
    const target = m.target ?? m.box;
    if (!m.on || !target) return;
    const shown = retime.anchors.find((a) => a.key === key)?.shownAt;
    if (shown === null || shown === undefined) return;
    const from = round(shown);
    const next = interactions.find((i) => i.t > from + 0.2);
    const end = next ? next.t + (next.kind === 'click' ? 0.15 : 0) : Infinity;
    const to = round(Math.max(from + RING_MIN, Math.min(from + RING_MAX, end)));
    const isClick = m.label.startsWith('click:');
    const ring: Visual = {
      kind: 'ring',
      layer: 'point',
      from,
      to,
      x: Math.round(target.x - RING_MARGIN),
      y: Math.round(target.y - RING_MARGIN),
      w: Math.round(target.width + 2 * RING_MARGIN),
      h: Math.round(target.height + 2 * RING_MARGIN),
      spec: { w: target.width, h: target.height, margin: RING_MARGIN, click: isClick, ...(scene.visuals?.steps && isClick ? { step: ++step } : {}) },
    };
    out.push(ring);
    const words = rangeOf(scene, m.on, m.nth);
    const named = words && sceneMentions.find((x) => x.first <= words.last && x.last >= words.first);
    if (named) out.push(label(named.label, target, from, to));
  });

  // ─── Callouts, when their topic is spoken ────────────────────────────────
  const spoken = scriptWords(scene.narration).map(normalize);
  input.callouts.forEach((text, i) => {
    const keys = new Set(text.split(/\s+/).map(normalize).filter((w) => w.length >= 4 && !STOP.has(w)));
    let best = { score: 0, first: -1 };
    for (let s = 0; s < spoken.length; s++) {
      const window = spoken.slice(s, s + 12);
      const score = new Set(window.filter((w) => keys.has(w))).size;
      if (score > best.score) best = { score, first: s + window.findIndex((w) => keys.has(w)) };
    }
    // No words in common: spread through the scene, as before.
    const total = (words.at(-1)?.end ?? 0) + lead;
    const from = best.first >= 0 ? wordAt(best.first) : round(1.5 + (i * (total - 1.5)) / Math.max(1, input.callouts.length));
    const w = Math.min(1200, Math.round(text.length * 15 + 150));
    out.push({ kind: 'callout', layer: 'fixed', from, to: round(from + CALLOUT_SECONDS), x: Math.round((FRAME.w - w) / 2), y: FRAME.h - 112 - 34, w, h: 112, spec: { text } });
  });

  // ─── Concept cards, on their words, in the corner farthest from the ring ─
  for (const hit of conceptHits(scene)) {
    const from = wordAt(hit.first);
    const flow = hit.concept === 'flow';
    const size = flow ? FLOW_CARD : CARD;
    const ring = out.find((v) => v.kind === 'ring' && v.from <= from + 0.5 && v.to >= from - 0.5) ?? out.filter((v) => v.kind === 'ring' && v.from <= from).at(-1);
    const corner = farthestCorner(size, ring ? { x: ring.x + ring.w / 2, y: ring.y + ring.h / 2 } : null);
    out.push({
      kind: 'card',
      layer: 'fixed',
      from,
      to: round(from + (flow ? FLOW_SECONDS : CARD_SECONDS)),
      ...corner,
      ...size,
      spec: { concept: hit.concept, caption: CONCEPTS[hit.concept as ConceptId].caption, ...(flow ? { nodes: flowNodes(spoken, hit.first, (i) => wordAt(i) - from) } : {}) },
    });
  }

  // ─── The scene tag ───────────────────────────────────────────────────────
  const tag = `Chapter ${input.chapter} · ${scene.title}`;
  const tw = Math.round(tag.length * 10 + 64);
  out.push({ kind: 'tag', layer: 'fixed', from: 0.4, to: 3.9, x: Math.round((FRAME.w - tw) / 2), y: 14, w: tw, h: 44, spec: { text: tag } });

  return oneAtATime(out);
}

function label(text: string, target: Box, from: number, to: number): Visual {
  const w = Math.round(text.length * 11 + 48);
  const h = 48;
  const above = target.y - h - 12 > 70;
  const cx = target.x + target.width / 2;
  const x = clampX(cx - w / 2, w);
  return {
    kind: 'label',
    layer: 'point',
    from,
    to: round(Math.max(to, from + 1.2)),
    x,
    y: Math.round(above ? target.y - h - 6 : target.y + target.height + 6),
    w,
    h,
    spec: { text, pointer: above ? 'down' : 'up', pointerX: Math.round(Math.min(w - 18, Math.max(18, cx - x))) },
  };
}

/** The workflow card's steps, each when its word is spoken (or just after the step before). */
function flowNodes(spoken: string[], from: number, rel: (i: number) => number): Array<{ label: string; at: number }> {
  const steps: Array<[string, RegExp]> = [['Time', /^time/], ['Approval', /^approv/], ['Invoices', /^invoice/], ['Payroll', /^payroll/]];
  const nodes: Array<{ label: string; at: number }> = [];
  let last = 0;
  for (const [label, word] of steps) {
    const i = spoken.findIndex((w, k) => k >= from && word.test(w));
    last = i >= 0 ? Math.max(last, round(rel(i))) : round(last + 0.6);
    nodes.push({ label, at: last });
  }
  return nodes;
}

function farthestCorner(size: { w: number; h: number }, from: { x: number; y: number } | null): { x: number; y: number } {
  const m = 48;
  const corners = [
    { x: FRAME.w - size.w - m, y: 96 },
    { x: FRAME.w - size.w - m, y: FRAME.h - size.h - 200 },
    { x: m + 240, y: FRAME.h - size.h - 200 },
    { x: m + 240, y: 96 },
  ];
  if (!from) return corners[0]!;
  const dist = (c: { x: number; y: number }) => Math.hypot(c.x + size.w / 2 - from.x, c.y + size.h / 2 - from.y);
  return corners.reduce((a, b) => (dist(b) > dist(a) ? b : a));
}

/** At most one element of each kind on screen: a newer one ends the one before. */
function oneAtATime(all: Visual[]): Visual[] {
  const out = [...all].sort((a, b) => a.from - b.from);
  const last = new Map<VisualKind, Visual>();
  for (const v of out) {
    const prev = last.get(v.kind);
    if (prev && prev.to > v.from) prev.to = v.from;
    last.set(v.kind, v);
  }
  return out.filter((v) => v.to > v.from);
}

function rangeOf(scene: { id: string; narration: string }, on: string, nth?: number): { first: number; last: number } | null {
  try {
    return anchorWords(scene, on, nth);
  } catch {
    return null;
  }
}
