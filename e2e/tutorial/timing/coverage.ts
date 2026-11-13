/**
 * Does the video show what the voiceover names? A scene's `actions` quote the on-screen labels it
 * works with ("Approve", Time Tracking › Approvals). Each of those the narration says is a mention,
 * and a mention is shown when an anchor of the recording (`{ on }`) covers its words, so the zoom,
 * click or cursor lands on it as it is said. `test/coverage.test.ts` checks every scene.
 */
import { anchorWords, normalize } from './anchors';

export interface Mention {
  label: string;
  /** its words in the narration (first occurrence) */
  first: number;
  last: number;
}

type SceneText = { id: string; narration: string; actions: string[] };

/** The quoted labels and menu-path steps of the scene's actions that the narration says, in narration order. */
export function mentions(scene: SceneText): Mention[] {
  const labels = new Map<string, string>();
  const add = (raw: string) => {
    const label = raw.trim().replace(/[.,:;]+$/, '');
    if (label && normalize(label.replace(/\s+/g, '')) && !labels.has(normalize(label.replace(/\s+/g, '')))) labels.set(normalize(label.replace(/\s+/g, '')), label);
  };
  for (const a of scene.actions) {
    for (const m of a.matchAll(/"([^"]+)"/g)) add(m[1]!);
    // Menu paths: Time Tracking › Approvals → each step.
    for (const m of a.matchAll(/[A-Z][^"›.,;:]*(?:\s›\s[A-Z][^"›.,;:]*)+/g)) for (const step of m[0].split('›')) add(step.replace(/^(Open|Click|Choose|Go to)\s+/, ''));
  }
  const out: Mention[] = [];
  for (const label of labels.values()) {
    try {
      out.push({ label, ...anchorWords(scene, label) });
    } catch {
      // Not said in the narration: shown or typed, but not named.
    }
  }
  return out.sort((a, b) => a.first - b.first);
}

/**
 * Which mentions an anchor shows and which it does not. `offScreen` lists labels the narration names
 * but the screen cannot show (they wait for the motion-graphics layer).
 */
export function coverage(scene: SceneText, anchors: Array<{ on: string; nth?: number }>, offScreen: string[] = []): { covered: Mention[]; missing: Mention[]; offScreen: Mention[] } {
  const ranges = anchors.flatMap((a) => {
    try {
      return [anchorWords(scene, a.on, a.nth)];
    } catch {
      return [];
    }
  });
  const skip = new Set(offScreen.map((l) => normalize(l.replace(/\s+/g, ''))));
  const covered: Mention[] = [];
  const missing: Mention[] = [];
  const off: Mention[] = [];
  for (const m of mentions(scene)) {
    if (skip.has(normalize(m.label.replace(/\s+/g, '')))) off.push(m);
    else if (ranges.some((r) => r.first <= m.last && r.last >= m.first)) covered.push(m);
    else missing.push(m);
  }
  return { covered, missing, offScreen: off };
}
