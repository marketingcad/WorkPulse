# WorkPulse AI Intelligence, Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advanced intelligence on the same foundation as Phases 1 and 2:
- **F, performance explanations:** why a score moved, and development suggestions;
- **D, payroll and billing insights**, for finance roles only;
- **G, workload and capacity.**

**Architecture:**
- **Same pattern as before.** Pure rules in `packages/domain/src/insights/*` turn data from existing scoped services into `Finding`s, served by AI Insights (new sections `finance` and `capacity`) and read by new assistant tools. The AI explains. It never computes a score, a payroll figure or an invoice amount.
- **Performance** uses `memberScore` and `teamPerformance` exactly as the Performance Center computes them. The scoring rules, weights, snapshots and visibility rules are untouched, and `private_note` is never read.
- **Money** comes only from the existing payroll, invoice, payment and amounts-owed services, in integer minor units with their currency. A forecast is labelled an estimate and is computed by existing pricing (`amountsOwed`), never by the model.

**Tech Stack:** TypeScript, Hono, Drizzle and PGlite, Zod 4, Next.js 16, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-ai-intelligence-gap-analysis.md` (§4 Phase 3) and the product brief (features D, F and G, plus the strict performance and financial rules).

## Global Constraints
- **Builds on `feat/ai-intelligence-p2` (PR #118).** Reuse `getInsights`, `capFindings`, `redactFinding`, the tool pattern, `resolveNav` and the bridge. No new provider, table or conversation storage.
- **Performance:**
  - never activity, keyboard or mouse data, screenshots or monitoring data;
  - never change `computeScore`, the five categories, the weights, snapshots or finalization;
  - never read `listReviews` (it holds `private_note`). Quality is the average rating already in `memberScore.inputs.quality`;
  - respect `assertCanSeeMember` (own scope only when `workersSeeOwnScore`) and leaderboard visibility. No ranks are shown unless the existing service returns them.
- **Finance:**
  - payroll needs `payroll:read` (org only);
  - invoices and payments need `invoices:read` or `payments:read`;
  - "amounts owed" needs `billing:read` or `rates:read`;
  - without these, the section returns no findings and a limitation, and the tool is not offered. Managers without them and client viewers get nothing;
  - money is integer minor units plus currency; amounts in different currencies are never summed;
  - official amounts are the services' own. A forecast is labelled `estimate` and comes from `amountsOwed` (approved time at its approval price, unapproved time at today's effective-dated rate, per `RATE_PRECEDENCE`);
  - every finance insight read is **audited** (`insights.finance_viewed`, metadata: section and period, no amounts).
- **Capacity:**
  - schedules, approved time off and recent tracked hours come only through scoped services;
  - it recommends; it never reassigns anyone.
- **Contracts:** `Metric.unit` gains `'money'`, and an optional `currency` (ISO 4217) is required when the unit is `'money'`. Money values are minor units.
- **Bundle:** new UI loads on demand, and every route stays ≤ 250 KB.
- **Tests:** every new test file goes into `quality-gates.json`. E2E uses the fake provider.

## Review Focus
1. **A team manager, or a custom role without finance permissions, asks for finance insights** (endpoint or tool). The answer is `findings: []` with a limitation, the tool is not offered, no money appears in any output, and nothing is audited as viewed. Test in Task 3.
2. **Payroll runs in two currencies, or a member paid in another currency.** Amounts are never added across currencies; each currency is reported separately. Test in Task 1.
3. **A worker asks about their own score when the organization does not share scores.** The answer is refused (403 or `denied`), as in the Performance Center. A manager cannot explain someone outside their team. Test in Task 2.
4. **No previous period, or a score with too little coverage (`score: null`).** It says so and never invents a change or a driver. Test in Task 1.
5. **A team with no schedules.** No capacity finding is invented; there is a limitation that schedules are missing. Test in Task 1.

---

### Task 1: Domain rules: score explanation, finance, capacity

**Files:**
- Create: `packages/domain/src/insights/performance.ts`, `packages/domain/src/insights/finance.ts`, `packages/domain/src/insights/capacity.ts`
- Modify: `packages/domain/src/insights/types.ts`:
  - `Metric.unit` adds `'money'`;
  - `Metric.currency?: string`;
  - `InsightSection` adds `'finance' | 'capacity' | 'performance'`;
  - `InsightRef.type` adds `'payroll_run' | 'invoice'`.
- Modify: `packages/domain/src/insights/index.ts`, `packages/contracts/src/assistant.ts` (mirror the type changes; a `superRefine` requires `currency` when the unit is `money`)
- Test: `packages/domain/test/insights-performance.test.ts`, `insights-finance.test.ts`, `insights-capacity.test.ts`; extend `packages/contracts/test/assistant.test.ts`

**Interfaces (produces):**
- `explainScore(input: { subject: { type: 'member' | 'team'; id: string; name: string }; period; previous; current: { score: number | null; coverage: number; parts: Record<Metric5, { value: number | null; weight: number; effective_weight: number }>; inputs?: MemberScoreDto['inputs'] }; before: same | null }): { findings: Finding[]; limitations: string[] }`. Section `performance`.
  - `score_change` (observation): score and previous score, with the change. Present only when both scores are non-null.
  - `drivers` (observation): up to 2 parts with the largest `|Δvalue × effective_weight|`, named with the part's label ("Goal completion" …) and their values before and after.
  - `development` (fact): the lowest measured part, with a fixed suggestion per metric:
    - goals → "Agree fewer, clearer goals with due dates";
    - delivery → "Review task estimates and due dates together";
    - consistency → "Submit timesheets every period";
    - quality → "Discuss the last review's points in a 1:1";
    - attendance → "Check the schedule matches when work really starts".
  - Limitations: `'Not enough measured this period to give a score.'` when the score is null; `'No earlier score to compare with.'` when `before` is null or its score is null.
- `financeFindings(input: { period; previous; payroll: null | Array<{ id; periodStart; periodEnd; status; currency; grossMinor; netMinor; overtimeSeconds }>; owedEstimate: null | Array<{ currency; approvedMinor; estimatedMinor }>; billing: null | { currency: string; outstandingMinor; overdueMinor; overdueCount; collectedMinor; previousCollectedMinor } }): { findings: Finding[]; limitations: string[] }`. Section `finance`.
  - `payroll_change` (observation): per currency, the last two FINALIZED or PAID runs' gross, with the change.
  - `overtime_cost_share` (observation): overtime seconds of the latest run against the run before.
  - `payroll_forecast` (**estimate**): the current period's `approvedMinor + estimatedMinor` per currency. The summary starts "Estimated from approved time at its approved price and other time at today's rates".
  - `overdue_invoices` (fact, warning when `overdueCount > 0`).
  - `collections_change` (observation).
  - A `null` input part becomes a limitation ("Payroll insights need payroll access." and so on), never a finding.
  - **Never add across currencies.**
- `capacityFindings(input: { period: next 14 days; teams: Array<{ id; name; scheduledSeconds: number | null; timeOffSeconds: number; recentWeeklySeconds: number | null; openEstimateSeconds: number }> }): { findings: Finding[]; limitations: string[] }`. Section `capacity`.
  - `available = scheduled − timeOff`.
  - `overloaded` (attention, observation): `recentWeekly × 2 > available × 1.15`, or open estimates over `available`.
  - `underused` (info, observation): `available > recentWeekly × 2 × 1.4`.
  - `time_off_dip` (attention, fact): `timeOff > 25 %` of scheduled.
  - `redistribute` (info, **estimate**): when one team is overloaded and another underused, suggest moving work between them. Wording: "could"; never an assignment.
  - A team with `scheduledSeconds: null` gives `'No schedules for <team>; capacity cannot be estimated.'`

- [ ] **Step 1: Write the failing tests:**
  - Score 62 → 70 with the goals part 40 → 80 at an effective weight of 0.3: `drivers` names "Goal completion" first, and `score_change` has a change of +8 points.
  - Score null → the limitation and no `score_change`.
  - `before` null → the "No earlier score" limitation.
  - The `development` suggestion text for the lowest part is the fixed text.
  - Payroll in USD and EUR → two `payroll_change` findings, each with `currency`. No metric sums across them.
  - Forecast `basis:'estimate'`, and the summary starts with "Estimated from approved time".
  - `payroll: null` → the limitation "Payroll insights need payroll access." and no payroll finding.
  - Capacity:
    - recent 60 h/week, available 80 h per 14 days → `overloaded`;
    - recent 10 h/week, available 80 h → `underused`;
    - both teams together → one `redistribute` with `basis:'estimate'`;
    - a team without schedules → its limitation and no finding for it.
  - The contract rejects a `money` metric without a currency.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Domain and contracts tests PASS.
- [ ] **Step 5:** Commit `feat(domain): score explanations, finance and capacity rules`.

### Task 2: Performance explanations (API tool and Performance Center button)

**Files:**
- Modify:
  - `packages/api/src/services/assistant/tools/insights.ts`: `explainPerformance` input `{ from, to, member?: name }`, allowed by `performance:read`.
    - With `member`: resolve the name within scope (as `hours.ts` does), then `memberScore(x, id, from, to)` and `memberScore` for the previous period.
    - Without `member`: the overview from `performanceOverview(x, { period })`, using `score`, `previous_score` and `parts`.
    - Output through `explainScore` and `redactFinding`.
  - `lib/ai/fake.ts` (rule `score` → `explainPerformance`)
  - `apps/web/components/performance/*` (worker profile score card and Overview): an "Explain with WorkPulse AI" button through `askAssistant`, only when `assistant_enabled`
  - `apps/web/components/assistant/messages.ts` (status label)
- Test: `packages/api/test/assistant-performance-tool.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - The admin explaining a member gets `score_change` or a limitation, and the output never contains `private_note` or review text.
  - A team manager cannot explain a member outside their team (`denied` or "no matching member").
  - A worker's own score with `workers_see_own_score: false` → `denied`.
  - The tool is absent without `performance:read`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(assistant): explain performance scores (no private notes, visibility respected)`.

### Task 3: Finance insights (section, tool, audit)

**Files:**
- Modify:
  - `packages/api/src/services/ai-insights/gather.ts` (`financeInputs`)
  - `index.ts` (section `finance`, not part of the overview unless the actor holds `payroll:read` or `invoices:read`; audit `insights.finance_viewed` once per uncached computation)
  - tools: `getFinancialInsights`, allowed by `payroll:read` OR `invoices:read` OR `payments:read` OR `billing:read`
  - `redact.ts` (money metrics pass only from this tool); `fake.ts` (rule `payroll` → `getFinancialInsights`)

**Gathering:**
- `listPayrollRuns(x, { year })` for this year and last year: the latest two FINALIZED or PAID per currency, plus `overtime_seconds` summed from run lines via `getPayrollRun` for those two only;
- `amountsOwed(x, currentPayPeriod)` for the forecast;
- `pageInvoices(x, { page: 1, pageSize: 1 })` summary;
- `pagePayments` totals for this period and the previous one, in the organization's currency only.

- Test: `packages/api/test/ai-insights-finance.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - The admin with one finalized run and one sent overdue invoice gets `overdue_invoices` (warning) and a `payroll_forecast` estimate.
  - A team manager gets `findings: []` and limitations, with no `_minor`, `$`, `money` or currency code in the body.
  - The tool is absent for the manager.
  - An audit row `insights.finance_viewed` exists after the admin's call, and none after the manager's.
  - A custom role with `invoices:read` only gets billing findings and the payroll limitation.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, plus the full API suite.
- [ ] **Step 5:** Commit `feat(ai-insights): payroll and billing insights for finance roles, audited`.

### Task 4: Workload and capacity (section and tool)

**Files:**
- Modify:
  - `gather.ts` (`capacityInputs`):
    - teams the actor manages (or all, for org scope);
    - `listShifts(x, next14days, ids)` summed per team;
    - approved time off hours via `listTimeOffRequests` (hours prorated by days in range; the `hours` field when inside the range);
    - recent weekly hours = `timeEntryTotals` over the last 28 days ÷ 4;
    - open estimates = Σ max(0, estimate − tracked) of open tasks assigned to team members (`listTasks`).
  - `index.ts`: section `capacity`, period = today … today+13. It ignores the requested period and says so in `period`.
  - Tools: `getCapacityInsights`, allowed by `schedules:read` and `time:read` at team or org scope.
- Test: `packages/api/test/ai-insights-capacity.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - A team with schedules of 40 h/week and 70 h tracked last week shows `overloaded`.
  - A manager sees only their team.
  - A team without schedules gives a limitation.
  - The tool is absent for a role without `schedules:read`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ai-insights): workload and capacity for the next two weeks`.

### Task 5: Web tabs and labels

**Files:**
- Modify:
  - `apps/web/components/insights-ai/insights-view.tsx`: tabs "Finance" (shown only when the actor holds `payroll:read`, `invoices:read`, `payments:read` or `billing:read`) and "Capacity";
  - `finding-card.tsx`: money metrics are formatted with `fmtMoney(value, currency)` from `@tallywork/ui`; units come from the metric;
  - `messages.ts`; the assistant status labels.
- Test: extend `apps/web/test/bundle-imports.test.ts` only if a new module is added.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Web tests and typecheck. Build and budget: no route over 250 KB.
- [ ] **Step 3:** Commit `feat(web): Finance and Capacity tabs; money metrics formatted by currency`.

### Task 6: E2E, docs and verification

**Files:**
- Create: `e2e/tests/web/ai-advanced.spec.ts`
- Modify: `quality-gates.json`; `README.md`; `docs/plan/08-decisions.md` (ADR-137); help article "AI Insights: finance and capacity"

**E2E tests:**
1. **`@smoke`:** the admin opens AI Insights › Capacity and sees findings or the "no schedules" limitation.
2. Finance as the admin shows `overdue_invoices` after an invoice is sent with a past due date. Money is shown with its currency.
3. The team manager has no Finance tab, and the API answers with no money.
4. "Explain with WorkPulse AI" on a worker's performance profile opens the panel, and the answer arrives.
5. The viewer role has no AI Insights (existing behaviour, still true).

**Verification:**
- [ ] **Step 1:** Write the spec and run it.
- [ ] **Step 2:** Run `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` (on a fresh server), plus the gates and the budget. Record the counts.
- [ ] **Step 3:** Commit `test(e2e): finance, capacity and performance explanations; docs: ADR-137`.
