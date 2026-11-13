# Tutorial video, Part 3: animated visual layer

Date: 2026-11-14 · Status: draft for review · Scope: `e2e/tutorial` only (render pipeline, recording kit, chapter scripts). No app code.

## Intent

The tutorial video (Help Center, system admins) now shows every on-screen item the voiceover names, on its words (Parts 1 and the content refresh). The picture is still plain: a cursor, zooms and a few text boxes. The user wants additional animation and visual elements during the voiceover, so the video feels professionally produced and is easier to follow, including for things the screen cannot show.

## Decisions taken with the user

- Build approach **A**: graphics are HTML/CSS animations rendered in the headless browser already used for recording, captured as transparent frames and laid over the screen recording by ffmpeg. No new dependency.
- The six elements below, all of them.

## Goals

1. **Highlight ring.** An animated outline around the item at the moment its words are spoken.
2. **Name label.** A small tag with the item's name next to it, while spoken.
3. **Step numbers.** Numbered badges (1, 2, 3) on the steps of a scene that walks through steps.
4. **Animated callouts.** The scene's callouts (the quoted text of its `overlays`) slide in when their topic is spoken, replacing today's evenly spaced boxes.
5. **Concept cards.** Stylized illustrations for things the screen cannot show, appearing on their words: Windows, macOS and Linux; a phone with a QR code (two-factor); the flow Time → Approval → Invoices & Payroll; money, invoice and AI-sparkle icons where they fit.
6. **Chapter label.** A small "Chapter N · Scene title" tag in a corner, in WorkPulse colours.

Everything appears on the words it belongs to, using the timing from Part 1 (`timeline.json`: word times, anchors, retimed footage).

## Non-goals

- Changing the app, the narration's meaning, or what the recordings do.
- Real third-party logos or screenshots of other products. The OS and phone visuals are stylized drawings.
- An editor or preview UI, or AI scene planning (Parts 2 and 4).
- Burned-in subtitles (captions stay a separate file).

## Anti-goals (would make this a failure even if it works)

- Clutter: more than one ring, one label and one concept card on screen at a time, or graphics covering the thing being explained.
- Visuals that don't match the words: a ring on the wrong element, or a card for a concept the narration doesn't name at that moment.
- Off-brand or unreadable graphics: inconsistent colours or fonts, small text, motion that is jumpy or long.
- A render that becomes much slower to re-run: unchanged scenes must reuse their cached overlay.

## Constraints

- Brand: WorkPulse indigo (`#4B4FC4`, as used for the cursor ripple and thumbnail), the app's fonts (Segoe UI on the render machine, as `render.ts` uses), white text on dark chips; accessible contrast.
- Motion: entrances 200–350 ms with ease-out, exits 200 ms, nothing loops more than twice; rings hold about 1.5 s, labels about 2 s, cards about 3 s or until the next card.
- Coordinates: item boxes are recorded in video pixels (1920 × 1080). Graphics that point at an item are composited **before** the zoom, so they zoom with the picture and stay on the item. Callouts, concept cards and the chapter label are composited **after** the zoom, so they stay a fixed size.
- Items move if the page scrolls after they are named: rings and labels last at most about 1.5–2 s and end early if a scroll or page change follows (the recording knows those moments).
- No new npm dependencies. Playwright (Chromium) renders the overlay frames; ffmpeg composites.
- Every chapter file stays under 50 MB; the full render may take longer the first time, but a re-render with nothing changed reuses every cached overlay.

## Approaches considered

- **A. HTML/CSS in the headless browser, composited by ffmpeg (chosen).** Smooth animation, brand-consistent, reuses Playwright and ffmpeg. Costs extra render time for the frames, cached per scene.
- **B. Remotion.** Very capable React video framework, but a heavy new dependency with a paid company licence. Rejected.
- **C. ffmpeg filters only.** No new parts, but crude motion and no real arrows or diagrams. Rejected.

## Design

### 1. Where items are: boxes for every anchor (`kit.ts`)

Today only `d.mark` stores the item's box, and every marker with a `box` drives a zoom. Anchored clicks, points, typing and scrolls (`anchor()` in the kit) store the box of their target in a **separate field, `target`**, in video pixels, so zooms stay exactly as they are (designer's call: zooming on every action would itself be clutter). They also note when the ring must end: the moment of a click, a scroll or a navigation that follows. Old marker files without `target` still render (no ring for those). This needs one full re-record.

**Rings on clicks (designer's call).** The anchor is noted when the cursor arrives, and the click follows. So that the ring is seen on its words, `d.click` waits about 0.9 s with the cursor on the target before clicking when it has an `on` anchor (today 0.2 s), like a presenter showing the button. The ring ends with the click, pressing in with the click ripple. Any click ends the ring, including one that opens a dialog or menu. The retiming is unchanged; the extra time is in the recording.

### 2. The visual plan per scene (`tutorial/visuals/plan.ts`, pure, unit-tested)

From a scene's script, its markers, its word times and its retime plan, build a list of timed visual elements in video time (seconds from the scene's start):

- **ring** + **label** for each anchor with a box: at the anchor's shown time; label text is the mention's label (Part 1 coverage gives labels for anchors that cover a mention), otherwise none.
- **step** numbers only for scenes the script marks `visuals: { steps: true }` (designer's call: a heuristic would number about 28 scenes that are not step-by-step). The number is drawn inside that step's ring, one at a time, numbered in order of the scene's click anchors, so steps add no clutter of their own.
- **callout** for each quoted overlay text: at the first anchor or word whose text shares the callout's key words; otherwise spread evenly as today.
- **card** from a small keyword dictionary (`tutorial/visuals/concepts.ts`): a phrase in the narration (e.g. "Windows, macOS or Linux", "QR code", "invoices and payroll") triggers its card on those words. A chapter script can add a card to a scene or turn one off (`visuals?: { add?: …; off?: …; steps?: boolean }` on the scene), so the dictionary never forces a wrong card.
- **chapter** label for the whole scene.

Rules enforce the anti-goals: at most one of each kind at a time (a newer one replaces the older), no ring when the anchor has no box, cards never cover the item being ringed (they take the corner farthest from it).

### 3. Rendering the overlay (`tutorial/visuals/overlay.html` + `tutorial/visuals/render-overlay.ts`)

- One HTML page draws all element kinds, from a plan passed in. Animations use the Web Animations API with their clock set from outside, so any frame can be drawn exactly.
- For each scene, Chromium steps through the plan at 30 fps **only where an element is visible** and screenshots each frame with a transparent background. Frames are encoded into two short transparent clips per scene: one for the pointing layer (before the zoom) and one for the fixed layer (after it), with their start times.
- Cached by a hash of the plan and the overlay page, so unchanged scenes are not redrawn.

### 4. Compositing (`render.ts`)

The scene filter becomes: retimed picture → overlay the pointing layer → zoom → overlay the fixed layer → fades. The old even-spaced `drawtext` callouts are removed (the callout element replaces them). Title, chapter and end cards stay as they are.

### 5. The concept cards (`tutorial/visuals/concepts.ts`)

A small set to start, each a stylized SVG + short caption, in brand colours:
- `os`: three device outlines labelled Windows, macOS, Linux (no real logos).
- `phone-qr`: a phone with a QR code and a six-digit code.
- `flow`: Time → Approval → Invoices & Payroll, drawing itself left to right.
- `invoice`, `payroll`, `ai`: an invoice sheet, a pay stub, a sparkle mark.
- `offline-sync`: a laptop with a cloud reconnecting.

Triggers are listed with the card. Adding a card later is adding an entry.

## Verification

- Unit tests (Vitest, Gate 2) for the plan: rings at anchor times with their boxes; labels from mentions; step numbering; callout timing; card triggers and per-scene add/off; the one-at-a-time and don't-cover rules; scenes without boxes or anchors.
- Unit test for the overlay page: given a plan and a time, the expected elements are visible (run in Chromium via Playwright's test runner, not the recording config).
- Re-record all scenes once (boxes for every anchor), render, and check frames at a sample of rings, labels, steps, callouts and every concept card.
- Render time and file sizes reported; a second render with nothing changed reuses every overlay.
- `tutorial:test`, `typecheck`, quality gates.

## Left to the builder

- Exact visual styling within the constraints (shadows, radius, icon drawings), kept consistent.
- The keyword phrases for each concept card, checked against the narration so each fires where it should.
- Frame encoding format for transparent clips (for example PNG sequence to `qtrle` or VP9 with alpha), chosen for ffmpeg compatibility and speed.
