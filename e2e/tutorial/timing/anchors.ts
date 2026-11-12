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
