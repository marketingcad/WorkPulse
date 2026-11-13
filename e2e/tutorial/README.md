# Video tutorial recordings

Playwright scripts that record the screen footage for the WorkPulse video tutorial: one clip per scene, at 1920 × 1080, from the real web app and desktop app with demo data. The production package they feed (script, voiceover, storyboard, subtitles) is in [docs/video-tutorial](../../docs/video-tutorial/README.md).

```bash
pnpm tutorial:record    # record every scene → e2e/tutorial/clips
pnpm tutorial:package   # regenerate docs/video-tutorial from scenes.ts
pnpm tutorial:render    # voiceover + edit → e2e/tutorial/video/workpulse-tutorial.mp4
pnpm tutorial:publish   # upload the chapters to storage → Help Center, for system admins
```

These are recordings, not tests. They are not part of `pnpm test:e2e`: separate config, separate folder, separate server.

## How it is set up

| Piece | File | What it does |
|---|---|---|
| Config | [../playwright.tutorial.config.ts](../playwright.tutorial.config.ts) | 1920 × 1080 video of every scene, one worker, file order, the servers below |
| Server | [serve-tutorial.mjs](serve-tutorial.mjs) | Seeds a throwaway file-backed PGlite database in `e2e/.tmp/tutorial` with the demo company (`packages/api/src/seed.ts`, plus [seed-extras.ts](seed-extras.ts)), then `next start` on **:3200**. Reuses the production build; `TUTORIAL_BUILD=1` rebuilds. The desktop window is served on **:3201** by `scripts/serve-desktop.mjs`. |
| Sign-ins | [setup.ts](setup.ts) | Signs the admin (Avery Admin) and the team manager (Maya Chen) in once, into `e2e/.auth/tutorial` |
| Scenes | [scenes.ts](scenes.ts), [script/](script) | Every scene's words and directions: the single source for the recordings and the docs |
| Recordings | [recordings/](recordings) | One `NN-*.rec.ts` per chapter; a test's title is its scene id (`test('07.3', …)`) |
| Kit | [kit.ts](kit.ts) | The `d` fixture: visible cursor and click ripple, eased mouse moves, typing at reading speed, `mark()` for zooms, pacing to the narration, saving the clip as `clips/<id>-<title>.webm` |
| Desktop | [desktop.ts](desktop.ts) | Opens the desktop app's window with a bridge that plays the main process: a real device sign-in for Ava Okafor, real reads and requests, and a visible timer whose clock-in, breaks and clock-out are sent to the server as the app's session events |
| Package | [build-package.ts](build-package.ts) | Writes the generated docs |
| Publish | [publish.ts](publish.ts) | Uploads the chapter files to storage for the Help Center (see below) |
| Render | [render.ts](render.ts) | Makes the finished MP4 from the clips with ffmpeg: a synthetic voiceover per scene, each clip held until its narration ends, the zooms from its markers, the callouts, title, chapter and end cards, captions and chapter marks. See below. |
| Clip check | [inspect-clip.mjs](inspect-clip.mjs) | Prints a clip's size and saves frames as PNG |

## Safety

- The server only ever uses the local throwaway database and has email and storage off, like the E2E server. Setup refuses any host but localhost.
- Rate limits stay on, as in production. Sign-ins happen once per person per run (setup.ts, and one desktop sign-in each for Ava and the five people put to work in 08.1), well under the limits.
- The webhook scene adds a **disabled** endpoint at example.com, so nothing is ever sent out.

## Rendering the video

`pnpm tutorial:render` needs ffmpeg (`winget install Gyan.FFmpeg`) and the clips from `pnpm tutorial:record`. It writes `e2e/tutorial/video/` (git-ignored):

- `workpulse-tutorial.mp4`: 1920 × 1080, 30 fps, H.264 and AAC, with chapter marks;
- `workpulse-tutorial.en.srt`: the English captions, timed to the real voiceover. Upload them with the video; VLC and most players load them from the same folder. They are not embedded, because an MP4 caption track corrupts the first chapter mark;
- `workpulse-tutorial-thumbnail.png`: 1280 × 720, built from frames of the Overview and the desktop timer, as the script's thumbnail concept describes;
- `youtube-chapters.txt`: the chapter timestamps for the video description.

Background music: `TUTORIAL_MUSIC=path/to/track.mp3 pnpm tutorial:render` loops the track quietly under the voice (about −20 dB) and fades it in and out. Use a track you have the rights to, such as one from the YouTube Audio Library. Only the final join is redone.

The voice comes from `TUTORIAL_TTS`:

| `TUTORIAL_TTS` | Voice | Needs |
|---|---|---|
| `piper` (default) | [Piper](https://github.com/rhasspy/piper), free and open source, runs on this computer. `TUTORIAL_VOICE` (default `en_US-lessac-high`; try `en_US-ryan-high` for a male voice) is any name from [piper-voices](https://huggingface.co/rhasspy/piper-voices) | Nothing: Piper and the voice download into `e2e/.tmp/piper` on first use (Windows) |
| `windows` | A built-in Windows voice, `TUTORIAL_VOICE` (default `Microsoft Zira Desktop`). Robotic | Nothing |
| `openai` | `TUTORIAL_VOICE` (default `alloy`), `TUTORIAL_TTS_MODEL` (default `gpt-4o-mini-tts`) | `OPENAI_API_KEY` |
| `elevenlabs` | `TUTORIAL_VOICE` is the voice id | `ELEVENLABS_API_KEY` |

Set keys in the environment, never in a file in the repo. Voice files and encoded scenes are cached in `e2e/.tmp/tutorial-render`, so a re-run only redoes what changed; switching the voice re-renders every scene. Callouts are the quoted text of each scene's overlays. Watch the result before publishing.

### Timing to the narration

Zooms, highlights and clicks are shown when the narrator says what they show, and captions follow the spoken words.

- **Anchors.** A recording ties a moment to the words that name it: `d.mark('zoom to the timer card', timer, { on: 'The timer starts' })`, `d.click(button, { on: 'click Approve' })`, or `d.cue('the Coffee break')` for timing alone. `nth: 2` picks a later time the phrase is said. `click`, `type`, `point` and `scrollTo` take `{ on }` too; the moment is when the cursor arrives. The phrase must be in the scene's narration (case and punctuation don't matter), or the recording fails. `pnpm --filter @tallywork/e2e tutorial:test` also checks every anchor against the script, so editing the narration can't silently break one.
- **Word timing.** Each voice file is aligned word by word with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), which runs on this computer. The Windows build and its `base.en` model (~150 MB) download into `e2e/.tmp/whisper` on first use; results are cached in `e2e/.tmp/tutorial-render/align`. ElevenLabs voices bring their own timestamps instead. If alignment fails, or matches less than 80% of the words, that scene falls back to an estimate from word counts and the render says so. `TUTORIAL_ALIGN=off` uses the estimate everywhere.
- **Retiming.** Between anchors, the footage plays faster (up to 1.5×) where it runs ahead of the words, and holds on the frame before the anchor where it runs behind. It is never slowed down. When the footage would still reach a moment after its words, the still stretches before it (the cursor resting, a pause to read, found with ffmpeg freezedetect and cached) are cut first, only as much as needed. A scene without anchors renders as before.
- **Output.** `video/timeline.json` has every scene's start, word times, anchors, footage pieces and captions. `video/sync-report.json` lists the anchors shown more than 150 ms after their words, or dropped because the narration says them in a different order from the recording; the render prints the same lines (`[render] sync: …`).
- **Preview.** `TUTORIAL_SCENES=07.3,09.2 pnpm tutorial:render` renders only those scenes into `video/preview.mp4`, with `preview.en.srt`, `preview.timeline.json` and `preview.sync-report.json` (so the full video's timeline stays as it was), without cards, thumbnail or chapter files. Anchor phrases and clips are checked before any voice is made, so a typo stops the render straight away.

### Animated visuals

On top of the recording, the render draws animated visuals timed to the narration (, off with ):

- **Highlight ring and name label** on each item the voiceover names, when it is said. The ring follows the item through zooms and ends at the next click, scroll or page change. A named button gets 0.9 s under the cursor before the click, so its ring is seen.
- **Step numbers** inside the rings of scenes marked  in their script.
- **Callouts** (the quoted text of a scene's overlays) slide in when the narration talks about them.
- **Concept cards** for what the screen cannot show (: operating systems, a phone with a QR code, two-factor, the time-to-money flow, rates, invoices, payroll, offline sync, WorkPulse AI), on their trigger words, in the corner farthest from the ring. A scene's script can add a card on other words or turn one off ().
- **Scene tag** and **branded chapter transitions**.

At most one ring, label, callout and card are on screen at a time. Each element is drawn by  in Chromium, frame by frame, into a small transparent clip cached in  by what it shows, so a re-render only draws what changed. Drawings are original: no real logos.

## Publishing to the Help Center

System admins (anyone who may change the organization, `org:update`) can watch the tutorial on the Help page: a player at the top of the topics with the chapter list, a "Video tutorial" topic link, and a "Watch the video" button in the page header. Nobody else sees it, and the API refuses them.

`pnpm tutorial:render` also writes `e2e/tutorial/video/chapters/`: one MP4 per chapter (each under the storage bucket's 50 MB limit), WebVTT captions, a poster and `manifest.json`. File names carry a content hash. `pnpm tutorial:publish` uploads them to `platform/tutorial/` in the storage the environment configures, the same way the app picks it:

| Target | Environment |
|---|---|
| Production | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` of the production project (from Vercel, never committed) |
| Local dev server (`pnpm dev`) | `LOCAL_STORAGE_DIR=apps/web/.data/blobs` |

It refuses to run with no storage configured. It uploads the chapter files first and the manifest last, so the Help Center never lists a chapter that is missing, then removes the previous version's files. Until a tutorial is published, the Help page shows no video section.

The API is `GET /orgs/:orgId/help/tutorial` (the manifest, or `null`) and `GET /orgs/:orgId/help/tutorial/files/:name` (streamed with `Range` support, so viewers can skip ahead), both `org:update` only. See `packages/api/src/services/help-tutorial.ts`.

## Writing or changing a scene

1. Edit the scene's words in `script/chNN-*.ts`: screen, actions, narration, overlays, zooms, transition.
2. Make the recording do what the actions say, in `recordings/NN-*.rec.ts`:
   - `await d.go('/path')` opens a page of the demo organization (`'!/download'` for any other path). Call `d.begin()` when the narration starts.
   - Move with `d.click`, `d.type`, `d.choose` (a `<select>` option by text), `d.set` (date and time fields), `d.point`, `d.scrollTo` and `d.beat`. These are slow and visible on purpose; don't use raw `locator.click()` on screen.
   - Call `d.mark('zoom to …', locator, { on: 'words' })` for every zoom or highlight in the script, with the narration words it belongs to (see [Timing to the narration](#timing-to-the-narration)).
   - End with `await d.finish()`, which holds the last frame until the narration would end.
   - Use `label('Name')` for a field whose label may end with the required marker (`Name *`), and `choice(scope, 'Weekly')` for segmented controls.
   - Desktop scenes call `useDesktopWindow()` at the top of their file and open the window with `d.desktop()`.
3. Run it: `pnpm tutorial:record -g "07.3"`. A failure keeps the page snapshot in `e2e/.tmp/tutorial-results`.
4. Run `pnpm tutorial:package` and commit the regenerated docs with the change.
5. Before handing clips to the editor, record everything in one run on a fresh server, because scenes build on each other's data. Stop the server on :3200 first; the next run seeds a new one.
