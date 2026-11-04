# Screen-recording checklist

The screen footage is recorded automatically. Playwright plays each scene's clicks and typing in the real WorkPulse web app and desktop app, at 1920 × 1080, with a visible cursor. You do not record the screen by hand. How it works is in [e2e/tutorial/README.md](../../e2e/tutorial/README.md).

## Before you record

- [ ] The repo is installed (`pnpm install`) and Playwright's browser is there (`pnpm test:e2e:install`).
- [ ] Nothing else uses ports **3200** and **3201**. `pnpm dev` (3000) and the E2E servers (3100/3101) can keep running.
- [ ] Record during the working day **in Manila time (UTC+8)**, Monday to Friday. The demo worker, Ava, works from Manila, so clock-in times then look normal on screen, and the demo company has fresh activity for that day.
- [ ] If the app changed since the last recording, rebuild it: `TUTORIAL_BUILD=1 pnpm tutorial:record`.
- [ ] The demo data is created fresh on every start, in a throwaway local database (`e2e/.tmp/tutorial`). It is never your dev data, never Supabase, never production.

## Record

```bash
pnpm tutorial:record
```

- [ ] It builds the app if needed, seeds the demo company (about 2 minutes), then records all scenes in order. That takes about 45 minutes.
- [ ] The run ends with `63 passed`: every scene except 16.2, the end card made in the editor.
- [ ] The clips are in `e2e/tutorial/clips`: one `.webm` and one `.markers.json` per scene, named after the scene, e.g. `11.4-create-an-invoice.webm`.

**Record everything in one run.** Scenes build on each other: the breaks created in 04.2 appear on Ava's timer in 07.3, and her report from 07.5 is read in 08.4. To redo one scene, start a fresh server and record everything again. Recording a scene on its own works, but its data may not match its neighbours.

To re-record a single scene for a quick check: `pnpm tutorial:record -g "07.3"`.

## Check each clip

- [ ] 1920 × 1080, the cursor visible, no error toasts, nothing cut off.
- [ ] The demo company is "Northwind Creative (Demo)" and the **Demo data** badge is in the top bar (keep it: it tells viewers the numbers are not real).
- [ ] No real names, emails or companies on screen. Every person and company is from the demo seed or the script.
- [ ] The first second or two of each clip is the page loading: trim up to the `scene start` marker in its `.markers.json`.
- [ ] The clip is at least as long as its narration. The recording holds the last frame until the narration would end.

Quick look at a clip without a video player (saves a PNG of the frame at 12 seconds):

```bash
cd e2e && node tutorial/inspect-clip.mjs tutorial/clips/07.3-clock-in.webm 12
```

## Things the recording cannot capture

| Scene | What to add in the edit |
|---|---|
| 01.1 | Title card before the recording |
| 07.1 | The real installer is not downloaded; the dialog and guide pages are real |
| 07.2–07.8 | The desktop app runs in a browser window that looks exactly like the app; the window frame of Windows or macOS is not shown. Optionally place the clips inside a laptop or window mock-up. |
| 07.4 | The idle prompt is triggered by the recording (in real use it appears after 5 minutes without input) |
| 16.2 | End card, made in the editor |
