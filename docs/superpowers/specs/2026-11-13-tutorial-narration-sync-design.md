# Tutorial video, Part 1: narration-synced timing

Date: 2026-11-13 · Status: draft for review · Scope: `e2e/tutorial` (developer tooling, no product change)

## Where this fits

The request is to turn the tutorial generator into a narration-driven production system: visuals that appear exactly when the narrator names them, a scene plan, motion graphics, a preview editor and a QA pass. That is four sub-projects, built in this order, each with its own spec:

1. **Timing foundation (this spec).** Word-level timing of the voice, a timeline per scene, footage retimed so marked moments land on the words that name them, exact captions.
2. **Scene planner.** Finds keywords and concepts in the narration and writes an editable, committed plan: which visual goes with which words, which animation, which transition. AI proposes, a person edits.
3. **Motion-graphics layer.** Callouts, arrows, highlights, step animations and stylized OS visuals (no third-party logos or real screenshots), in one consistent style, driven by the timeline.
4. **Preview editor and QA.** A local page that plays a scene with its voice and overlays, edits timings and captions, re-renders one scene, and runs the checks before export.

Parts 2–4 all read the timeline this part produces. Without word timing, none of them can be "on the word".

## Problem

Today (`render.ts`, `kit.ts`):

- The voice is one audio file per scene; nothing knows when each word is spoken.
- A recording's `d.mark()` stores when the *presenter* did something, not when the *narrator* says it. The renderer plays the footage at one speed for the whole scene (1× to 1.5×) and holds the last frame, so a zoom on "the Approve button" can come seconds before or after those words.
- Captions are spread over the scene in proportion to word count (`timedCues`), so they drift within a scene.
- Callouts are spaced evenly across the scene, unrelated to the words.

## Goal and success criteria

- Every anchored moment in a scene appears within **±150 ms** of the first anchor word being spoken (target), or the render reports why not.
- Caption cues start on their first word and end on their last word (within ±100 ms), never overlap, and stay on screen at least 1 s.
- Scenes without anchors render exactly as today (same speed rule, same output), so existing chapters keep working while anchors are added.
- A re-render with nothing changed does no alignment or encoding work (cache).
- No new npm dependency. The aligner is a downloaded tool in `e2e/.tmp`, like Piper.

Out of scope here: choosing visuals, new overlay types, the editor UI, the QA report beyond sync drift (Parts 2–4). Updating the tutorial's content for the features shipped since 2026-11-06 is separate work that will use this.

## Design

### 1. Word timing (`tutorial/timing/align.ts`)

For each scene's voice file, produce word timings `{ word, start, end }[]` for the narration as written.

- **Default: whisper.cpp forced to the script.** On first use, download the Windows build of whisper.cpp and the `base.en` model (~150 MB) into `e2e/.tmp/whisper`, as `piper()` does for Piper. Run it on the voice WAV with word-level output (one segment per word, DTW token timestamps). Recognized words will differ from the script in places (numbers, names, "WorkPulse"), so **match recognized words to the script's words** with a word-level edit-distance alignment on normalized tokens (lower case, no punctuation, digits and number words treated as equal). Matched script words take the recognized times; unmatched words get times interpolated between their matched neighbours.
- **ElevenLabs:** when `TUTORIAL_TTS=elevenlabs`, call its `with-timestamps` endpoint instead and build word times from the character times it returns. No Whisper run.
- **Fallback:** if the aligner can't run, or fewer than 80% of script words match, use the current proportional estimate for that scene and print a warning naming the scene. `TUTORIAL_ALIGN=off` forces the fallback everywhere (for a quick render).
- The text aligned is `spoken(narration)`, the same text the voice read, mapped back to the narration's words so anchors and captions use the script's spelling.
- **Cache:** `e2e/.tmp/tutorial-render/align/<scene>.<hash of voice file + aligner version>.json`.

### 2. Anchors in recordings (`kit.ts`)

A recording ties a moment to the words that name it:

```ts
await d.mark('zoom to the timer card', timer, { on: 'the timer' });
await d.click(approve, { on: 'Approve' });          // the anchor is the instant of the click
await d.cue('the Coffee break', { nth: 2 });        // timing only, nothing drawn
```

- `on` is a phrase from the scene's narration; `nth` picks a later occurrence (default 1). The kit checks at record time that the phrase occurs in the narration and fails the recording with a clear message if not, so a typo can't silently desync a scene.
- `click`, `type`, `point` and `scrollTo` accept `{ on }`. The anchor is taken just before the action (when the cursor arrives), which is the moment the viewer should see it.
- Markers are stored as today in `<clip>.markers.json`, with `on` and `nth` added. Old marker files without them stay valid.

### 3. Retiming the footage (`tutorial/timing/retime.ts`, used by `render.ts`)

Given the scene's anchors (clip time `c_i`) and the times their words are spoken (`v_i = LEAD + start of the anchor's first word`), build a piecewise time map from clip time to video time:

- Anchors are sorted by clip time; if two would map out of order (the narration names B before A but the recording did A first), the later one is dropped from retiming and reported.
- Between consecutive anchors, if the footage is **longer** than the voice gap, play it faster, up to 1.5× (the current `MAX_SPEED`). If it is still too long, the anchor lands late and its drift is reported.
- If the footage is **shorter**, play it at 1× and **hold the last frame before the anchor** (the presenter waits, the cursor resting on the target) until the word arrives. No slow motion.
- Before the first anchor and after the last one, the current whole-scene rule applies; the scene still lasts at least `LEAD + speech + TAIL`.
- Rendered in the existing ffmpeg filtergraph: the trimmed clip is split with `trim`/`setpts` per piece, holds use `tpad=stop_mode=clone`, the pieces are joined with `concat`, then the existing `zoompan` and callouts run on the result. Zoom marker times are mapped through the same time map, so zooms move with their anchors.
- A scene with no anchors gets a single piece, which is today's behaviour.

### 4. The timeline (`tutorial/timing/timeline.ts`)

Each scene's render writes `e2e/.tmp/tutorial-render/timeline/<scene>.json`, and the final render writes `e2e/tutorial/video/timeline.json` (git-ignored) with every scene placed at its real start in the full video:

```jsonc
{
  "scene": "07.3", "start": 312.4, "seconds": 41.2,
  "voice": { "start": 0.4, "seconds": 39.0, "aligner": "whisper" },   // or "elevenlabs" | "estimate"
  "words": [{ "word": "Click", "start": 0.42, "end": 0.71 }],
  "anchors": [{ "label": "zoom to the timer card", "on": "the timer", "wordAt": 6.10, "shownAt": 6.14, "driftMs": 40 }],
  "pieces": [{ "from": 0, "to": 5.2, "speed": 1.25, "holdAfter": 0.8 }],
  "captions": [{ "start": 0.42, "end": 3.10, "text": "Click Clock in to start\nyour day." }]
}
```

This is the contract Parts 2–4 build on (the planner adds visuals to anchors and words; the editor reads and edits it; QA checks it). Times are seconds from the scene's start, plus `start` for the whole video.

### 5. Captions from real word times (`format.ts`)

Keep `cues()` (the 2 × 42-character splitting). Add `wordCues(words, cues)`: each cue starts at its first word's start and ends at its last word's end plus up to 0.3 s, clipped before the next cue, minimum 1 s. The SRT and the Help Center's WebVTT both use it. `timedCues` stays as the estimate fallback and for `build-package.ts` planned timings.

### 6. Sync report

At the end of a render, print one line per scene with anchors that missed: `07.3 "the timer": 620 ms late (footage too long between anchors 2 and 3)`. Also write `video/sync-report.json`. The render doesn't fail on drift (Part 4's QA decides that). It does fail on a missing anchor phrase.

### 7. Adding anchors to the existing recordings

There are 107 `d.mark` calls across the 18 recording files. As part of this work, give each one an `on` phrase where its narration names the thing being shown. Where no phrase fits, leave it unanchored; it then keeps today's timing. This is what makes the change visible in the current video.

## Error handling

- Aligner download or run fails: warn, use the estimate for that scene, continue the render. The timeline records `"aligner": "estimate"`.
- Anchor phrase not in narration: fails at record time (kit), and again at render time if the narration changed after recording, naming the scene and phrase.
- Out-of-order or unreachable anchors: rendered as well as possible, reported with their drift.

## Testing

Pure logic goes into small modules with Vitest tests in `e2e/tutorial/test/` (a `test` folder under `e2e/tutorial`, added to `VITEST_DIRS` in `scripts/quality-gates.mjs` and to Gate 2 in `quality-gates.json`, with a `test:unit` script in the e2e package):

- `align`: matching recognized words to the script (substitutions, missing and extra words, numbers, "WorkPulse"), interpolation of unmatched words, the 80% fallback threshold.
- `retime`: footage longer and shorter than the voice, the 1.5× cap and reported drift, holds, out-of-order anchors, no anchors giving today's single piece, marker times mapped through the map.
- `anchors`: phrase lookup with `nth`, case and punctuation, `›` and `→` as the voice reads them, the error for a missing phrase.
- `wordCues`: cue boundaries, no overlap, minimum length.

Manual check, reported with the results: record and render two scenes with anchors (one desktop, one web), check `sync-report.json` and frames at the anchor times with `inspect-clip.mjs`, and watch them. Then `pnpm --filter @tallywork/e2e typecheck` and the unit tests. No Playwright E2E spec is added, because nothing in the app changes.

## Decisions taken (change any of them)

| Decision | Chosen | Alternative |
|---|---|---|
| Word timing | whisper.cpp `base.en`, local, cached; ElevenLabs timestamps when that voice is used | Syllable estimate (drifts); provider timestamps only (forces a paid voice) |
| Footage shorter than the words | Hold the frame before the anchor | Slow motion (looks wrong for UI footage) |
| Speed-up cap | 1.5×, as today | Higher, which reads as fast-forward |
| Drift target | ±150 ms reported, not fatal | Fail the render (belongs to Part 4's QA) |
| Where the timeline lives | Git-ignored render output | Committed (it changes on every render) |
