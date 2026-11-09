# WorkPulse AI Intelligence, Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Administrative productivity on top of Phase 1:
- workflow assistance (approval bottlenecks and a review-first order; expense category suggestions);
- AI content drafts that are always editable and never sent;
- smarter notifications (priority, grouping, and a weekly "needs your attention" summary).

**Architecture:**
- **Same pattern as Phase 1.** Deterministic rules in `packages/domain` decide priorities, categories, bottlenecks and groupings. The API serves them through the existing scoped services and notification system. The AI only writes text: drafts, and explanations through the existing panel.
- **Drafts** are a new `POST /assistant/drafts` endpoint: one AI turn with no tools, given only facts the person may see, returning text the person edits and copies. It never sends, saves or publishes anything.
- **The weekly summary** is a notification built from Phase 1's computed findings, sent through `notify()` with its own preference type.

**Tech Stack:** TypeScript, Hono, Drizzle and PGlite, Zod 4, Next.js 16, Vitest, Playwright.

**Spec:**
- `docs/superpowers/specs/2026-11-10-ai-intelligence-gap-analysis.md` (§4 Phase 2);
- the product brief in the conversation (features J, K and L);
- decisions taken with the product owner on 10 November 2026:
  - **drafts only**: no announcements feature, nothing sent automatically;
  - **the weekly summary goes in-app, plus an email for people who turn it on.**

## Global Constraints
- Builds on branch `feat/ai-intelligence` (PR #117). Reuse `getInsights`, `toolsFor`, `notify()`, `notification_preferences`, `reminder_sends` and `loadActor`. No new notification system, provider or conversation table.
- **The AI never:**
  - approves, rejects, sends, saves, publishes, categorizes on its own, or changes a record;
  - receives activity, apps, URLs, idle time, screenshots, emails, rates or private review notes.
- **Every draft is returned to the person, never stored or sent.** It is generated only from facts fetched through scoped services for that person. If the input facts are empty, the endpoint says so instead of inventing context.
- **Deterministic first:** notification priority, grouping, expense categories and workflow bottlenecks are rules in `packages/domain`, and they work when the AI is off. The AI is optional on top.
- **Priority never hides anything:** every notification still appears and is still counted as unread. Critical types are never grouped away.
- **The weekly summary:**
  - sent at most once per member per week (a `reminder_sends` claim with kind `insights.weekly`);
  - only to members who may use AI Insights (`mayUseAssistant`), computed with their own actor (`loadActor`);
  - in-app on by default, email only when they opt in;
  - skipped when there are no findings.
- **Bundle budget:** the shell (bell) may grow only by the priority dot and the group count, under 0.3 KB. Drafting UI loads on demand. Every route stays ≤ 250 KB.
- **Tests:** every new test file goes into `quality-gates.json`. E2E uses the fake provider.

## Review Focus
1. **A draft is requested for a project the person cannot see,** or by a worker. The answer is 404 or 403 and the provider is never called. Test in Task 5.
2. **The AI provider is unavailable when drafting.** The answer is 503 `ai_unavailable` with no partial text, and the form keeps what the person typed. Tests in Task 5 and Task 7.
3. **A member loses access between weeks,** or the organization has no findings. No summary is sent, and nothing is sent twice when the daily job runs twice in a day. Test in Task 4.
4. **Twenty notifications of one type arrive in a day.** The bell shows one group with a count, while unread still counts each one and a critical type is never grouped. Tests in Task 3 (domain) and Task 7 (E2E).
5. **An expense description in another language, or empty.** No suggestion is shown (no guess), and the person's typed category is never overwritten. Tests in Task 1 and Task 7.

---

### Task 1: Deterministic rules (domain)

**Files:**
- Create: `packages/domain/src/insights/workflow.ts`, `packages/domain/src/notifications.ts`, `packages/domain/src/expense-categories.ts`
- Modify: `packages/domain/src/insights/index.ts`, `packages/domain/src/index.ts` (export the two new modules)
- Test: `packages/domain/test/insights-workflow.test.ts`, `packages/domain/test/notifications.test.ts`, `packages/domain/test/expense-categories.test.ts`

**Interfaces (produces):**
- `NOTIFICATION_PRIORITY: Record<string, 'critical' | 'important' | 'info'>` and `notificationPriority(type: string): 'critical' | 'important' | 'info'`, defaulting to `info`.
  - **critical:** `budget.exceeded`, `invoice.overdue`, `limit.reached`, `payroll.bank_details_changed`, `device.offline`.
  - **important:** `timesheet.submitted`, `timesheet.rejected`, `timesheet.changes_requested`, `manual_time.requested`, `time_off.requested`, `budget.warning`, `time.needs_review`, `timesheet.late_time`, `shift.not_started`, `expense.submitted`, `insights.weekly`.
  - **info:** everything else.
- `groupNotifications<T extends { id: string; type: string; created_at: string; read_at: string | null }>(items: T[], windowHours = 24): Array<{ type: string; items: T[] }>`:
  - consecutive items (newest first) of the same non-critical type within the window form one group;
  - critical types are always alone;
  - order is preserved.
- `suggestExpenseCategory(description: string, categories: readonly string[]): { category: string; matched: string } | null`:
  - case- and accent-insensitive keyword rules (for example `uber|taxi|flight|train|parking|toll` → Travel, `hotel|airbnb|lodging` → Lodging, `lunch|dinner|coffee|restaurant` → Meals, `subscription|license|saas|software` → Software, `laptop|monitor|keyboard` → Equipment, `paper|ink|stationery` → Supplies, `mileage|km|miles` → Mileage);
  - only categories present in `categories`;
  - null when nothing matches, or when two categories match equally.
- `workflowFindings(input: { period: Period; today: string; waiting: Array<{ kind: 'timesheet' | 'manual_time' | 'time_off' | 'expense'; id: string; memberName: string; submittedOn: string; concerns: number }>; decisionDays: { current: number | null; previous: number | null } }): { findings: Finding[]; limitations: string[] }`. Section `workflow`.
  - `review_first`: up to 10 waiting items ordered by concerns, then age. Fact. Links `timesheets.approvals`.
  - `waiting_long`: items waiting more than 3 days. Attention, fact.
  - `decision_time`: average days from submission to decision, with the previous period and change. Observation. It needs a baseline of at least 0.5 days, otherwise it becomes a limitation.
  - `backlog_mix`: counts per kind. Info, fact.
- Extend `InsightSection` and `insightSectionInput` (contracts) with `'workflow'`.

- [ ] **Step 1: Write the failing tests:**
  - `notificationPriority('budget.exceeded')` → `'critical'`, and `'unknown.x'` → `'info'`.
  - Three `timesheet.submitted` within 2 h → one group of 3.
  - Two `budget.exceeded` in a row → two groups.
  - `timesheet.submitted`, `budget.warning`, `timesheet.submitted` → three groups.
  - Items 30 h apart → separate groups.
  - `suggestExpenseCategory('Uber to the airport', CATS)` → `{category:'Travel', matched:'uber'}`.
  - `'Café con leche'` → Meals (accent folding).
  - `''` → null.
  - `'Uber Eats lunch'` with both Travel and Meals matching once → null.
  - A category not in the list is never returned.
  - `workflowFindings`:
    - waiting items are ordered by concerns, then oldest;
    - an item submitted 5 days before `today` gives `waiting_long`;
    - `decisionDays {current:2, previous:1}` gives `decision_time` with a change of 100;
    - a previous value of null gives a limitation and no change metric;
    - `links` ⊆ `NAV_TARGET_KEYS`.
- [ ] **Step 2:** `pnpm --filter @tallywork/domain test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Then `pnpm --filter @tallywork/contracts test` (schema extension).
- [ ] **Step 5:** Commit `feat(domain): notification priority and grouping, expense category suggestions, workflow rules`.

### Task 2: Workflow insights (API, tool, page tab)

**Files:**
- Modify:
  - `packages/api/src/services/ai-insights/gather.ts` (`workflowInputs`)
  - `packages/api/src/services/ai-insights/index.ts` (section `workflow`; included in the overview)
  - `packages/api/src/services/assistant/tools/insights.ts` (`getWorkflowInsights`, gated by `timesheets:approve` OR `time_off:approve` OR `expenses:approve`)
  - `tools/index.ts`; `lib/ai/fake.ts` (rule `bottleneck` → `getWorkflowInsights`)
  - `apps/web/components/insights-ai/insights-view.tsx` (tab "Workflow") and `messages.ts`; `apps/web/components/assistant/messages.ts` (status label)
- Test: extend `packages/api/test/ai-insights.test.ts` and `assistant-insight-tools.test.ts`

**Gathering** (scoped services only):
- timesheets: `approvalQueue` (SUBMITTED; `concerns` = the number of Phase 1 timesheet findings referencing that sheet);
- manual time: `listManualTime` (PENDING) when the actor holds `manual_time:approve`;
- time off: `listTimeOffRequests` (PENDING) when the actor holds `time_off:approve`;
- expenses: `listExpenses` (SUBMITTED) when the actor holds `expenses:approve`;
- `decisionDays`: the average of `decided_at − submitted_at` over timesheets decided in the period and in the previous one, from `runReport('timesheet-approval')` rows, which carry both.

- [ ] **Step 1: Write the failing tests:**
  - With two submitted sheets, the admin's `workflow` has `review_first` listing both.
  - A manager's `workflow` lists only their team.
  - A member without any approve permission gets `findings: []` and a limitation.
  - `getWorkflowInsights` is absent for an actor with only `org:read`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Run the API suite: PASS.
- [ ] **Step 5:** Commit `feat(ai-insights): workflow section (review first, waiting long, decision time)`.

### Task 3: Notification priority and grouping

**Files:**
- Modify:
  - `packages/contracts/src/dto.ts` (`NotificationDto.priority: 'critical' | 'important' | 'info'`)
  - `packages/api/src/services/platform.ts` (`listNotifications` adds `priority` from `notificationPriority`)
  - `apps/web/components/shell/app-shell.tsx`, `Notifications()`: group with `groupNotifications`. A group of more than one shows the newest title, `+N more`, and expands on click. Opening a group marks all its items read. A priority dot appears for critical and important (`aria-label` "Urgent" or "Important").
  - `apps/web/messages/en.ts` (3 short strings)
- Test: `packages/api/test/notification-priority.test.ts`; extend `apps/web/test/bundle-imports.test.ts` only if a new module is added.

- [ ] **Step 1: Write the failing test:** after `notify()` creates `budget.exceeded` and `timesheet.submitted` for the admin, `GET /notifications` returns `priority: 'critical'` and `'important'` respectively, and `unread` is 2.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** API and web tests pass. `pnpm --filter @tallywork/web build && node apps/web/scripts/check-bundle-budget.mjs`: no route over 250 KB.
- [ ] **Step 5:** Commit `feat(notifications): priority and grouping in the bell`.

### Task 4: Weekly "needs your attention" summary

**Files:**
- Create: `packages/api/src/services/insights-weekly.ts` (`sendWeeklyInsights(tx, deps, orgId, today): Promise<number>`)
- Modify:
  - `packages/api/src/jobs/index.ts`: in `runDaily`, after `sendDigests`, in its own try/catch so a failure never rolls back other daily steps; it runs only when `today` is the organization's week-start day.
  - `apps/web/app/o/[orgId]/me/profile/page.tsx` (`NOTIFICATION_TYPES` entry `insights.weekly`, label "Weekly summary of what needs my attention", `manager: true`)
- Test: `packages/api/test/insights-weekly.test.ts`

**Behavior:**
- For each ACTIVE membership:
  - load the actor;
  - skip unless `mayUseAssistant`;
  - claim `reminder_sends(kind 'insights.weekly', date = week start)`; skip if already claimed.
- Compute `getInsights(x, 'overview', last week)`. Skip when there are no findings, and release nothing.
- Otherwise call `notify(tx, deps, orgId, [id], { type: 'insights.weekly', title: '<n> things need your attention this week', body: top 3 titles joined, link: '/ai-insights?period=last_week' })`. `notify` applies the email preference (opt-in) and the in-app default.
- No AI provider is used: the text is the findings' own titles.

- [ ] **Step 1: Write the failing tests:**
  - On the week-start day, the admin with findings gets exactly one `insights.weekly` notification.
  - Running twice that day still gives one.
  - The next day gives none.
  - A worker gets none.
  - A member whose org has no findings gets none.
  - Email is sent only when the preference `insights.weekly` has `email:true` (check `t.mailer`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(notifications): weekly AI Insights summary`.

### Task 5: Drafts endpoint (AI writes, the person edits)

**Files:**
- Create: `packages/api/src/services/assistant/drafts.ts`
- Modify:
  - `packages/contracts/src/assistant.ts` (`assistantDraftInput`, `AssistantDraftDto`)
  - `packages/api/src/routes/assistant.ts` (`POST /drafts`)
  - `packages/api/src/app.ts` (the `assistant:msg` and `assistant:day` limits also apply to `/drafts`)
  - `lib/ai/fake.ts` (with no tools offered, return `Draft: <first 60 chars of the instruction>`)
- Test: `packages/api/test/assistant-drafts.test.ts`

**Interfaces:**
- `assistantDraftInput = z.discriminatedUnion('kind', [...])`. Kinds:
  - `project_description {project_id}`
  - `task_description {task_id}`
  - `timesheet_reminder {from, to}`: names from Phase 1's missing timesheets;
  - `project_update {project_id, from, to}`: facts from `getInsights('projects')`, filtered to that project, plus task counts;
  - `rewrite {text ≤ 4000, style: 'improve' | 'shorter' | 'longer' | 'professional' | 'friendly' | 'translate', language?}`.
- `AssistantDraftDto = { text: string; facts_used: string[] }` lists which facts were given, so the UI can show "Based on: …".
- **Facts come only from scoped services**:
  - `getProject`/`listTasks` for project and task (404 if not visible);
  - the missing list needs `timesheets:read` + `members:read`, otherwise 403;
  - a rewrite uses only the given text.
- The system prompt, verbatim:
  > Write the requested text for WorkPulse users. Use only the facts given. Never invent names, numbers, dates, prices or policies. If a fact is missing, leave a [placeholder] for the person to fill in. Plain text, no markdown headings. The person will review and edit it; you never send anything.
- One provider turn, no tools, 600 output tokens, 30 s timeout.
- Output is trimmed and capped at 4000 characters.
- Errors are 503 `ai_unavailable` or 429 `ai_rate_limited`, with no partial text.
- Access: `assertAssistantAccess`, plus the permission each kind needs:
  - `projects:read`;
  - `tasks:read`;
  - `timesheets:read` + `members:read`;
  - none extra for `rewrite`.

- [ ] **Step 1: Write the failing tests:**
  - A project draft for a visible project → 200 with `facts_used` containing the project name, and the fake's text.
  - A project the manager cannot see → 404, and `t.ai.calls` is unchanged.
  - A worker → 403.
  - The provider throws `ai_unavailable` → 503 with no `text`.
  - `rewrite` with 4001 characters → 400.
  - A reminder draft lists only names in the actor's scope.
  - The prompt sent to the provider contains no email address.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** API suite PASS.
- [ ] **Step 5:** Commit `feat(assistant): drafts endpoint (project, task, reminder, update, rewrite)`.

### Task 6: Drafting UI and expense suggestions

**Files:**
- Create:
  - `apps/web/components/assistant/draft-button.tsx`: a "Write with AI" menu (Draft, Improve, Shorter, Longer, Professional, Friendly). It calls `/assistant/drafts` and puts the result into the field for editing.
    - The field's previous text can be restored with an Undo.
    - It shows "Based on: …" from `facts_used`.
    - It renders only when `org.assistant_enabled`, and is lazy-loaded.
  - `apps/web/components/insights-ai/reminder-draft-dialog.tsx`: from the `missing` finding card, a "Draft reminder" button opens a dialog with the editable draft and Copy. There is no Send button.
- Modify:
  - project and task dialogs in `apps/web/components/workspace/shared.tsx` (the description fields get `<DraftButton>`);
  - `apps/web/app/o/[orgId]/finance/expenses/page.tsx`: under the description field, "Suggested category: Travel · Use" when `suggestExpenseCategory` returns one and the category is still empty. Clicking fills it; it never overwrites.
- Test: extend `apps/web/test/bundle-imports.test.ts` (the shell and workspace pages do not statically import `draft-button.tsx`).

- [ ] **Step 1:** Write the bundle guard test. FAIL.
- [ ] **Step 2:** Implement. Web tests and typecheck pass. Build and budget: no route over 250 KB.
- [ ] **Step 3:** Commit `feat(web): Write with AI in descriptions, reminder drafts, expense category suggestions`.

### Task 7: E2E, docs and verification

**Files:**
- Create: `e2e/tests/web/ai-workflow.spec.ts`
- Modify: `quality-gates.json`; `README.md`; `docs/plan/08-decisions.md` (ADR-136 "AI drafts never send; notification priority is deterministic"); `packages/domain/src/help/content.ts` (help articles "Write with AI" and "Weekly summary").

**E2E tests:**
1. **`@smoke`:** the admin opens AI Insights › Workflow and sees `review_first` after a worker submits.
2. Write with AI fills the new project's description, editable before saving; Undo restores it.
3. With the provider failing (route `**/assistant/drafts` → 503), an error shows and the typed text stays.
4. "Draft reminder" on the missing-timesheets card opens an editable draft with Copy and no Send.
5. The expense dialog suggests Travel for "Taxi to client", and the suggestion doesn't overwrite a typed category.
6. The bell groups three `timesheet.submitted` notifications into one row with "+2 more", and a `budget.exceeded` shows "Urgent".
7. A manager's drafts for another team's project are refused.
8. The viewer role has no "Write with AI".

**Verification:**
- [ ] **Step 1:** Write the spec, and run `pnpm test:e2e e2e/tests/web/ai-workflow.spec.ts`.
- [ ] **Step 2:** Run `pnpm typecheck`, `pnpm test` and `pnpm test:e2e`, the quality-gates check and the bundle budget. Record the real counts.
- [ ] **Step 3:** Commit `test(e2e): AI workflow, drafts and notifications; docs: ADR-136`.
