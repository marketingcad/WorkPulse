# WorkPulse video tutorial: production package

Everything needed to produce **one complete video tutorial of WorkPulse**: about 40 minutes, 1920 × 1080, in English. The footage is the real application, recorded automatically with demo data.

## What is in the package

| # | File | What it is |
|---|---|---|
| 1 | [01-feature-inventory.md](01-feature-inventory.md) | What WorkPulse does, checked against the code, and which scene covers each feature |
| 2 | [02-production-script.md](02-production-script.md) | **The master script.** For every scene: duration, what is on screen, presenter actions and clicks, voiceover, text overlays, zoom and highlight instructions, transition |
| 3 | [03-voiceover-script.md](03-voiceover-script.md) | The narration only, ready for the voice artist |
| 4 | [04-storyboard.md](04-storyboard.md) | One row per scene: time, visual, audio, overlay, zoom, transition, clip |
| 5 | [05-subtitles.srt](05-subtitles.srt) | English captions, timed to the planned edit |
| 6 | [06-title-description-chapters.md](06-title-description-chapters.md) | Video title, description, chapter timestamps, opening and closing scripts, thumbnail concept |
| 7 | [07-recording-checklist.md](07-recording-checklist.md) | How to record the screen footage (automated), and what to check |
| 8 | [08-editing-guide.md](08-editing-guide.md) | Assembling the video: style, overlays, zooms, transitions, audio, export |

Files 2–6 are **generated** from one source, `e2e/tutorial/scenes.ts` and the chapter files in `e2e/tutorial/script/`. Change the words there and run `pnpm tutorial:package`; don't edit the generated files by hand.

## How the video gets made

```text
1. Record the footage     pnpm tutorial:record      → e2e/tutorial/clips/*.webm (one per scene)
2. Record the voiceover   03-voiceover-script.md    → one audio take per scene
3. Edit                   02-production-script.md   + 08-editing-guide.md → final MP4
4. Caption and publish    05-subtitles.srt + 06-title-description-chapters.md
```

The screen footage is recorded by Playwright scripts (`e2e/tutorial/recordings`). They drive the real WorkPulse web app and desktop app against an isolated local server with a demo company, Northwind Creative. Each scene has its own clip, named after the scene (`07.3-clock-in.webm`), with a visible cursor and click highlights. A `.markers.json` file next to each clip gives the second and screen area of every zoom the script asks for. No real customer data and no shared environment are involved.

## The story

The tutorial follows one company through the product's whole flow: **Organization → People → Work → Tracking → Time → Approval → Money → Insight**. Scenes build on each other, which is why they are recorded in order:

- The Coffee and Lunch breaks created in chapter 4 and planned on a project in chapter 6 are the break buttons Ava taps in chapter 7.
- Ava's end-of-day report from chapter 7 is the one her manager reads in chapter 8.
- Her time-off request from chapter 7 is approved in chapter 10.

The 16 chapters: Welcome · Getting started · Finding your way around · Set up your organization · Add your people · Clients, projects and tasks · The desktop app for workers · Watching the work · Time and approvals · Schedules, attendance and time off · Money · Reports · Security and administration · The team manager's view · Questions and troubleshooting · Wrap-up. Their planned start times are in [06-title-description-chapters.md](06-title-description-chapters.md#chapter-timestamps).

## What is not automated

- **The voiceover.** It is a script for a person or a text-to-speech service to read; no audio is generated here.
- **The edit.** Overlays, zooms, chapter cards, music and the final MP4 are made in a video editor, following [08-editing-guide.md](08-editing-guide.md). The clips are WebM (VP8). Most editors import them directly; otherwise convert them to MP4 first (see the guide).
- **The end card (scene 16.2) and the title card.** Made in the editor.
