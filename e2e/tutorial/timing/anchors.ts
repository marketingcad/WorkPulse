/**
 * Narration words, and finding a phrase among them. Word `i` everywhere in the timing code is
 * `scriptWords(narration)[i]`: the narration's tokens as written, without the ones the voice does not
 * say (›, —, and other lone symbols).
 */

/** A token as the voice says it, for comparing: lower case, letters and digits only; → is "to", & is "and". */
export function normalize(token: string): string {
  return token
    .toLowerCase()
    .replace(/→/g, 'to')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** The narration's spoken words, as written. */
export function scriptWords(narration: string): string[] {
  return narration.split(/\s+/).filter((t) => normalize(t) !== '');
}

/**
 * What is wrong with a recording's anchors, checked before any voice or video work: phrases the
 * narration does not say (errors: the render cannot time them) and anchors recorded outside the
 * scene (warnings: they are ignored).
 */
export function anchorProblems(scene: { id: string; narration: string }, markers: Array<{ at: number; label: string; on?: string; nth?: number }>): { errors: string[]; warnings: string[] } {
  const start = markers.find((m) => m.label.startsWith('scene start'))?.at ?? 0;
  const end = markers.find((m) => m.label.startsWith('scene end'))?.at ?? Infinity;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const m of markers) {
    if (!m.on) continue;
    if (m.at < start) warnings.push(`${scene.id} "${m.on}": recorded before the scene starts (d.begin()), so it is ignored`);
    else if (m.at > end) warnings.push(`${scene.id} "${m.on}": recorded after the scene ends (d.finish()), so it is ignored`);
    try {
      anchorWords(scene, m.on, m.nth);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { errors, warnings };
}

/** The first and last word of the `nth` time `on` is said in the scene's narration. Throws when it is not. */
export function anchorWords(scene: { id: string; narration: string }, on: string, nth = 1): { first: number; last: number } {
  const words = scriptWords(scene.narration).map(normalize);
  const phrase = scriptWords(on).map(normalize);
  let seen = 0;
  if (phrase.length)
    for (let i = 0; i + phrase.length <= words.length; i++) {
      if (phrase.every((p, j) => words[i + j] === p) && ++seen === nth) return { first: i, last: i + phrase.length - 1 };
    }
  throw new Error(`No "${on}" (occurrence ${nth}) in the narration of scene ${scene.id}`);
}
