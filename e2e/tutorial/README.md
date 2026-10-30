# Video tutorial recordings

Playwright scripts that record the screen footage for the WorkPulse video tutorial: one clip per scene, at 1920 × 1080, from the real web app and desktop app with demo data. The production package they feed (script, voiceover, storyboard, subtitles) is in [docs/video-tutorial](../../docs/video-tutorial/README.md).

```bash
pnpm tutorial:record    # record every scene → e2e/tutorial/clips
pnpm tutorial:package   # regenerate docs/video-tutorial from scenes.ts
pnpm tutorial:render    # voiceover + edit → e2e/tutorial/video/workpulse-tutorial.mp4
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
- `youtube-chapters.txt`: the chapter timestamps for the video description.

The voice comes from `TUTORIAL_TTS`:

| `TUTORIAL_TTS` | Voice | Needs |
|---|---|---|
| `windows` (default) | A built-in Windows voice, `TUTORIAL_VOICE` (default `Microsoft Zira Desktop`). Robotic: for checking the cut | Nothing |
| `openai` | `TUTORIAL_VOICE` (default `alloy`), `TUTORIAL_TTS_MODEL` (default `gpt-4o-mini-tts`) | `OPENAI_API_KEY` |
| `elevenlabs` | `TUTORIAL_VOICE` is the voice id | `ELEVENLABS_API_KEY` |

Set keys in the environment, never in a file in the repo. Voice files and encoded scenes are cached in `e2e/.tmp/tutorial-render`, so a re-run only redoes what changed; switching the voice re-renders every scene. Callouts are the quoted text of each scene's overlays. Watch the result before publishing.

## Writing or changing a scene

1. Edit the scene's words in `script/chNN-*.ts`: screen, actions, narration, overlays, zooms, transition.
2. Make the recording do what the actions say, in `recordings/NN-*.rec.ts`:
   - `await d.go('/path')` opens a page of the demo organization (`'!/download'` for any other path). Call `d.begin()` when the narration starts.
   - Move with `d.click`, `d.type`, `d.choose` (a `<select>` option by text), `d.set` (date and time fields), `d.point`, `d.scrollTo` and `d.beat`. These are slow and visible on purpose; don't use raw `locator.click()` on screen.
   - Call `d.mark('zoom to …', locator)` for every zoom or highlight in the script.
   - End with `await d.finish()`, which holds the last frame until the narration would end.
   - Use `label('Name')` for a field whose label may end with the required marker (`Name *`), and `choice(scope, 'Weekly')` for segmented controls.
   - Desktop scenes call `useDesktopWindow()` at the top of their file and open the window with `d.desktop()`.
3. Run it: `pnpm tutorial:record -g "07.3"`. A failure keeps the page snapshot in `e2e/.tmp/tutorial-results`.
4. Run `pnpm tutorial:package` and commit the regenerated docs with the change.
5. Before handing clips to the editor, record everything in one run on a fresh server, because scenes build on each other's data. Stop the server on :3200 first; the next run seeds a new one.
