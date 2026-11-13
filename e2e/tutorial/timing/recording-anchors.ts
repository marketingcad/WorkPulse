/**
 * The anchors written in the recordings (`{ on: '…' }`, `d.cue('…')`), by scene id, read from the
 * source so the checks run without recording anything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface SourceAnchor {
  file: string;
  on: string;
  nth: number;
}

const DIR = path.join(import.meta.dirname, '..', 'recordings');

export function recordingAnchors(dir = DIR): Map<string, SourceAnchor[]> {
  const out = new Map<string, SourceAnchor[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.rec.ts'))) {
    const source = readFileSync(path.join(dir, file), 'utf8');
    // Each test('NN.N', …) block runs to the next one.
    const blocks = [...source.matchAll(/test\('([\d.]+)'/g)].map((m, i, all) => ({ id: m[1]!, body: source.slice(m.index, all[i + 1]?.index) }));
    for (const { id, body } of blocks) {
      const anchors = [
        ...[...body.matchAll(/\bon: '([^']+)'(?:, nth: (\d+))?/g)].map((m) => ({ file, on: m[1]!, nth: Number(m[2] ?? 1) })),
        ...[...body.matchAll(/\bd\.cue\('([^']+)'(?:, \{ nth: (\d+) \})?/g)].map((m) => ({ file, on: m[1]!, nth: Number(m[2] ?? 1) })),
      ];
      out.set(id, [...(out.get(id) ?? []), ...anchors]);
    }
  }
  return out;
}
