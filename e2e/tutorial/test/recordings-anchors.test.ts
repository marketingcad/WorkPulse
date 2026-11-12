import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorWords } from '../timing/anchors';
import { sceneById } from '../scenes';

/**
 * Every `on: '…'` anchor in the recordings must be said in its scene's narration. The recording and
 * the render check this too, but only when they run; this catches a narration edit straight away.
 */
const dir = path.join(import.meta.dirname, '..', 'recordings');
const anchors = readdirSync(dir)
  .filter((f) => f.endsWith('.rec.ts'))
  .flatMap((file) => {
    const source = readFileSync(path.join(dir, file), 'utf8');
    // Each test('NN.N', …) block runs to the next one.
    const blocks = [...source.matchAll(/test\('([\d.]+)'/g)].map((m, i, all) => ({ id: m[1]!, body: source.slice(m.index, all[i + 1]?.index) }));
    return blocks.flatMap(({ id, body }) =>
      [...body.matchAll(/\bon: '([^']+)'(?:, nth: (\d+))?/g)].map((m) => ({ file, id, on: m[1]!, nth: Number(m[2] ?? 1) })),
    );
  });

describe('anchors in the recordings', () => {
  it('anchors most recorded moments', () => {
    expect(anchors.length).toBeGreaterThanOrEqual(80);
  });

  it.each(anchors.map((a) => [`${a.file} ${a.id} "${a.on}"${a.nth > 1 ? ` (${a.nth})` : ''}`, a] as const))('%s is in the narration', (_, a) => {
    expect(() => anchorWords(sceneById(a.id), a.on, a.nth)).not.toThrow();
  });
});
