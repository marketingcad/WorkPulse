# Editing guide

How to turn the clips, the voiceover and the script into the finished video.

## Video settings

| Setting | Value |
|---|---|
| Resolution | 1920 × 1080, 16:9 |
| Frame rate | 30 fps |
| Export | MP4, H.264, 12–16 Mbit/s; AAC audio 192 kbit/s, 48 kHz |
| Length | About 40 minutes, see the [chapter timestamps](06-title-description-chapters.md#chapter-timestamps) |
| Language | English, with captions |

The clips are WebM (VP8). DaVinci Resolve, Premiere Pro and Camtasia import them; if yours does not, convert them first:

```bash
for f in e2e/tutorial/clips/*.webm; do ffmpeg -i "$f" -c:v libx264 -crf 18 -pix_fmt yuv420p -r 30 "${f%.webm}.mp4"; done
```

## Assembly, scene by scene

For each scene in the [production script](02-production-script.md):

1. Place the clip `NN.N-*.webm`. Trim it to the `scene start` and `scene end` markers in its `.markers.json`.
2. Place the scene's voiceover take on the audio track, starting with the scene.
3. If the clip is longer than the narration, keep the extra footage (the presenter is still working) or speed up typing and waiting parts to 1.5×–2×. Never speed up a part the narration is describing.
4. If the narration is longer than the clip, hold the last frame. The recording already adds a hold, so this is rarely needed.
5. Add the scene's text overlays and zooms (below), then its transition.

Put a **chapter card** of 3 seconds before every chapter except the first: the chapter number and title on the brand background (see Style). The chapter timestamps already count these 3 seconds.

## Zooms and highlights

Each `.markers.json` lists, for every zoom or highlight in the script, the second it happens and the area on screen in video pixels:

```json
{ "at": 11.2, "label": "zoom to the QR code", "box": { "x": 921, "y": 568, "width": 176, "height": 176 } }
```

- **Zoom**: ease in over 0.4 s to frame the box with some margin (usually 125–150%; never more than 200%), hold while the narration talks about it, ease out over 0.4 s. Only one zoom on screen at a time.
- **Highlight**: a rounded rectangle 4 px larger than the box, 2 px outline in brand indigo `#4B4FC4`, with the rest of the screen dimmed by 30%. Fade in and out over 0.3 s.
- The recorded cursor already shows a soft ring on every click; don't add more click effects.

## Text overlays

- **Callouts** (the "Callout:" items in the script): white card, 8 px radius, soft shadow, dark text, 28–32 px, Inter or the system sans-serif font. Place them near the thing they describe, never over the cursor's target. On screen for 3–5 seconds.
- **Lower thirds** (people and the demo company): left-aligned, on brand indigo, 2–4 seconds.
- **Title, chapter and end cards**: brand indigo `#4B4FC4` background, WorkPulse logo, white title text.
- Use at most two overlays on screen at once.

## Transitions

Use only what the script names:

| Script says | Do |
|---|---|
| Cut | Straight cut |
| Cross-dissolve | 0.5 s dissolve |
| Wipe to a chapter card | 0.4 s left-to-right wipe into the card, then a cut into the first scene |
| Fade | 1 s fade through black (start and end of the video only) |

Avoid spins, zooming transitions and animated text: the app is the star.

## Audio

- Voiceover at −16 LUFS integrated, peaks below −1 dBTP; light noise reduction and de-essing.
- Optional background music: calm, instrumental, ducked to −30 dB under the voice, −20 dB on cards.
- No UI sounds; the clips are silent.

## Captions

Import [05-subtitles.srt](05-subtitles.srt). Its timings follow the planned edit (narration at 150 words a minute, 2 s between scenes, 3 s chapter cards). After placing the real voiceover, re-time the captions to it: most editors can auto-align an SRT to the audio. Upload the SRT to the video platform as well, as closed captions.

## Before you export

- [ ] Every scene of the production script is in, in order.
- [ ] Chapter starts match the chapter list in the description (update [06-title-description-chapters.md](06-title-description-chapters.md) if they moved).
- [ ] Captions are in sync and spelled like the app: WorkPulse, Clock in, Clock out, End-of-day report.
- [ ] The "Demo data" badge is visible in the web app scenes.
- [ ] Loudness checked; no clipped audio.
