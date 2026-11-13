# Tutorial video: content refresh

Date: 2026-11-13 · Status: draft for review · Scope: `e2e/tutorial` (script, recordings, render cards) and one new recording helper. No product code changes.

## Intent

The video tutorial in the Help Center (shown to system admins) was written and recorded around 3–6 November 2026. Since then WorkPulse gained an AI layer and a Performance Center, was rebranded, and several screens changed. The video now misses whole sections of the menu and shows an old tagline, and at least one scene (07.3) can no longer be recorded. The goal is an accurate, complete video live in the Help Center as soon as possible. The motion-graphics work (Parts 2–4 of the video upgrade) comes after this, and the video is re-rendered again then.

## Decisions taken with the user

- **Scope: full.** Two new chapters, WorkPulse AI and Performance Center. The smaller changes go into the scenes where they belong.
- **Assistant answers: scripted (option B).** Answers shown on screen are written in the tutorial script, identical in every recording, no API key and no cost.
- **How the answers are scripted: in the browser during recording (option 1).** The tutorial server switches on the assistant's built-in test mode so the assistant appears. Playwright replaces the assistant's responses with the scripted text. No app code changes. The builder check showed the browser-side script has to cover the whole conversation round trip, not only the answer (see §1). That is still option 1 (the designer's call, open to the user's review of this doc).
- **WorkPulse AI is on in production** (user). The assistant's test mode is on for every scene, so the AI controls that appear across the app (the assistant button, "Write with AI", "Ask WorkPulse AI") show in every chapter, as they do for admins in production.

## Goals

1. Every chapter matches the current app: labels, menus, flows, wording.
2. The AI features and the Performance Center are explained, in the same calm, plain style as the rest.
3. The new branding is used throughout: "WorkPulse – Powered by AI", "Smarter Workforce. Better Business.".
4. Every scene records in one run on a fresh tutorial server, with every anchor (Part 1) passing.
5. The rendered video is watched, then published to the Help Center with `pnpm tutorial:publish` (production storage, only with the user's OK at that moment).

## Non-goals

- Motion graphics, stylized OS visuals, a scene planner or editor (Parts 2–4).
- Changing app behaviour or wording. If a scene reveals a real app bug, it's reported, not worked around in the app.
- A real AI model on camera.

## Anti-goals (would make this a failure even if it technically works)

- Scripted answers that claim things the product can't do. Each scripted answer must be something the real assistant can produce for that question on the demo data: the same kind of facts, the same tools (organization data, navigation, documentation), the same tone and length. No invented features or numbers that contradict the demo data shown elsewhere in the video.
- Narration that names a button, tab or label that isn't on screen.
- Anything recorded against a server other than the local tutorial server, or any real email, storage or AI call.

## Constraints

- Recording stays on the local tutorial server (`serve-tutorial.mjs`, :3200 and :3201, throwaway database, email and storage off). Rate limits stay on.
- The assistant test mode is the existing one: `ASSISTANT_FAKE=1` together with `TALLYWORK_E2E=1`, which `createAiProvider` accepts only together. `serve-tutorial.mjs` sets both, as `e2e/scripts/serve-web.mjs` already does, and keeps `ANTHROPIC_API_KEY` empty. (Checked: `TALLYWORK_E2E` is read only in `createAiProvider`.) With the test mode on, the server's test provider answers every AI call, not only the assistant's. Any AI-generated text that appears on camera must come from the script (§1), never from the test provider.
- Scripted streams must match the real wire format exactly: the SSE events read by `apps/web/components/assistant/sse.ts` and `stream.ts`, and the `AssistantDraftDto` JSON from `POST /orgs/:orgId/assistant/drafts`. Read the real format from the API code, not from memory.
- Scene ids are file names, test titles and anchor keys. Renumbering is kept to the minimum.
- Every new scene uses Part 1 anchors (`{ on: '…' }`) for its marks and clicks. The static check (`recordings-anchors.test.ts`) must pass.

## Approaches considered

- **Scripted answers, in the browser during recording (chosen).** No app code changes, nothing can reach production. Cost: the script must cover the whole conversation round trip (create, stream, reload, list), because the panel shows only what the server returns once a turn ends. If the stream format changes, recording fails loudly.
- **Scripted answer mode inside the API.** The real flow, including saved history. Rejected: a new AI-path mode in server code, its own security tests, and a mode that must never be on in production.
- **Real model.** Rejected by the user in favour of identical, free, scripted answers.

## Design

### 1. The scripted assistant helper (`e2e/tutorial/assistant.ts`)

A recording helper the `d` fixture exposes:

```ts
// The next question asked in the panel gets this answer, streamed in small pieces like the real one.
await d.scriptAnswer('Who logged the most overtime this month?', answerMarkdown);
// The next "Write with AI" request gets this draft.
await d.scriptDraft(draftText);
```

- **The panel's round trip.** `use-assistant.ts` creates a conversation (`POST …/assistant/conversations`), streams the turn (`POST …/conversations/:id/messages`), then re-fetches the conversation (`GET …/conversations/:id`) and shows only the saved messages. The list of past chats comes from `GET …/assistant/conversations`. The helper keeps a small in-memory set of scripted conversations for the recording, and answers all four routes from it with the real response shapes (read them from the API code and the contracts). So:
  - the question and answer stay on screen after typing ends;
  - the past-chats list shows the scripted chats, with their titles;
  - no real conversation row is created on the server.
- **The stream.** It's built from the scripted text in the real SSE format, delivered in small chunks with short pauses so the answer types out as it does in the app. If the client can't show chunks from a fulfilled route, deliver the whole body at once and say so in the commit.
- **Drafts and the portal summary.** It also fulfils `POST …/assistant/drafts` (`AssistantDraftDto`) and the client portal's `GET /portal/:accessId/ai-summary` (§2, 06.3) from the script.
- **Failing loudly.** Each scripted answer is used once. A request with no scripted answer, or with a question that doesn't match, fails the recording with a message naming the scene. Any other AI call that reaches the server's test provider during a scene that shows its result is a bug in the scene.
- **Where answers live.** In the chapter script (`script/ch16-ai.ts`, and the 06.3 scene), next to the narration, so `build-package.ts` can print them in the production docs.
- **Content of the answers (designer's call).** The demo data is built relative to the recording date (`seed.ts`), and the video will be recorded again later. So scripted answers avoid figures that change from day to day: totals, rankings, "this month" numbers. Where an answer needs a specific fact, pin that fact in `seed-extras.ts` so it's true on every recording date, and phrase the answer so it stays true. The client portal summary follows the real summary's rules: facts only, at most 120 words.

### 2. Chapter changes

Chapter numbers after the change: 1–14 as now, then **15 Performance Center** (new), **16 WorkPulse AI** (new), 17 FAQ (was 15), 18 Wrap-up (was 16). FAQ and Wrap-up change number only: their scene ids become 17.x and 18.x, and their recording test titles change to match.

New chapters (scene titles are a starting point; the builder confirms each against the current screens and keeps scenes 30–60 seconds of narration):

- **15 Performance Center**
  - 15.1 The score: what the 0–100 score measures, the period switch, scoring rules (weights must total 100%).
  - 15.2 Goals and achievements: creating a measured goal, the achievements catalogue, a manager's recognition.
  - 15.3 Leaderboards and profiles: rankings within role families, team and worker performance, what workers see.
- **16 WorkPulse AI**
  - 16.1 Asking WorkPulse AI: open the assistant, a suggested question, a scripted answer drawn from the demo company's data, and what it can and can't see (permissions, private notes).
  - 16.2 AI Insights: the page and its tabs (workforce, timesheet review, workflow, finance, capacity, forecasts), a finding, "Ask WorkPulse AI" from a finding.
  - 16.3 Write with AI: a description drafted with AI (scripted draft), and a timesheet reminder draft.
  - 16.4 Staying informed: notification priority and grouping in the bell, and the weekly AI Insights summary.

Changes to existing chapters (the builder checks every scene against the current app; these are the known ones):

- **Branding.** Chapter 1 narration and overlays use "WorkPulse – Powered by AI" and "Smarter Workforce. Better Business." in place of "Track, focus, achieve". The title and end cards in `render.ts` use the new tagline. `VIDEO` (title, description, thumbnail text, tags) in `scenes.ts` mentions AI.
- **03 Finding your way.** The sidebar groups (now an accordion), Settings as a sidebar dropdown, the bell's grouping, the upgraded calculator, and the assistant button, if it's on screen.
- **04 Organization setup.** Settings is reached from the sidebar dropdown now, not tabs. Add the desktop confirm window to Tracking policies.
- **06.3 Client portal.** The opt-in AI summary for clients: the admin's switch (it appears only when AI is available, which the test mode provides), and the client's view of the summary, with its text scripted (designer's call: showing the result is what makes the switch meaningful).
- **07.3 and the rest of chapter 7.** The timer now needs an explicit "Clock in to …" after choosing a project, plus the 120-second confirm window, which the server enforces. The tutorial's stand-in for the desktop app's main process (`e2e/tutorial/desktop.ts`) must confirm the timer as the real app does. Fix the recording and the narration.
- **14 Manager view.** The menu a manager sees now includes Performance and possibly AI Insights. Check and narrate it accurately.
- **15 FAQ (now 17).** Add one question about WorkPulse AI if the Help Center's FAQ has one; don't invent one.

### 3. Seed data

If a new scene needs data that `seed.ts` and `seed-extras.ts` don't create (for example performance scores, a goal in progress, AI Insights findings, grouped notifications), add it to `seed-extras.ts`. That's tutorial-only data on the throwaway database. Never change `packages/api/src/seed.ts` for the tutorial.

### 4. Production package

Run `pnpm tutorial:package` so `docs/video-tutorial` (script, voiceover, storyboard, subtitles, chapter timestamps) matches.

## Verification

- `pnpm --filter @tallywork/e2e tutorial:test` passes, including the anchor check over every recording.
- Unit tests for the scripted-assistant helper: a scripted stream read back through the real `sse.ts` parser gives the same text; the conversation, list, draft and portal-summary bodies match the real contract types (typed against `@tallywork/contracts`); an unscripted or mismatched question is refused with the scene named.
- `pnpm tutorial:record`: every scene in one run on a fresh server, all passing.
- `pnpm tutorial:render`: no anchors in `sync-report.json` beyond 150 ms without a stated reason, and no scenes left on estimated word times.
- Watch the full video. Check every new scene and every changed scene against the narration, plus a sample of the rest.
- `pnpm typecheck`, and the quality-gate check.
- Publish only after the user has watched it and says so: `pnpm tutorial:publish` against production storage, with keys from the environment.

## Left to the builder

- Exact scene breakdown and wording within the chapters above, written in the existing script style: second person, plain words, labels exactly as on screen.
- The scripted answers' exact text, within the anti-goals above.
- Which further existing scenes need changes, found by recording everything once.
- Where the new tests go (Gate 2, beside the Part 1 tests).
