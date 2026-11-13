# Tutorial Content Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Help Center video tutorial up to date with the app (WorkPulse AI, Performance Center, branding, changed screens), recorded in one run and rendered, ready for the user to watch and publish.

**Architecture:** All changes stay in `e2e/tutorial` and the tutorial server: chapter scripts (`script/chNN-*.ts`), recordings (`recordings/NN-*.rec.ts`), tutorial-only seed data (`seed-extras.ts`), the desktop stand-in (`desktop.ts`), render cards (`render.ts`), and a new browser-side scripted-assistant helper (`assistant.ts`) exposed through the `d` fixture. No app code changes.

**Tech Stack:** Playwright (recordings, `page.route`), TypeScript, Vitest (`tutorial:test`), ffmpeg + Piper + whisper.cpp (render, from Part 1).

**Spec:** [docs/superpowers/specs/2026-11-13-tutorial-content-refresh-design.md](../specs/2026-11-13-tutorial-content-refresh-design.md)

## Global Constraints

- No changes under `apps/`, `packages/` or `scripts/`, except adding Gate 2 entries to `quality-gates.json`.
- The tutorial server only: `serve-tutorial.mjs` on :3200 and :3201, a throwaway database, email and storage off. It adds `ASSISTANT_FAKE=1`, `TALLYWORK_E2E=1` and an empty `ANTHROPIC_API_KEY`.
- AI text on camera comes only from the script: assistant answers, drafts, and the portal summary. Never from the server's test provider.
- Scripted answers avoid figures that change with the recording date. Facts they rely on are pinned in `seed-extras.ts`. The portal summary is facts only, at most 120 words.
- Narration names only labels that are on screen, exactly as written there. The style is second person, plain, and 30–60 s of narration per scene.
- Branding: "WorkPulse – Powered by AI" and "Smarter Workforce. Better Business." replace "Track, focus, achieve" and "Track • Focus • Achieve" everywhere.
- Chapters: 1–14 keep their numbers; 15 is Performance Center, 16 is WorkPulse AI, 17 is FAQ (was 15), 18 is Wrap-up (was 16).
- Every mark and click that the narration names has an `{ on }` anchor, and `recordings-anchors.test.ts` passes.
- Publishing (`pnpm tutorial:publish`) is not part of this plan. It waits for the user.

## Review Focus

1. **A scripted question typed differently from the script.** Expect the recording to fail with the scene and both texts, not to show a blank or a test-provider answer.
2. **The panel reloading the chat after a turn.** Expect the question and answer to stay on screen, and the history list to show the scripted chat with its title.
3. **A scene recorded on a different day.** Expect the scripted answers to still be true against the demo data.
4. **An AI call not covered by the script** (another component calling drafts or summaries). Expect no "Draft: …" text from the test provider on camera; the recording should fail.
5. **The desktop stand-in after the confirm-window change.** Expect clock-in to work as the real app does, and chapter 7 to record in full.

---

### Task 1: Tutorial server in assistant test mode

**Files:** Modify `e2e/tutorial/serve-tutorial.mjs`.

- [ ] **Step 1:** Add `ASSISTANT_FAKE: '1'`, `TALLYWORK_E2E: '1'` and `ANTHROPIC_API_KEY: ''` to the server environment, with a comment pointing to `e2e/scripts/serve-web.mjs` and the design.
- [ ] **Step 2:** Start the server with `node e2e/tutorial/serve-tutorial.mjs`, sign in as the admin from `setup.ts` state, then check `GET /api/v1/orgs/:orgId`. Expected: `assistant_enabled: true`. Stop the server.
- [ ] **Step 3:** Commit `feat(tutorial): the tutorial server shows WorkPulse AI (test mode, no model)`.

### Task 2: The scripted-assistant helper

**Files:** Create `e2e/tutorial/assistant.ts` and `e2e/tutorial/test/assistant.test.ts`. Modify `e2e/tutorial/kit.ts` (the `d` fixture) and `quality-gates.json`.

**Interfaces:**
- `assistant.ts`:
  - `sseBody(text: string, ids: { user: string; assistant: string }): string[]`: SSE chunks, in order: `message_saved`, then `delta` events of a few words each, then `done`.
  - `class ScriptedAssistant { answer(question: string, markdown: string, title?: string): void; draft(text: string, facts: string[]): void; portalSummary(dto: PortalAiSummaryDto): void; install(page: Page, orgId: string, sceneId: string): Promise<void>; assertUsed(): void }`
- `kit.ts`: `d.scriptAnswer(question, markdown, title?)`, `d.scriptDraft(text, facts?)`, `d.scriptPortalSummary(dto)`. `finish()` calls `assertUsed()`.

- [ ] **Step 1: Write the failing tests.**
  - `sseBody` read back through the real `createSseParser` (`apps/web/components/assistant/sse.ts`; import it by relative path) gives `message_saved`, then deltas that join to exactly the text, then `done`, and every event passes `assistantStreamEvent`.
  - The routes return a conversation and message list typed as `AssistantConversationDto` / `Conversation`.
  - After a scripted turn, the conversation's `messages` hold the user and assistant messages with those texts.
  - The list shows the scripted chat's title.
  - A question that doesn't match throws `Scene 16.1: asked "X", but the script expects "Y"`.
  - An unscripted request throws, naming the scene.
  - `assertUsed()` throws when an answer was never asked.
- [ ] **Step 2: Run** `pnpm --filter @tallywork/e2e tutorial:test assistant`. Expected: FAIL.
- [ ] **Step 3: Implement.** `install` routes these, all under `**/api/v1/orgs/<orgId>/assistant/`:
  - `POST conversations`: creates an in-memory conversation;
  - `GET conversations?…`: the list;
  - `GET conversations/:id`: that conversation and its messages;
  - `POST conversations/:id/messages`: checks the body's `content` against the next scripted question, then fulfils with `sseBody(...).join('')` and `content-type: text/event-stream`;
  - `POST drafts`;
  - `PATCH` / `DELETE conversations/:id`: updates the in-memory set.

  It also routes `**/api/v1/portal/*/ai-summary`. Read the real response shapes from `packages/api/src/services/assistant*` and `portal-summary.ts`. If `route.fulfill` can't stream in pieces, the whole body arrives at once and the panel shows the answer in one go. That's acceptable; say so in the commit.
- [ ] **Step 4: Run** the tests. Expected: PASS. Add `assistant` to Gate 2.
- [ ] **Step 5: Commit** `feat(tutorial): scripted WorkPulse AI answers in the browser`.

### Task 3: Desktop stand-in and chapter 7

**Files:** Modify `e2e/tutorial/desktop.ts`, `e2e/tutorial/recordings/07-desktop.rec.ts` and `e2e/tutorial/script/ch07-desktop.ts`.

- [ ] **Step 1:** Read the confirm-window change (commits 61ba2fc and 061a871: the server and Tracking policies) and the desktop timer's current UI ("Clock in to …"). Make the stand-in's session start do what the real main process does, including the confirmation.
- [ ] **Step 2:** Update 07.3 (choose a project, then click "Clock in to …") and any other chapter 7 scenes whose screens changed. Update the narration to match, with anchors.
- [ ] **Step 3: Run** `pnpm tutorial:record -g "07\."` on a fresh server (stop :3200 first). Expected: all chapter 7 scenes pass.
- [ ] **Step 4: Commit** `fix(tutorial): chapter 7 for the Clock in button and confirm window`.

### Task 4: Renumber FAQ and Wrap-up, and add the branding

**Files:**
- Rename `script/ch15-faq.ts` → `ch17-faq.ts` and `ch16-wrap-up.ts` → `ch18-wrap-up.ts`.
- Rename the recordings `15-faq.rec.ts` → `17-faq.rec.ts` and `16-wrap-up.rec.ts` → `18-wrap-up.rec.ts`.
- Modify `scenes.ts`, `script/ch01-introduction.ts`, `render.ts` and the README's examples if they cite those ids.

- [ ] **Step 1:** Renumber the chapter `n` and the scene ids (`15.x` → `17.x`, `16.x` → `18.x`) and the test titles. Leave `CHAPTERS` listing ch01–14, then ch17 and ch18, until Tasks 6 and 7 add ch15 and ch16.
- [ ] **Step 2:** Branding.
  - Chapter 1 narration and overlays, and the end scene (18.1).
  - `render.ts`'s `tagline` → `'Smarter Workforce. Better Business.'`, plus "Powered by AI" on the title card.
  - `VIDEO`: the title, description, tags and thumbnail text mention WorkPulse AI.
- [ ] **Step 3:** Run `tutorial:test` (the anchor check) and typecheck. Expected: PASS.
- [ ] **Step 4:** Commit `feat(tutorial): FAQ and Wrap-up become chapters 17 and 18; new branding`.

### Task 5: Chapters 3, 4, 6.3 and 14 against the current app

**Files:** The scripts and recordings for chapters 03, 04, 06 and 14, plus `seed-extras.ts` if needed.

- [ ] **Step 1:** Record chapters 03, 04, 06 and 14 as they are now. Fix every failure, and every narration line that no longer matches the screen. Known changes:
  - the sidebar accordion;
  - Settings as a sidebar dropdown;
  - the bell's priority and grouping;
  - the upgraded calculator;
  - the confirm window in Tracking policies;
  - the manager's menu, now including Performance and AI Insights where they apply.
- [ ] **Step 2:** In 06.3, switch on the client AI summary and show the client's view, using `d.scriptPortalSummary(...)`: facts only, at most 120 words, true for the seeded Globex projects on any date.
- [ ] **Step 3:** Run `pnpm tutorial:record -g "^0[346]\.|^14\."`. Expected: all pass. Then run `tutorial:test`.
- [ ] **Step 4:** Commit `fix(tutorial): finding your way, setup, client portal and manager view match the app`.

### Task 6: Chapter 15, Performance Center

**Files:** Create `script/ch15-performance.ts` and `recordings/15-performance.rec.ts`. Modify `scenes.ts`, and `seed-extras.ts` if needed.

- [ ] **Step 1:** Visit the Performance pages on the tutorial server to read their labels: overview, scoring rules, goals, achievements, leaderboards, teams, workers.
- [ ] **Step 2:** Write 15.1 (the score, the period and the scoring rules), 15.2 (goals and achievements) and 15.3 (leaderboards and worker profiles) in the house style. Each has a `screen`, `actions`, `narration`, `overlays`, `focus` and `transition`.
- [ ] **Step 3:** If the demo has no scores, goals or awards to show, add them in `seed-extras.ts`, the same way the file adds other demo data.
- [ ] **Step 4:** Write the recordings with anchors. Run `pnpm tutorial:record -g "^15\."`. Expected: PASS. Then run `tutorial:test`.
- [ ] **Step 5:** Commit `feat(tutorial): chapter 15, the Performance Center`.

### Task 7: Chapter 16, WorkPulse AI

**Files:** Create `script/ch16-ai.ts` and `recordings/16-ai.rec.ts`. Modify `scenes.ts`, and `seed-extras.ts` if needed.

- [ ] **Step 1:** Visit the assistant panel and its suggested questions, the AI Insights page and its tabs, a finding with "Ask WorkPulse AI", "Write with AI" in a form, the reminder draft, and the bell with the weekly summary. Read the labels.
- [ ] **Step 2:** Write the scenes:
  - **16.1 Asking WorkPulse AI:** one scripted question and answer, plus what it can and can't see.
  - **16.2 AI Insights:** the tabs, a finding, and "Ask WorkPulse AI" with a scripted answer.
  - **16.3 Write with AI:** a project description draft, and a timesheet reminder draft.
  - **16.4 Staying informed:** grouping in the bell, and the weekly summary.

  Answers follow the Global Constraints. Each must be something the real assistant can produce with its tools (organization data, navigation, documentation) for that question.
- [ ] **Step 3:** Pin any fact an answer relies on in `seed-extras.ts`.
- [ ] **Step 4:** Write the recordings with `d.scriptAnswer` and `d.scriptDraft`, and anchors. Run `pnpm tutorial:record -g "^16\."`. Expected: PASS, and `assertUsed` is satisfied. Then run `tutorial:test`.
- [ ] **Step 5:** Commit `feat(tutorial): chapter 16, WorkPulse AI`.

### Task 8: FAQ entry, the rest of the scenes, the full recording

- [ ] **Step 1:** If the Help Center's FAQ has a WorkPulse AI question, add it to 17.1 with an anchor. Don't invent one.
- [ ] **Step 2:** Run `pnpm tutorial:record` for every scene, in one run, on a fresh server. For each failing scene, fix the recording or the narration (to match the app). Repeat until all pass.
- [ ] **Step 3:** Run `pnpm tutorial:package`, and commit the regenerated `docs/video-tutorial`.
- [ ] **Step 4:** Commit `fix(tutorial): every scene records on the current app`.

### Task 9: Render, check, and hand over

- [ ] **Step 1:** Run `pnpm tutorial:render` (Piper). Expected:
  - `sync-report.json` lists no anchor over 150 ms without a reason;
  - the log names no estimated scenes;
  - every chapter file is under 50 MB.
- [ ] **Step 2:** Pull frames at each new or changed scene's anchors and look at them: new chapters 15 and 16, plus 01, 03, 04, 06.3, 07 and 14. Check that the screen matches the narration and that no "Draft: …" test text appears.
- [ ] **Step 3:** Run `pnpm --filter @tallywork/e2e tutorial:test`, `pnpm typecheck`, `node scripts/quality-gates.mjs check` and `pnpm test:e2e`. Expected: all pass, or any failures named and checked, as in Part 1.
- [ ] **Step 4:** Hand the rendered video (`e2e/tutorial/video/workpulse-tutorial.mp4`) to the user to watch. Publishing waits for their OK.
