# WorkPulse AI Intelligence, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evidence-based workforce, timesheet-review and project-risk insights, plus AI report summaries, built on the existing assistant. The findings are deterministic, permission-scoped and explainable; the AI only explains and recommends.

**Architecture:**
- Pure rules in `packages/domain/src/insights/` turn already-scoped aggregates into typed `Finding`s.
- `packages/api/src/services/insights/` gathers those aggregates through the existing scoped services and serves them:
  - at `GET /orgs/:orgId/assistant/insights/:section`, which works without an AI key;
  - through four new read-only assistant tools.
- The web gets an "AI Insights" page and "Ask WorkPulse AI" buttons, which open the existing panel with a prefilled question.

**Tech Stack:** TypeScript, Hono, Drizzle and PGlite (tests), Zod 4, Next.js 16 App Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-ai-intelligence-gap-analysis.md`, plus the product brief in the conversation ("WorkPulse AI Intelligence – Feature Enhancement"). This plan covers its Phase 1: features A, B, C, E and the Insights dashboard (Overview, Workforce, Timesheets, Projects).

## Global Constraints
- Extend the assistant; do not rebuild it. No new provider, conversation table or LLM endpoint.
- `packages/domain` stays pure: no I/O, no AI SDK.
- No figure comes from the model. Every number in a finding is computed in code from scoped service data.
- Every finding states its `basis`:
  - `fact`: a stored record;
  - `observation`: a computed comparison;
  - `estimate`: a projection, which must say so in its summary.
- If data is insufficient, return a `limitations` entry instead of a finding.
- Data comes only through existing scoped services (`narrowMemberships`, `listBudgets`, `listTasks`, `approvalQueue`, `runReport` …). Never query tables for another member without narrowing first.
- Money appears only where the existing service already returns it to this actor. Phase 1 adds no finance data.
- Never: approve or reject, modify entries, read `private_note`, or use activity, screenshots, apps or URLs.
- Tool output goes through an allowlist in `services/assistant/redact.ts` and is capped at 8 KB (existing `capOutput`).
- Insights access is the same as the assistant: `mayUseAssistant` (user principal, web role, `org:read`). It does **not** require `ANTHROPIC_API_KEY`.
- Cache: in memory, TTL 300 s, keyed by `${orgId}:${membershipId}:${section}:${from}:${to}`.
- The web route `/o/[orgId]/ai-insights` must stay ≤ 250 KB first-load JS (`node apps/web/scripts/check-bundle-budget.mjs`). Load the page body lazily.
- Every new test file goes into `quality-gates.json` (CI fails otherwise).
- E2E runs only against the isolated server with the fake provider (`ASSISTANT_FAKE`).

## Review Focus
1. **A team manager asks about the whole organization.** Findings cover only their team (`narrowMemberships`), and team rollups never include another team. Test in Task 5 (manager scope).
2. **A previous period with no data, or under 1 h.** Percent change is not reported (no division by zero, no "+∞%"). An observation with `previous: null` is produced and a limitation is noted. Test in Task 1.
3. **An overlap across midnight, or an open (running) entry.** The running entry is excluded, and the cross-midnight overlap is detected once, not twice. Test in Task 2.
4. **A worker or a role without `org:read` calls the insights endpoint.** 403, and no tool is offered. Tests in Task 5 and Task 6.
5. **The AI is not configured or fails.** The Insights page still shows findings, and "Ask WorkPulse AI" is hidden when `assistant_enabled` is false. Test in Task 8 (E2E, with the provider failing via `error-test`).

---

### Task 1: Finding model and period comparison (domain)

**Files:**
- Create: `packages/domain/src/insights/types.ts`, `packages/domain/src/insights/compare.ts`, `packages/domain/src/insights/index.ts`
- Modify: `packages/domain/package.json` (exports: add `"./insights": "./src/insights/index.ts"`)
- Test: `packages/domain/test/insights-compare.test.ts`

**Interfaces:**
- Produces:
  - `type Basis = 'fact' | 'observation' | 'estimate'`
  - `type Severity = 'info' | 'attention' | 'warning'`
  - `type InsightSection = 'workforce' | 'timesheets' | 'projects'`
  - `interface Metric { label: string; value: number; unit: 'hours' | 'percent' | 'count' | 'days'; previous?: number | null }`
  - `interface InsightRef { type: 'member' | 'team' | 'project' | 'timesheet' | 'task'; id: string; name: string }`
  - `interface Finding { id: string; section: InsightSection; category: string; severity: Severity; basis: Basis; title: string; summary: string; period: { from: string; to: string }; metrics: Metric[]; refs: InsightRef[]; links: NavTargetKey[]; next_step: string }`
  - `interface InsightResult { section: InsightSection; period: { from: string; to: string }; previous: { from: string; to: string }; findings: Finding[]; limitations: string[] }`
  - `previousPeriod(from: string, to: string): { from: string; to: string }`: the same number of days immediately before.
  - `percentChange(current: number, previous: number | null, minBaseline: number): number | null`: null when `previous` is null or below `minBaseline`. Rounded to 1 decimal.
  - `findingId(section: InsightSection, category: string, key: string): string`: stable, `${section}:${category}:${key}`.

- [ ] **Step 1: Write the failing tests** in `insights-compare.test.ts`:
  - `previousPeriod('2026-11-02','2026-11-08')` → `{from:'2026-10-26',to:'2026-11-01'}`.
  - `previousPeriod('2026-03-01','2026-03-31')` → `{from:'2026-01-29',to:'2026-02-28'}` (31 days).
  - `percentChange(12, 10, 1)` → `20`.
  - `percentChange(5, 0, 1)` → `null`.
  - `percentChange(5, null, 1)` → `null`.
  - `percentChange(5, 0.5, 1)` → `null`.
  - `percentChange(9, 12, 1)` → `-25`.
- [ ] **Step 2:** `pnpm --filter @tallywork/domain test insights-compare`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the three functions with UTC date arithmetic (no time-zone dependence), and export the types and functions from `index.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(domain): insight finding model and period comparison`.

### Task 2: Timesheet review rules (domain)

**Files:**
- Create: `packages/domain/src/insights/timesheets.ts`
- Test: `packages/domain/test/insights-timesheets.test.ts`

**Interfaces:**
- Consumes: the Task 1 types.
- Produces:
  - `interface EntrySpan { id: string; membershipId: string; memberName: string; projectId: string | null; start: string; end: string | null; source: 'TRACKED' | 'MANUAL' }` (ISO instants).
  - `findOverlaps(entries: EntrySpan[]): Array<{ a: EntrySpan; b: EntrySpan; overlapSeconds: number }>`:
    - per member, sweep by start;
    - entries with `end === null` are ignored;
    - touching ends (a.end === b.start) are not an overlap;
    - each pair is reported once.
  - `findDuplicates(entries: EntrySpan[]): Array<EntrySpan[]>`: same member, project, start and end, more than once.
  - `interface SheetSummary { timesheetId: string; membershipId: string; memberName: string; periodStart: string; status: string; totalSeconds: number; manualSeconds: number; previousTotalSeconds: number | null; flags: string[] }` (flags as returned by `approvalQueue`).
  - `timesheetFindings(input: { period: { from: string; to: string }; entries: EntrySpan[]; sheets: SheetSummary[]; missing: Array<{ membershipId: string; memberName: string }>; longDaySeconds?: number }): Finding[]`.
    - The `longDaySeconds` default is `14 * 3600`.
    - Categories:
      - `overlap` (warning, fact);
      - `duplicate` (warning, fact);
      - `long_day` (attention, observation: one member over the threshold on one day);
      - `manual_heavy` (attention, observation: `manualSeconds / totalSeconds > 0.25` and total ≥ 1 h);
      - `hours_change` (info, observation: `|percentChange| ≥ 50` with a baseline ≥ 4 h);
      - `missing` (attention, fact: one finding listing up to 20 names plus a count);
      - `flagged` (info, fact: carries the queue's flags).
    - Every summary uses neutral wording ("may need a look", never "suspicious").
    - Every `timesheet`-ref finding links `timesheets.approvals`.

- [ ] **Step 1: Write the failing tests:**
  - Two entries 09:00–11:00 and 10:30–12:00 for one member → one overlap of 1800 s.
  - The same times for two different members → none.
  - An entry 23:00–01:00 and another 00:30–02:00 the next day → one overlap of 1800 s.
  - A running entry (`end:null`) inside another → none.
  - Touching 09:00–10:00 and 10:00–11:00 → none.
  - Three identical entries → one duplicate group of 3.
  - `timesheetFindings` with manual 3 h of 10 h → a `manual_heavy` finding with `metrics` `{label:'Manual share', value:30, unit:'percent'}`.
  - 30 h vs a previous 10 h → a `hours_change` with value 200.
  - 3 h vs a previous 2 h → no `hours_change` (baseline under 4 h).
  - Summaries never contain "suspicious", "fraud" or "misconduct".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(domain): timesheet review rules (overlaps, duplicates, long days, manual share, change)`.

### Task 3: Workforce and project rules (domain)

**Files:**
- Create: `packages/domain/src/insights/workforce.ts`, `packages/domain/src/insights/projects.ts`
- Test: `packages/domain/test/insights-workforce.test.ts`, `packages/domain/test/insights-projects.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `interface GroupHours { id: string; name: string; type: 'team' | 'project' | 'member'; seconds: number; previousSeconds: number | null; overtimeSeconds: number; previousOvertimeSeconds: number | null; approvedSeconds: number }`.
  - `workforceFindings(input: { period; previous; totals: { seconds: number; previousSeconds: number | null; approvedSeconds: number; overtimeSeconds: number; previousOvertimeSeconds: number | null }; groups: GroupHours[]; pending: number; missing: number; timeOff: { approvedDays: number; pendingRequests: number } }): { findings: Finding[]; limitations: string[] }`.
    - Categories:
      - `hours_trend` (org-level, info);
      - `overtime_trend` (team, attention when overtime rose ≥ 25 % with a baseline ≥ 2 h, or appeared from zero ≥ 2 h);
      - `workload_up` (team, attention when hours rose ≥ 20 % with a baseline ≥ 8 h);
      - `approval_backlog` (fact, when `pending > 0`; links `timesheets.approvals`);
      - `missing_timesheets` (fact);
      - `approved_share` (observation: approved / tracked, percent);
      - `time_off` (info).
    - A limitation `'No previous period to compare with.'` when `totals.previousSeconds` is null or 0.
  - `interface ProjectFacts { id: string; name: string; budget: null | { kind: 'HOURS' | 'MONEY'; pctUsed: number; state: 'healthy' | 'warning' | 'exceeded'; projectedPct: number | null }; tasks: { open: number; overdue: number; dueNext14: number; done: number }; milestones: { late: number; overdue: number; next: { name: string; due: string } | null }; hoursThisPeriod: number; hoursPreviousPeriod: number | null }`.
  - `projectFindings(input: { period; today: string; projects: ProjectFacts[] }): { findings: Finding[]; limitations: string[] }`.
    - Categories:
      - `budget_exceeded` (warning, fact);
      - `budget_near` (attention, fact: state `warning`);
      - `budget_projection` (attention, **estimate**, when `projectedPct > 100` and the state is not exceeded; the summary starts "At the current pace, this project is projected to…");
      - `overdue_work` (attention, fact: overdue tasks or milestones);
      - `deadline_risk` (attention, **estimate**, when `dueNext14 ≥ 3` and hours this period fell ≥ 30 % vs the previous one);
      - `healthy` (info, one finding listing projects with none of the above, up to 10 names).
    - Each finding links `projects.list`; budget findings also link `finance.budgets` (only keys that exist in `NAV_TARGETS`, filtered later by `resolveNav`).

- [ ] **Step 1: Write the failing tests:**
  - Team A at 30 h vs 20 h previously → `workload_up` with value 50.
  - Team B at 5 h vs 4 h → none (baseline under 8 h).
  - Overtime 4 h vs 0 → `overtime_trend`.
  - No previous period → a limitation and no trend findings.
  - A project at 82 % `warning` → `budget_near`.
  - A healthy project projected at 130 % → `budget_projection` with `basis:'estimate'` and a summary starting "At the current pace".
  - An exceeded project → `budget_exceeded` only (no projection finding).
  - 2 overdue tasks → `overdue_work` with metric `{label:'Overdue tasks', value:2, unit:'count'}`.
  - Every finding's `links` ⊆ `NAV_TARGET_KEYS`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement both modules. Export from `index.ts`.
- [ ] **Step 4:** Run `pnpm --filter @tallywork/domain test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(domain): workforce and project insight rules`.

### Task 4: Insight contracts

**Files:**
- Modify: `packages/contracts/src/assistant.ts` (or create `packages/contracts/src/insights.ts` and re-export it)
- Test: `packages/contracts/test/assistant.test.ts` (extend)

**Interfaces:**
- Produces:
  - `insightSectionInput = z.enum(['overview','workforce','timesheets','projects'])`;
  - `insightQueryInput = z.object({ from: isoDate, to: isoDate })`, refined `to ≥ from`, at most 93 days;
  - `insightResultSchema`, the Zod mirror of `InsightResult`;
  - `type InsightResultDto = z.infer<typeof insightResultSchema>`.
  - The API validates its own output with `insightResultSchema.parse` before responding (the brief: "validate AI outputs using Zod").

- [ ] **Step 1:** Tests:
  - A valid result parses.
  - `basis:'guess'` is rejected.
  - A range of 94 days is rejected.
  - `to < from` is rejected.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, plus `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(contracts): insight schemas`.

### Task 5: Insights service and endpoint

**Files:**
- Create:
  - `packages/api/src/services/insights/gather.ts`
  - `packages/api/src/services/insights/index.ts` (`getInsights`)
  - `packages/api/src/services/insights/cache.ts`
- Modify: `packages/api/src/routes/assistant.ts` (add `GET /insights/:section`)
- Test: `packages/api/test/insights.test.ts`

**Interfaces:**
- Consumes: domain Task 1–3, contracts Task 4. Existing services:
  - `timeEntryTotals`, `listTimeEntries` (timesheets.ts:99/160);
  - `approvalQueue` (timesheets.ts:965, only when the actor holds `timesheets:approve`);
  - `runReport(x,'timesheet-approval',…)` for statuses and previous totals;
  - `listMemberOptions`, `listTeams`;
  - `overtimeInRange` (pay-figures.ts:141). It is tx-only: pass `narrowMemberships(x.actor,'time:read')` ids, never all;
  - `getOvertimeRules`, `listBudgets`, `listTasks`, `listMilestones`, `listProjects`, `listTimeOffRequests`.
- Produces:
  - `getInsights(x: Ctx, section: 'overview'|'workforce'|'timesheets'|'projects', q: { from: string; to: string }): Promise<InsightResultDto>`.
    - `overview` = the top 6 findings across the three sections by severity (warning > attention > info), then by section order.
    - A section the actor lacks the data permission for returns `findings: []` with a limitation naming the missing access:
      - workforce needs `time:read`;
      - timesheets needs `timesheets:read`; the `flagged` and `missing` categories also need `timesheets:approve`;
      - projects needs `projects:read`, and budgets need `budgets:read`.
  - `insightCache.get/set(key)`: Map plus expiry, 300 s, at most 500 keys (evict the oldest).
  - Route `GET /orgs/:orgId/assistant/insights/:section?from&to`:
    - `assertAssistantAccess`;
    - validate with `insightSectionInput` / `insightQueryInput`;
    - a cache hit returns the same body;
    - `insightResultSchema.parse` before `c.json`.

- [ ] **Step 1: Write the failing tests** (PGlite harness; seed through the API as `packages/api/test/assistant-tools.test.ts` does):
  - The admin gets workforce findings computed from the seeded hours: `hours_trend` metric value equals the seeded total.
  - **Manager scope:** a team manager sees only their team's group in `workforce` and no other team's name anywhere in the body.
  - **Tenant isolation:** org B's admin requesting org A's path → 403/404, and org B's cached result never returns org A's names (request A, then B, same section and dates).
  - **Cache per member:** the same section and period for two members of one org are cached separately (a manager and an admin get different bodies).
  - Overlapping entries can't be created through the API (`assertNoOverlap`). To test detection, call `getInsights` in a test that inserts two overlapping `time_entries` rows directly with the harness's admin tx, then expect an `overlap` finding.
  - A worker → 403 `assistant_forbidden`.
  - Works with no AI key configured (the harness default).
  - `from > to` → 400.
  - The body never contains `private_note`, an email address (regex), or `activity`.
- [ ] **Step 2:** `pnpm --filter @tallywork/api test insights`. Expected: FAIL.
- [ ] **Step 3:** Implement `gather.ts`, one function per section returning the domain inputs, then the service and route.
  - Previous-period inputs use `previousPeriod`.
  - Team rollups map member → team through `listTeams` memberships, restricted to the narrowed ids.
- [ ] **Step 4:** Run the insights tests, then all of `pnpm --filter @tallywork/api test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): permission-scoped insights endpoint with per-member cache`.

### Task 6: Assistant tools and report summaries

**Files:**
- Create: `packages/api/src/services/assistant/tools/insights.ts` (three tools), `packages/api/src/services/assistant/tools/report-summary.ts`
- Modify:
  - `tools/index.ts` (register the tools)
  - `redact.ts` (`redactFinding`, `redactReport`)
  - `lib/ai/fake.ts` (rules: `insight` → `getWorkforceInsights`, `review` → `reviewTimesheets`, `risk` → `getProjectRisks`, `report` → `summarizeReport` with `{ key:'time-activity', from: monday, to: today }`)
  - `packages/domain/src/assistant/navigation.ts` (add the `ai.insights` target `/ai-insights`, gate `org:read`)
  - `packages/domain/src/assistant/suggestions.ts` (add "What needs my attention this week?", gated `time:read`)
  - `packages/api/src/services/assistant/prompt.ts` (two sentences, below)
- Test: `packages/api/test/assistant-insight-tools.test.ts`

**Interfaces:**
- Consumes: `getInsights` (Task 5); `runReport`, `reportCatalog` (reports.ts:660/664).
- Produces the tools (the statusKey copy goes in Task 7):

| Tool | Input | Allowed | Calls |
|---|---|---|---|
| `getWorkforceInsights` | `{from,to}` | `time:read` | `getInsights(x,'workforce',…)` |
| `reviewTimesheets` | `{from,to}` | `timesheets:read` | `getInsights(x,'timesheets',…)` |
| `getProjectRisks` | `{from,to}` | `projects:read` | `getInsights(x,'projects',…)` |
| `summarizeReport` | `{key, from, to, group_by?}` | `reports:read` | `runReport` |

  - `summarizeReport` only accepts a `key` present in `reportCatalog(x)` and not `hidden`; otherwise it is denied, like an unknown tool.
  - It returns `{ title, period, summary, totals, top_rows (≤ 15), columns }` through `redactReport`, which:
    - drops columns of type `money` unless `reports:finance` is held;
    - always drops `email`-like keys and `activity`.
  - `redactFinding(f)` returns `{title, summary, category, severity, basis, period, metrics, refs:{type,name}[], next_step}`. Ref ids are kept out of model input; links go through `nav`.
  - Prompt addition, verbatim:
    > When you use insight tools, present each finding with its basis: say "measured" for facts, "compared with the previous period" for observations, and "estimated" for estimates. Never add numbers that are not in a tool result, and never describe a pattern as misconduct.

- [ ] **Step 1: Write the failing tests:**
  - Each tool is absent from `toolsFor` for an actor without its permission.
  - `summarizeReport` with key `payroll` for a manager → `denied`.
  - `summarizeReport` with `time-activity` → `top_rows.length ≤ 15` and no money columns for a role without `reports:finance`.
  - `reviewTimesheets` output contains no ids except in `nav`.
  - The FakeProvider script "what needs review" → a `reviewTimesheets` call, and the streamed answer contains "Here is what I found".
  - Output ≤ 8 KB.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `pnpm --filter @tallywork/api test` and `pnpm --filter @tallywork/domain test`: PASS.
- [ ] **Step 5:** Commit `feat(api): assistant insight tools and report summaries`.

### Task 7: AI Insights page and "Ask WorkPulse AI"

**Files:**
- Create:
  - `apps/web/app/o/[orgId]/ai-insights/page.tsx` (thin; lazy body)
  - `apps/web/components/insights-ai/insights-view.tsx`
  - `apps/web/components/insights-ai/finding-card.tsx`
  - `apps/web/components/insights-ai/messages.ts` (catalog registered on import, as `components/assistant/messages.ts`)
  - `apps/web/lib/assistant-bridge.ts`
- Modify:
  - `apps/web/components/shell/nav.ts` (item `nav.item.aiInsights` → `/ai-insights`, `perms: ['org:read']`, in the Reports group after Summary; plus a `NAV_GUIDE` line in `components/help/content.ts`)
  - `apps/web/messages/en.ts` (only `nav.item.aiInsights`)
  - `apps/web/components/assistant/assistant-launcher.tsx` (listen for the bridge event: open the panel and send the question)
  - `apps/web/app/o/[orgId]/reports/[key]/page.tsx` (an "Ask WorkPulse AI" button that sends `Summarize the <title> report for <from> to <to>.`)
  - `apps/web/components/assistant/messages.ts` (status labels for the four new statusKeys)
- Test: `apps/web/test/assistant-bridge.test.ts`; extend `apps/web/test/bundle-imports.test.ts` (the shell must not import `components/insights-ai/*`).

**Interfaces:**
- Consumes: the Task 5 endpoint and `InsightResultDto`.
- Produces:
  - `askAssistant(question: string): void`: dispatches `new CustomEvent('workpulse:assistant-ask', { detail: { question } })`.
  - `onAskAssistant(handler): () => void`.
  - The launcher, on that event: opens the panel, starts a **new chat**, and sends the question once.

The page:
- **Layout:** a PageHeader "AI Insights", with the description "Measured from your organization's data. Facts, comparisons and estimates are labelled."
- **Period control:** a SegmentedControl "Period": This week | Last week | This month | Last month, computed with the existing `rangeFor` helpers.
- **Tabs:** Overview | Workforce | Timesheets | Projects, kept in the URL as `?tab=`.
- **Each card shows:**
  - severity badge;
  - title;
  - basis badge ("Measured", "Compared with previous period", "Estimate");
  - summary;
  - metrics (value, unit, previous when present);
  - period;
  - refs as text;
  - links (`resolveNav` from the domain, so only allowed targets render);
  - `next_step`;
  - an "Ask WorkPulse AI" button (only when `org.assistant_enabled`), which sends `Explain this insight and what I should do: "<title>" (<period>).`
- **States:**
  - limitations in an info note;
  - empty state "Nothing needs your attention for this period";
  - loading skeleton;
  - ErrorState with retry.
- Light and dark modes come from the tokens.

- [ ] **Step 1:** Write `assistant-bridge.test.ts`:
  - `askAssistant('x')` calls a registered handler once with `'x'`;
  - unsubscribing stops further calls.

  Extend `bundle-imports.test.ts` with `'components/insights-ai/insights-view.tsx'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @tallywork/web test` and `pnpm --filter @tallywork/web typecheck`: PASS. Then `pnpm --filter @tallywork/web build && node apps/web/scripts/check-bundle-budget.mjs`: no route over 250 KB.
- [ ] **Step 5:** Commit `feat(web): AI Insights page and Ask WorkPulse AI bridge`.

### Task 8: E2E, documentation and full verification

**Files:**
- Create: `e2e/tests/web/ai-insights.spec.ts`
- Modify:
  - `quality-gates.json` (`web/ai-insights` in gate 2; the new Vitest files: domain `insights-compare`, `insights-timesheets`, `insights-workforce`, `insights-projects` in gate 2; api `insights` and `assistant-insight-tools` in gate 1)
  - `e2e/tests/web/a11y-sweep.spec.ts` and `mobile-sweep.spec.ts` (add `/ai-insights`)
  - `README.md` (a feature entry with the date)
  - `docs/plan/08-decisions.md` (ADR-135: "Insights are computed, AI explains")
  - `packages/domain/src/help/content.ts` (a help article "AI Insights", so the assistant can find it)

The E2E tests:
1. **`@smoke`:** the admin opens AI Insights.
   - Overview shows a period, cards with basis badges, or the empty state.
   - Switching to Workforce shows a `hours_trend` card.
   - "Ask WorkPulse AI" on a card opens the panel with a streamed answer containing "Here is what I found".
2. The Timesheets tab shows `missing_timesheets` for the run's org: the newcomer has no submitted timesheet.
3. The Projects tab with a HOURS budget at 90 % created through the API shows a "near its budget" card linking to budgets.
4. The team manager sees only Design-team names (assert the admin-only team's name is absent).
5. The viewer custom role (no `org:read`) sees "Restricted", and the API answers 403.
6. Error and retry: route `**/assistant/insights/**` to 500 once.
7. The AI is unavailable: the assistant answer fails (`error-test` question) while the page's findings still render.
8. The report runner's "Ask WorkPulse AI" button sends a summary question, and the answer contains "Here is what I found".
9. Dark mode: `page.emulateMedia({ colorScheme: 'dark' })` and an axe scan has no serious violations.

- [ ] **Step 1:** Write the spec.
- [ ] **Step 2:** `pnpm test:e2e e2e/tests/web/ai-insights.spec.ts`. Fix within scope.
- [ ] **Step 3:** Run `pnpm typecheck`, `pnpm test` and `pnpm test:e2e`, then `node scripts/quality-gates.mjs check`. Record the pass/fail counts and compare with the baseline.
- [ ] **Step 4:** Commit `test(e2e): AI Insights; docs: ADR-135 and help article`.
- [ ] **Step 5:** Report the real results, and name what could not be run (the live Anthropic path is covered only by the injected-client unit test).
