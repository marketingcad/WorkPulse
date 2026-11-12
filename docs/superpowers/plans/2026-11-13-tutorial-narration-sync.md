# Tutorial Narration Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every marked moment of the tutorial video, and every caption, land on the words the narrator speaks.

**Architecture:** Pure timing logic lives in a new `e2e/tutorial/timing/` folder (types, anchor lookup, word alignment, retiming, timeline/report), unit-tested with Vitest. Two I/O pieces wrap it: `timing/voice-timing.ts` (whisper.cpp or ElevenLabs timestamps, cached, with an estimate fallback) and the existing `render.ts`, which retimes each clip through a piecewise ffmpeg filtergraph and writes the timeline. `kit.ts` records anchors (`{ on, nth }`) and checks them against the narration.

**Tech Stack:** TypeScript (ESM, run with tsx), Playwright (recordings), ffmpeg, whisper.cpp (downloaded binary), Vitest (root dev dependency).

**Spec:** [docs/superpowers/specs/2026-11-13-tutorial-narration-sync-design.md](../specs/2026-11-13-tutorial-narration-sync-design.md)

**Branch:** work in a worktree on `feat/tutorial-narration-sync` from `main` (the main checkout has unrelated uncommitted work). Commit the spec there first.

## Global Constraints

- No new npm dependency. Vitest and tsx are used from the root `node_modules`, as `tutorial:*` already does with tsx.
- whisper.cpp and its `base.en` model download into `e2e/.tmp/whisper` on first use (Windows only, like Piper); elsewhere the aligner falls back to the estimate with a warning.
- Anchor target: within **±150 ms** of the anchor's first word; drift beyond that is reported, never fatal.
- Speed-up cap stays `MAX_SPEED = 1.5`. Footage shorter than the words is held on the frame before the anchor; never slowed.
- Captions: start on the first word, end at last word + up to 0.3 s, clipped 0.05 s before the next cue, at least 1 s long; when "at least 1 s" and "no overlap" conflict, no overlap wins.
- Alignment falls back to the estimate when fewer than **80%** of script words match, when the aligner fails, or when `TUTORIAL_ALIGN=off`.
- A scene with no anchors renders with exactly today's filter chain and length.
- A missing anchor phrase fails the recording (kit) and the render.
- Outputs `video/timeline.json` and `video/sync-report.json` are git-ignored (the `video/` folder already is). Cache: `e2e/.tmp/tutorial-render/align/<scene>.<hash>.json`, `ALIGN_VERSION = 1` in the hash.
- Code style follows `render.ts`/`kit.ts`: plain-English doc comments, no new abstractions beyond the files listed.

## Review Focus

1. **Narration edited after recording, so an anchor phrase no longer exists.** Expect a clear failure naming the scene and phrase, before any encoding: covered by the static recordings test (Task 7) and `anchorWords` (Task 1).
2. **Whisper hears the script differently** ("WorkPulse" as "work pulse", "sign-in" as "sign in", "$1,250" as words). Expect matched words to keep real times, the rest interpolated in order, never decreasing: Task 2 tests.
3. **Two anchors on the same word, or the narration naming B before the recording did A.** Expect equal word times to both land (the second without a hold), and a strictly earlier one to be dropped and reported as out of order: Task 4 tests.
4. **Narration with symbol tokens (`›`, `→`, `—`).** Expect anchors and captions to stay on the right words (the voice reads `→` as "to", `›` and `—` as pauses): Tasks 1 and 3 tests.
5. **A marker placed before `d.begin()` or after `d.finish()`.** Expect it ignored for retiming and zooms, as today: Task 4 test.

---

### Task 1: Timing types, anchor lookup and the unit-test harness

**Files:**
- Create: `e2e/tutorial/timing/types.ts`, `e2e/tutorial/timing/anchors.ts`
- Create: `e2e/tutorial/test/anchors.test.ts`, `e2e/tutorial/vitest.config.ts`
- Modify: `e2e/package.json` (script), `scripts/quality-gates.mjs:22` (`VITEST_DIRS`), `quality-gates.json` (Gate 2 vitest)

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface Box { x: number; y: number; width: number; height: number }
  export interface Marker { at: number; label: string; box?: Box; on?: string; nth?: number }
  export interface WordTime { word: string; start: number; end: number } // seconds from the voice file's start
  export type Aligner = 'whisper' | 'elevenlabs' | 'estimate';
  export interface Piece { from: number; to: number; speed: number; holdAfter: number } // clip seconds from the trimmed start
  export interface AnchorResult { label: string; on: string; wordAt: number; shownAt: number | null; driftMs: number | null; note?: 'out of order' | 'late' }
  export interface SceneTimeline {
    scene: string; start: number; seconds: number;
    voice: { start: number; seconds: number; aligner: Aligner };
    words: WordTime[]; anchors: AnchorResult[]; pieces: Piece[];
    captions: Array<{ start: number; end: number; text: string }>;
  }
  ```
- Produces (`anchors.ts`):
  - `normalize(token: string): string`: lower case; `→` becomes `to`; `&` becomes `and`; every other non-letter, non-digit character removed.
  - `scriptWords(narration: string): string[]`: the narration split on whitespace, keeping only tokens whose `normalize` is non-empty, as written. Index `i` here is "word `i`" everywhere else.
  - `anchorWords(scene: { id: string; narration: string }, on: string, nth = 1): { first: number; last: number }`: indices into `scriptWords` of the `nth` occurrence of the phrase (compared by `normalize` per word). Throws `Error(\`No "${on}" (occurrence ${nth}) in the narration of scene ${scene.id}\`)`.

- [ ] **Step 1: Set up the harness.** A config at `e2e/tutorial/vitest.config.ts` with `test.include = ['test/**/*.test.ts']`, `root` = that folder. Script in `e2e/package.json`: `"tutorial:test": "node ../node_modules/vitest/vitest.mjs run --config tutorial/vitest.config.ts"`. Add `'e2e/tutorial'` to `VITEST_DIRS` in `scripts/quality-gates.mjs` (it scans `<dir>/test`), and `"e2e/tutorial": ["anchors"]` to Gate 2's `vitest` map (each later task adds its own test name) in `quality-gates.json`. Check how `quality-gates.mjs run` invokes Vitest per package; if it runs `pnpm --filter <pkg> test`, map `e2e/tutorial` to `pnpm --filter @tallywork/e2e tutorial:test` there.

- [ ] **Step 2: Write the failing tests** in `test/anchors.test.ts`:
  ```ts
  const scene = { id: '09.2', narration: 'Open Time › Approvals. Click Approve → the entry is locked. Click Approve again.' };
  expect(scriptWords(scene.narration)).toEqual(['Open', 'Time', 'Approvals.', 'Click', 'Approve', '→', 'the', 'entry', 'is', 'locked.', 'Click', 'Approve', 'again.']);
  expect(anchorWords(scene, 'Approvals')).toEqual({ first: 2, last: 2 });
  expect(anchorWords(scene, 'click approve')).toEqual({ first: 3, last: 4 });
  expect(anchorWords(scene, 'Click Approve', 2)).toEqual({ first: 10, last: 11 });
  expect(anchorWords(scene, 'approve to the entry')).toEqual({ first: 4, last: 7 });
  expect(() => anchorWords(scene, 'Reject')).toThrow('No "Reject" (occurrence 1) in the narration of scene 09.2');
  expect(() => anchorWords(scene, 'Click Approve', 3)).toThrow('occurrence 3');
  ```

- [ ] **Step 3: Run** `pnpm --filter @tallywork/e2e tutorial:test`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement** `types.ts` and `anchors.ts` with the signatures above.

- [ ] **Step 5: Run** the tests and `node scripts/quality-gates.mjs check`. Expected: tests PASS and the gate check passes.

- [ ] **Step 6: Commit** `feat(tutorial): timing types, anchor lookup and unit-test harness`.

### Task 2: Aligning recognized words to the script

**Files:**
- Create: `e2e/tutorial/timing/align.ts`, `e2e/tutorial/test/align.test.ts`

**Interfaces:**
- Consumes: `normalize`, `scriptWords` (Task 1); `WordTime`.
- Produces:
  - `alignToScript(narration: string, heard: WordTime[], voiceSeconds: number): { words: WordTime[]; ratio: number }`: one `WordTime` per `scriptWords(narration)` entry, `word` = the script's text; `ratio` = matched script words ÷ script words.
  - `estimateWords(narration: string, voiceSeconds: number, lead = 0): WordTime[]`: today's proportional estimate per word (by character length of the normalized word plus one), between `lead` and `voiceSeconds`.
  - `MIN_MATCH = 0.8`.

- [ ] **Step 1: Write the failing tests** (`heard` built with a helper `w(word, start, end)`):
  - Exact: script "Click Approve now" with heard words at 0.1/0.5/0.9 → same times, `ratio` 1.
  - Substitution and interpolation: script "Open the Payroll page", heard "open the payrolls page" → `Payroll` (unmatched) gets a time between `the.end` and `page.start`; times never decrease; `ratio` 0.75.
  - Split compound: script "Welcome to WorkPulse." with heard "welcome to work pulse" → `WorkPulse.` starts at `work.start` and ends at `pulse.end`, `ratio` 1.
  - Merged compound: script "Click sign in" with heard "click signin" → `sign` and `in` share `signin`'s span, split by length, `ratio` 1.
  - Numbers: script "Pick 3 projects", heard "pick three projects" → `ratio` 1.
  - Missing at the edges: heard empty → `ratio` 0 and words spread evenly over `[0, voiceSeconds]`, never decreasing.
  - `estimateWords('one two', 2)`: two words covering `[0, 2]`, first ends where second starts.

- [ ] **Step 2: Run** `pnpm --filter @tallywork/e2e tutorial:test align`. Expected: FAIL.

- [ ] **Step 3: Implement** `alignToScript`. The algorithm the tests don't fully fix: a minimum-edit-distance alignment (DP table, cost 0 for a match, 1 for substitution, insertion and deletion) between normalized script words and normalized heard words, where a match is: equal strings; equal after mapping number words `zero…twenty, thirty, forty, fifty, sixty, seventy, eighty, ninety, hundred` to digits; or, as extra 1-to-2 and 2-to-1 transitions at cost 0, one word equal to the concatenation of two neighbours on the other side. Backtrack to pairs; a 1-to-2 match takes the span of both heard words; a 2-to-1 match splits the heard span by normalized length. Substituted or deleted script words are unmatched: fill each run between matched neighbours (or 0 / `voiceSeconds` at the ends) by splitting the gap by normalized length.

- [ ] **Step 4: Run** the tests. Expected: PASS.

- [ ] **Step 5: Commit** `feat(tutorial): align recognized words to the script` (and add `align` to Gate 2).

### Task 3: Captions from word times

**Files:**
- Modify: `e2e/tutorial/format.ts` (add after `timedCues`)
- Create: `e2e/tutorial/test/captions.test.ts`

**Interfaces:**
- Consumes: `scriptWords`, `normalize` (Task 1), `WordTime`.
- Produces: `wordCues(narration: string, words: WordTime[], at: number): Array<[number, number, string]>`: same shape as `timedCues`; `words` are the scene's script words (from Task 2 or 5), times relative to the voice; `at` is added to every time.

- [ ] **Step 1: Write the failing tests:**
  - A two-cue narration: cue 1 starts at `at + words[0].start`; ends at `last.end + 0.3` when the next cue starts later than that, else `next.start - 0.05`.
  - A one-word cue spoken in 0.2 s with no next cue lasts 1 s; with the next cue 0.5 s later it ends 0.05 s before it (no overlap wins).
  - Symbols: narration "Open Time › Approvals → the list." keeps its cue text unchanged and uses the times of `Open` and `list.` (the `›` takes no word slot).
  - Same cue text as `cues()` for every chapter's narration in `CHAPTERS` (import `../scenes`), with `estimateWords` times: the cue count equals `cues(narration).length` and no cue's end exceeds the next cue's start.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement** `wordCues`: walk `cues(narration)`; for each cue count the tokens of its text with a non-empty `normalize` to find its first and last word index; apply the timing rules from Global Constraints.

- [ ] **Step 4: Run** them. Expected: PASS.

- [ ] **Step 5: Commit** `feat(tutorial): captions timed to the spoken words` (and add `captions` to Gate 2).

### Task 4: Retiming plan and filtergraph

**Files:**
- Create: `e2e/tutorial/timing/retime.ts`, `e2e/tutorial/test/retime.test.ts`

**Interfaces:**
- Consumes: `Piece`, `AnchorResult` (Task 1).
- Produces:
  ```ts
  export interface RetimeInput {
    clip: number;        // trimmed footage length, seconds (scene end - scene start)
    target: number;      // LEAD + speech + TAIL
    maxSpeed: number;    // 1.5
    anchors: Array<{ label: string; on: string; clipAt: number; wordAt: number }>; // clipAt from the trimmed start; wordAt = LEAD + word start
  }
  export interface RetimePlan { pieces: Piece[]; length: number; anchors: AnchorResult[] }
  export function planRetime(input: RetimeInput): RetimePlan;
  export function mapTime(pieces: Piece[], clipT: number): number; // video seconds for a clip time
  export function retimeChain(pieces: Piece[], length: number): string; // the ffmpeg filter text from [0:v] to the label [rt]
  ```

- [ ] **Step 1: Write the failing tests:**
  - **No anchors equals today:** `clip 30, target 12` → one piece `{ from 0, to 30, speed 1.5, holdAfter 0 }`, `length 20`; `clip 8, target 12` → speed 1, `length 12`, `holdAfter 4`. The speed is `min(1.5, max(1, clip / (target + 1)))` and the length is `max(clip / speed, target)`, as in `render.ts` today. `retimeChain` for one piece returns `[0:v]setpts=(PTS-STARTPTS)/<speed>,fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=<length - clip/speed + 0.1>[rt]`.
  - **Footage short, so hold:** anchor at `clipAt 2, wordAt 5` in `clip 10, target 12` → piece 1 `{0→2, speed 1, holdAfter 3}`, anchor `shownAt 5, driftMs 0`.
  - **Footage long, so speed up within the cap:** `clipAt 6, wordAt 5` → piece 1 speed 1.2, no hold, drift 0.
  - **Too long even at 1.5×:** `clipAt 9, wordAt 3` → speed 1.5, `shownAt 6`, `driftMs 3000`, `note 'late'`.
  - **Equal word times:** two anchors with the same `wordAt` both get results; the second's piece runs at 1.5× with no hold.
  - **Out of order:** anchors (clip 2, word 8) then (clip 5, word 4) → the second is dropped from the pieces, `note 'out of order'`, `shownAt null`.
  - **Anchors outside the clip** (`clipAt < 0` or `> clip`) are ignored, with no result.
  - **`mapTime`:** a clip time at an anchor maps to the anchor's `shownAt` (after the hold); a time halfway through a 1.5× piece maps proportionally; times past the end map to `length` minus the final hold.
  - **Multi-piece `retimeChain`:** contains `split=N`, one `trim=start=a:end=b,setpts=(PTS-STARTPTS)/s` per piece, `tpad` only on pieces with a hold, and `concat=n=N:v=1:a=0[rt]`.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement.** The plan walk: sort anchors by `clipAt`; drop any with `wordAt` strictly less than the last kept one (`out of order`). Walk the boundaries `0, c1, …, cN, clip` keeping the video time `v`. For each gap to anchor `k`: `need = wordAt_k - v`, `footage = c_k - c_{k-1}`; `speed = need > 0 ? clamp(footage / need, 1, maxSpeed) : maxSpeed`; `hold = max(0, need - footage / speed)`; `v += footage / speed + hold`; `shownAt_k = v`; `driftMs = round((v - wordAt_k) * 1000)`; note `late` when it's over 150. The last gap (after the last anchor, or the whole clip when there are none) keeps today's rule so unanchored scenes don't change: `speed = target + 1 - v > 0 ? clamp(footage / (target + 1 - v), 1, maxSpeed) : maxSpeed`, `hold = max(0, target - (v + footage / speed))`, `length = v + footage / speed + hold`. Round times to milliseconds as `render.ts` `round()` does.

- [ ] **Step 4: Run** them. Expected: PASS.

- [ ] **Step 5: Commit** `feat(tutorial): retime footage to the narration` (and add `retime` to Gate 2).

### Task 5: Voice timing: whisper.cpp, ElevenLabs timestamps, cache and fallback

**Files:**
- Create: `e2e/tutorial/timing/voice-timing.ts`, `e2e/tutorial/test/voice-timing.test.ts` (parsers only)
- Modify: `e2e/tutorial/render.ts`, in `speakOnline` and `voices()`, so that ElevenLabs saves its alignment sidecar

**Interfaces:**
- Consumes: `alignToScript`, `estimateWords`, `MIN_MATCH` (Task 2).
- Produces:
  - `parseWhisper(json: unknown): WordTime[]`: from whisper-cli `-oj` output `{ transcription: [{ offsets: { from: ms, to: ms }, text }] }`; trims text, drops empty and bracketed (`[BLANK_AUDIO]`) items; seconds.
  - `charsToWords(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): WordTime[]`: words split on whitespace characters.
  - `wordTimes(scene: { id: string; narration: string }, voiceFile: string, o: { ffmpeg: string; voiceSeconds: number; work: string }): Promise<{ words: WordTime[]; aligner: Aligner; ratio: number }>`: uses `<voiceFile>.alignment.json` when present (ElevenLabs), else whisper; falls back to `estimateWords` (with a `console.warn` naming the scene and the reason) on failure, on `ratio < MIN_MATCH`, on a non-Windows platform, or when `TUTORIAL_ALIGN=off`. Cached at `<work>/align/<scene>.<sha256(voice bytes + ALIGN_VERSION).slice(0,12)>.json`.
  - `ALIGN_VERSION = 1`.

- [ ] **Step 1: Write the failing parser tests:** `parseWhisper` on a fixture with `[BLANK_AUDIO]`, `" Click"` (from 420 to 710 ms) and an empty item gives `[{ word: 'Click', start: 0.42, end: 0.71 }]`; `charsToWords` for `"Hi you"` with per-character times gives two words spanning their first-character start and last-character end.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement the parsers, then `wordTimes`.** Whisper on first use: download `https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip` into `e2e/.tmp/whisper`, unpack it with Windows `tar.exe` as `piper()` does, and locate `whisper-cli.exe` in the unpacked tree. Download the model `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` into the same folder. Check both URLs with `curl -sI` first; if the release asset has a different name, use the actual one and note it in the commit message. Each run converts the voice with `ffmpeg -y -i <voice> -ar 16000 -ac 1 <work>/align/<scene>.wav`, then runs `whisper-cli -m <model> -f <wav> -l en -ml 1 -sow -oj -of <work>/align/<scene> -np -dtw base.en`. Move the `download` helper and the `tar` unpacking from `render.ts` into `voice-timing.ts` and export them, so `render.ts`'s `piper()` reuses them. ElevenLabs: in `render.ts` `speakOnline`, when `TTS === 'elevenlabs'`, call `…/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128`, decode `audio_base64` as the MP3, and write `alignment` to `<out>.alignment.json` beside it. So `speakOnline` returns `{ audio: Buffer; alignment?: unknown }`, and `voices()` writes both.

- [ ] **Step 4: Run** the parser tests (PASS), then a smoke run of whisper alone. Add a guarded CLI entry to `voice-timing.ts` (`node ../node_modules/tsx/dist/cli.mjs tutorial/timing/voice-timing.ts <scene id> <voice file>`) that prints `aligner`, `ratio` and the first 5 words. Run it on one cached Piper voice from `e2e/.tmp/tutorial-render/voice/` (render one scene's voice first if the cache is empty). Expected: `aligner whisper`, `ratio` ≥ 0.9, and word starts that rise and fall within the file's length.

- [ ] **Step 5: Commit** `feat(tutorial): word timing from whisper.cpp or ElevenLabs, cached, with fallback` (and add `voice-timing` to Gate 2).

### Task 6: Anchors in the recording kit

**Files:**
- Modify: `e2e/tutorial/kit.ts`, in `Marker` (replace it with a re-export from `timing/types`), `mark`, `point`, `click`, `type`, `scrollTo`, and add `cue`

**Interfaces:**
- Consumes: `anchorWords` (Task 1), `Marker` (Task 1).
- Produces, all in `Director`:
  - `type Anchor = { on?: string; nth?: number }`
  - `mark(label: string, target?: Locator, anchor?: Anchor)`
  - `cue(on: string, opts?: { nth?: number })`: pushes `{ at, label: \`cue: ${on}\`, on, nth }`
  - `point(target, opts: { hold?: number } & Anchor)`, `click(target, opts: { settle?: boolean } & Anchor)`, `type(target, text, anchor?: Anchor)`, `scrollTo(target, anchor?: Anchor)`

- [ ] **Step 1: Implement.** Every method given `on` first calls `anchorWords(this.scene, on, nth)`, so a bad phrase throws before anything moves. It then pushes a marker `{ at: this.seconds(), label, on, nth }`:
  - `point`: once the cursor arrives;
  - `click` and `type`: after their `point`, before the click or typing;
  - `scrollTo`: before scrolling.

  The label for an action is `'<action>: <on>'`, for example `click: Approve`. Leave `nth` out of the marker when it's 1.

- [ ] **Step 2: Verify.** Run `pnpm --filter @tallywork/e2e typecheck` (expected: no errors), then run the existing tutorial unit tests (expected: PASS).

- [ ] **Step 3: Commit** `feat(tutorial): anchor recorded moments to narration words`.

### Task 7: Render integration: retime, captions, timeline, sync report, scene subset

**Files:**
- Create: `e2e/tutorial/timing/timeline.ts`, `e2e/tutorial/test/timeline.test.ts`
- Modify: `e2e/tutorial/render.ts`: `Marker` and `Box` become imports from `timing/types`, and `scene()`, `card()` (for read-over end scenes), `main()` (captions, timeline, report, subset) and `chapterFiles()` (VTT) change.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (`timeline.ts`):
  - `syncReport(scenes: SceneTimeline[]): { lines: string[]; json: { scene: string; anchors: AnchorResult[] }[] }`: only scenes with an anchor whose `driftMs > 150` or whose `note` is `out of order`. Line format: `07.3 "the timer": 620 ms late` or `07.3 "the timer": out of order (dropped)`.
  - `placeTimeline(scenes: SceneTimeline[], starts: number[]): SceneTimeline[]`: sets each `start`.
- `Segment` in `render.ts` gains `timeline?: SceneTimeline`.

- [ ] **Step 1: Write the failing `timeline` tests.** `syncReport` lists a 620 ms-late anchor and an out-of-order one in the formats above, and skips an anchor 140 ms late. `placeTimeline` sets the starts in order.

- [ ] **Step 2: Run** them. Expected: FAIL. Then implement `timeline.ts` and run again. Expected: PASS.

- [ ] **Step 3: Wire `scene()`.**
  1. Get the words: `const { words, aligner } = await wordTimes(s, voice, { ffmpeg: FFMPEG, voiceSeconds: speech, work: WORK })`.
  2. Build the anchors from the markers that have an `on` and lie within the scene's start and end: `clipAt = m.at - start`, `wordAt = LEAD + words[anchorWords(s, m.on, m.nth).first].start`.
  3. Run `planRetime({ clip: end - start, target: LEAD + speech + TAIL, maxSpeed: MAX_SPEED, anchors })`.
  4. The video chain starts with `retimeChain(plan.pieces, plan.length)` and continues from `[rt]` with the zooms, callouts and fades. Map the zoom markers with `mapTime(plan.pieces, m.at - start)` in place of `(m.at - start) / speed`.
  5. Use `length = plan.length`.
  6. Return `timeline`: `words`, the plan's anchors and pieces, and `captions` from `wordCues(s.narration, words, LEAD)`.

  Check that a scene with no `on` markers produces a filter file identical to before by comparing `seg/<id>.filter.txt` before and after for one scene. The encode cache should then skip it.

- [ ] **Step 4: Wire the outputs.**
  - **Captions:** the SRT in `main()` and the VTT in `chapterFiles()` use `wordCues(g.scene.narration, g.timeline.words, t + LEAD)` in place of `timedCues`. The read-over end scene builds its timeline the same way, with words only.
  - **Timeline:** write each scene's timeline to `WORK/timeline/<id>.json`, and `placeTimeline(...)` to `OUT/timeline.json`.
  - **Sync report:** print each `syncReport` line with a `[render] sync:` prefix and write `OUT/sync-report.json`.

- [ ] **Step 5: Add the scene subset.** `TUTORIAL_SCENES=07.3,09.2` renders only those scenes, with no cards, thumbnail or chapter files. It writes `OUT/preview.mp4`, `preview.en.srt`, `timeline.json` and `sync-report.json`, and the log line names the subset. Add this and the anchor syntax to the header comment of `render.ts`.

- [ ] **Step 6: Verify.** Run `pnpm --filter @tallywork/e2e typecheck` and `tutorial:test`. Expected: both pass.

- [ ] **Step 7: Commit** `feat(tutorial): render retimes scenes to their anchors and writes the timeline and sync report` (and add `timeline` to Gate 2).

### Task 8: Anchor the existing recordings, with a static check

**Files:**
- Modify: `e2e/tutorial/recordings/*.rec.ts` (the 107 `d.mark` calls)
- Create: `e2e/tutorial/test/recordings-anchors.test.ts`

**Interfaces:**
- Consumes: `anchorWords`, `sceneById` (`scenes.ts`).

- [ ] **Step 1: Write the static test.** It reads every `recordings/*.rec.ts`, splits it into `test('<id>', …)` blocks, finds each `on: '<phrase>'` (with an optional `, nth: <n>`) in a block, and asserts `anchorWords(sceneById(id), phrase, n)` doesn't throw. It fails with the file, the scene and the phrase. It also asserts that at least 80 anchors were found.

- [ ] **Step 2: Run it.** Expected: FAIL, because 0 anchors are found.

- [ ] **Step 3: Add the anchors.** For each `d.mark`, read the scene's narration in `script/chNN-*.ts` and pass the shortest phrase that names what the mark shows, for example `{ on: 'the timer' }` for "zoom to the timer card". Use `nth` when the phrase was said earlier in the scene for something else. Where the narration names nothing on screen at that point, leave the mark unanchored and add `// no anchor: <why>` above it. Don't change the narration, because that would change the voice. Don't change what the recordings do.

- [ ] **Step 4: Run** the static test and the typecheck. Expected: PASS, with at least 80 anchors.

- [ ] **Step 5: Commit** `feat(tutorial): anchor the recorded zooms and highlights to their words` (and add `recordings-anchors` to Gate 2).

### Task 9: End-to-end check, docs and final runs

**Files:**
- Modify: `e2e/tutorial/README.md` (word timing, anchors, `TUTORIAL_ALIGN`, `TUTORIAL_SCENES`, the timeline and sync report)

- [ ] **Step 1: Record two scenes.** Run `pnpm tutorial:record -g "07.3|09.2"` (the server starts itself on :3200 and needs ffmpeg). Expected: both pass, and their `.markers.json` files contain `on` entries.

- [ ] **Step 2: Render them.** Run `TUTORIAL_SCENES=07.3,09.2 pnpm tutorial:render`. Expected:
  - `preview.mp4` and `timeline.json`, with `aligner: "whisper"` for both scenes;
  - `sync-report.json` lists no anchor over 150 ms, or each that is over has a reason in its line.

- [ ] **Step 3: Check the frames.** Run `node e2e/tutorial/inspect-clip.mjs` on `preview.mp4` at three anchors' `shownAt` (plus the scene's start). Expected: each frame shows the zoom or click target named by the anchor. Watch the preview once with its `.srt` and check that the captions follow the voice.

- [ ] **Step 4: Update the README.** Add one section, "Timing to the narration", covering:
  - the anchor syntax and its record-time check;
  - whisper.cpp, its first download and its cache;
  - `TUTORIAL_ALIGN=off`;
  - `TUTORIAL_SCENES`;
  - what `timeline.json` and `sync-report.json` contain.

- [ ] **Step 5: Run the final checks.**
  - `pnpm --filter @tallywork/e2e tutorial:test`: all pass.
  - `node scripts/quality-gates.mjs check`: passes.
  - `pnpm typecheck`: passes.
  - `pnpm test:e2e`: the existing suite. No spec changed, but it's run to confirm nothing it shares, such as `quality-gates`, broke.

  Report the counts. Report anything that could not run, with the reason (for example a missing ffmpeg).

- [ ] **Step 6: Commit** `docs(tutorial): timing to the narration`.
