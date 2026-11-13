import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../scenes';
import { NOT_SHOWN } from '../coverage-exempt';
import { coverage } from '../timing/coverage';
import { recordingAnchors } from '../timing/recording-anchors';

/** The video shows what the voiceover names: every on-screen label a scene's narration says is anchored to its words. */
const anchors = recordingAnchors();
const scenes = CHAPTERS.flatMap((c) => c.scenes).filter((s) => s.app !== 'edit');

describe('every named label is shown as it is said', () => {
  it.each(scenes.map((s) => [s.id, s] as const))('%s', (_, s) => {
    const r = coverage(s, anchors.get(s.id) ?? [], Object.keys(NOT_SHOWN[s.id] ?? {}));
    expect(r.missing.map((m) => m.label), `not shown in ${s.id}: add an { on } anchor where the recording shows it, or list it in coverage-exempt.ts with the reason`).toEqual([]);
  });

  it('lists only labels the narration says', () => {
    for (const [id, labels] of Object.entries(NOT_SHOWN)) {
      const s = scenes.find((x) => x.id === id);
      expect(s, `coverage-exempt.ts: no scene ${id}`).toBeDefined();
      for (const [label, why] of Object.entries(labels)) expect(why.length, `${id} "${label}": give the reason`).toBeGreaterThan(10);
    }
  });
});
