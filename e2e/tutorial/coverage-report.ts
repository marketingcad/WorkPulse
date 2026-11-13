/**
 * Prints, for every scene, the labels its narration names that the recording does not show as they
 * are said, and any anchors written out of narration order (the renderer drops those).
 * Run from e2e/: node ../node_modules/tsx/dist/cli.mjs tutorial/coverage-report.ts [scene id prefix …]
 */
import { CHAPTERS } from './scenes';
import { NOT_SHOWN } from './coverage-exempt';
import { anchorWords } from './timing/anchors';
import { coverage } from './timing/coverage';
import { recordingAnchors } from './timing/recording-anchors';

const only = process.argv.slice(2);
const anchors = recordingAnchors();
let shown = 0;
let missing = 0;
for (const c of CHAPTERS)
  for (const s of c.scenes) {
    if (s.app === 'edit' || (only.length && !only.some((p) => s.id.startsWith(p)))) continue;
    const list = anchors.get(s.id) ?? [];
    const r = coverage(s, list, Object.keys(NOT_SHOWN[s.id] ?? {}));
    shown += r.covered.length;
    missing += r.missing.length;
    if (r.missing.length) console.log(`${s.id}: not shown: ${r.missing.map((m) => m.label).join(' | ')}`);
    // Anchors are written in recording order; their words must not go back in the narration.
    let last = -1;
    for (const a of list) {
      let at: number;
      try {
        at = anchorWords(s, a.on, a.nth).first;
      } catch {
        console.log(`${s.id}: "${a.on}" is not in the narration`);
        continue;
      }
      if (at < last) console.log(`${s.id}: "${a.on}" comes earlier in the narration than the anchor before it (it would be dropped)`);
      last = Math.max(last, at);
    }
  }
console.log(`\n${shown} of ${shown + missing} named labels are shown as they are said; ${missing} are not.`);
