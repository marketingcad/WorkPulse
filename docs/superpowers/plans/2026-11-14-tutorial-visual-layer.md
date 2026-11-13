# Tutorial Visual Layer Implementation Plan

**Goal:** Professional animated highlights, floating labels, concept illustrations, workflow diagrams, animated callouts and branded chapter transitions, all on the narration's words.

**Spec:** [2026-11-14-tutorial-visual-layer-design.md](../specs/2026-11-14-tutorial-visual-layer-design.md), extended by the user's brief of 2026-11-14:
- branded animated chapter transitions;
- connectors on labels and callouts;
- spotlight optional;
- the Walnut / Vidocu / Sentry-style references, for look only.

**Architecture (from the code as it is):**
- `render.ts` `scene()` builds an ffmpeg graph: retimed footage `[rt]`, then `zoompan`, then `drawtext` callouts, then fades.
- Chapter cards are `card()`: ffmpeg `drawtext` on a flat colour.
- The visual layer adds one pure planner and one element renderer:
  - **Planner:** `visuals/plan.ts` builds timed elements per scene, from markers, word times and the retime plan.
  - **Element renderer:** `visuals/render-elements.ts` draws each element as a small transparent clip. It uses an HTML page (`visuals/overlay.html`) in the Chromium that Playwright already provides: Web Animations API, clock stepped frame by frame, `page.screenshot({ clip, omitBackground })`, frames piped into ffmpeg as a PNG-in-MOV with alpha.
  - **Caching:** each clip is cached by a hash of its spec and the page. A clip's position is not part of its spec, so identical elements are drawn once.
- **Compositing:**
  - pointing clips (ring, label) are laid over `[rt]` before the zoom, so they zoom with the picture;
  - fixed clips (callout, card, scene tag) are laid over after the zoom;
  - each uses `overlay=x:y:enable='between(t,a,b)':eof_action=pass` with `setpts` offsets.
- **Chapter cards:** become a full-frame animated clip (kind `chapter`) from the same page.

## Global constraints (from the brief)

- No new npm dependencies, no app changes, everything in `e2e/tutorial`.
- Brand: indigo `#4B4FC4`, Segoe UI.
- Motion:
  - entrances 200–350 ms ease-out, exits about 200 ms;
  - rings hold up to 1.5 s and end at the next click, scroll or navigation;
  - labels 1.5–2 s, callouts about 3.5 s, cards about 3.5 s.
- At most one ring, one label, one card and one callout at a time; a newer one ends the older.
- Cards take the corner farthest from the active ring.
- Output stays 1920 × 1080, 30 fps; each chapter file under 50 MB.
- Unchanged elements reuse their cached clip.
- Spotlight is not in this pass (the brief makes it optional; it would mean full-frame overlays).

## Tasks

1. **Kit: target boxes and interaction markers.**
   - `anchor()` records `target` (the box, separate from `box`, so zooms are unchanged) for point, click and type.
   - `d.click` with `on` dwells 0.9 s on the target before clicking.
   - `go`, `scroll` and `scrollTo` push `interaction` markers, which end rings.
   - Covered by the tests in task 2 and by typecheck.
2. **`visuals/concepts.ts` and `visuals/plan.ts`, test-first (`test/visuals-plan.test.ts`):**
   - rings at anchor shown times with `target`/`box`, ending at the next interaction or a click;
   - labels from coverage mentions;
   - step numbers only for `visuals.steps`;
   - callouts at the narration window that best matches their words;
   - cards from triggers, with per-scene `add`/`off`, in the far corner;
   - the scene tag for the first 3.5 s;
   - one at a time per kind.
   - Workflow-card nodes are timed to their words when spoken.
   - `Scene.visuals?: { steps?: boolean; add?: …; off?: … }` in `scenes.ts`.
3. **`visuals/overlay.html` and `visuals/render-elements.ts`:**
   - ring (glow and pulse, step number), label (glass chip and pointer), callout (slide-in, accent connector), cards (SVG drawings for os, phone-qr, flow, invoice, payroll, ai, offline-sync, money), scene tag, chapter transition;
   - one shared browser;
   - clips cached in `.tmp/tutorial-render/visuals/`.
   - Checked by rendering every kind once and looking at the frames.
4. **`render.ts`:**
   - scene graph with the pointing layer before the zoom and the fixed layer after it;
   - the old `drawtext` callouts removed;
   - animated chapter transitions;
   - `TUTORIAL_VISUALS=off` renders as before.
5. **Scripts:** `visuals.steps` on the step-by-step scenes; card `add`/`off` where the keywords miss or misfire (from a unit test that lists every card each scene triggers).
6. **Verify:**
   - re-record (targets);
   - render a preview of representative scenes and inspect frames;
   - full render, then re-render to prove cache reuse, timing both;
   - `tutorial:test`, typecheck, gates.
