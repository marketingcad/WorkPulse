# WorkPulse AI Intelligence: inspection, gap analysis and roadmap

Date: 10 November 2026. Source of truth: the code on `main` at 1599987 (after PR #114, the AI assistant, and PR #115).

## 1. What exists today

### The AI assistant (PR #114)
- **Chat:** a side panel opened by the ✨ launcher; conversations are private to the member, kept 90 days (`AI_CONVERSATIONS` retention), streamed over SSE.
  Routes: `packages/api/src/routes/assistant.ts`, mounted at `/orgs/:orgId/assistant`, rate limited in `app.ts` (`assistant:crud` 120/min, `assistant:msg` 20/min, `assistant:day` 300/day).
- **Who:** `mayUseAssistant` (`services/assistant/access.ts`): a signed-in user (never an API key or device), not desktop-only, holding `org:read`.
- **Provider:** `lib/ai/provider.ts` (`AiProvider.streamTurn`, Anthropic + a deterministic `FakeProvider` used by Vitest and E2E). The model is configurable (`ASSISTANT_MODEL`); without `ANTHROPIC_API_KEY` the assistant is hidden.
- **Tools** (`services/assistant/tools/*.ts`, 12, all read-only): each has `allowed(actor)` (never offered without the permission), Zod input, runs in its own tenant transaction through existing scoped services, and returns an **allowlisted** object (`redact.ts`) capped at 8 KB.
  Tools: docs, navigation, overview, members, live, hours, approvals, timesheet status, projects, budgets, teams, time off.
- **Navigation:** links only from the allowlist `NAV_TARGETS` (`packages/domain/src/assistant/navigation.ts`), gated like the sidebar.

### Deterministic services the new features can reuse (no new arithmetic needed)
| Need | Existing service |
|---|---|
| Hours by member/day, billable, manual | `timeEntryTotals` (timesheets.ts:160), `insights` (insights.ts:21), report `time-activity` |
| Period comparison | Only the dashboard `tracked_week` widget (dashboard.ts:170). **Reports do not compare periods.** |
| Overtime | `splitOvertime`/`overtimeByDay` (domain/workforce.ts), `overtimeInRange` (pay-figures.ts:141, tx-only), `getOvertimeRules` |
| Timesheet review signals | `approvalQueue` flags: `high_manual`, `under_expected`, `over_expected`, `low_activity`, `late_time`, `needs_review` (timesheets.ts:994) |
| Missing timesheets | Assistant tool `timesheet-status.ts` (no service); payroll report `NOT_SUBMITTED` |
| Overlaps / duplicates | **Write-time only** (`assertNoOverlap`, tracking trims). No read-side detector. Pure helper `overlaps()` in domain/time.ts:154 |
| Attendance vs schedule | `listAttendance`/`pageAttendance` (operations.ts:282/299): late, early leave, overtime vs scheduled |
| Budgets | `listBudgets` (finance.ts:336): spent, remaining, pct_used, state, **projected** (linear burn); money hidden without `billing:read`/`rates:read` |
| Tasks, milestones | `listTasks`/`pageTasks` (work.ts:596): due_date, estimate, tracked, completed_at; `listMilestones` (performance.ts:149) with `on_time` |
| Project health | Only inside `performanceOverview` (leaderboards.ts:409): ON_TRACK / AT_RISK / DONE |
| Performance score | `memberScore` (performance.ts:311): score, coverage, parts per metric, inputs; `computeScore`, weights 30/25/20/15/10, snapshots, `leaderboard` movement and trend, visibility rules; `listReviews` **includes `private_note`**, `sharedReviewsFor` does not |
| Payroll | runs, lines, `priceEntries`; `payroll:read` is org-only. **No period comparison or forecast.** |
| Billing | `pageInvoices` summary (outstanding, overdue, collected), `pagePayments`, `amountsOwed`, report `billing` |
| Notifications | `notify()` (notify.ts:16) with per-type preferences; dedup tables (`reminder_sends`, `digest_sends`); free-string types; daily digest built with each member's own actor (`loadActor`) |
| Client portal | `portalSummary`, `portalInsights`: delivery facts only, `(deps, access)`, every view audited |
| Expenses | `category` is free text; the UI suggests 8 categories; **no expense edit flow** |
| Emails | `renderEmail`; every existing email sends immediately. **No announcements feature.** |
| Jobs | outbox `dispatchOutbox`, `runTick` (minute), `runDaily` (per org, isolated steps) |

## 2. Gap analysis

| Feature | Status | Gap |
|---|---|---|
| A Workforce insights | Partial (hours, approvals, time-off tools) | Period-over-period comparison, overtime trend per team, consistency change, structured findings |
| B Timesheet review | Partial (approval-queue flags) | Read-side overlap and duplicate detection, change vs previous period, explanations, links |
| C Project risk | Partial (budgets with projection, tasks, milestones) | A per-project health finding combining budget, burn, overdue tasks and milestones |
| D Payroll & billing | Missing in AI | Finance tools behind `payroll:read` / `invoices:read`, period comparison from stored runs, forecast from approved-to-date (labelled estimate) |
| E Report generator | Missing in AI | A tool that runs an existing report (same permission and filters) and summarizes its returned rows |
| F Performance explanations | Missing in AI | A tool over `memberScore`/`teamPerformance` honoring visibility; never `private_note` |
| G Workload & capacity | Missing | Scheduled hours vs approved time off vs assigned work per team |
| H Help Center | **Exists** (`searchWorkPulseDocumentation` over the Help Center articles) | Optional: article links in answers (already returned) |
| I Client portal summaries | Missing | Portal principal is not a member: needs a separate, portal-scoped path over `portalInsights` facts only |
| J Workflow automation (assistive) | Partial (approval queue) | Prioritized review queue, expense category suggestions, reminder drafts |
| K Content generation | Missing | Draft endpoint (never sends); announcements do not exist as a feature |
| L Intelligent notifications | Partial (typed notifications, digest) | Priority per type (deterministic), grouping, AI digest text on top of deterministic content |
| AI Insights dashboard | Missing | A permission-aware page in the workspace |

## 3. Architecture decision

**Findings are computed, not generated.** Every insight is produced by deterministic code from data the person may already see:
- pure rules in `packages/domain/src/insights/*`;
- data gathered through the existing scoped services in `packages/api/src/services/insights/*`.

A finding carries its metrics, period, references, links and a **basis** (`fact`, `observation`, `estimate`).

The AI is used in two places only:
- as **assistant tools** that return those findings, so the model explains and recommends from them;
- in **"Ask WorkPulse AI"** buttons that open the existing assistant panel with a question about a finding or a report.

Consequences:
- No figure comes from the model.
- The Insights page works when the AI provider is unavailable or not configured.
- Permissions are applied before anything reaches the model.
- No new LLM endpoint, conversation table or provider is introduced.

Persistence: none in Phase 1. Findings are computed on request and cached for 5 minutes in memory, under a key of organization, membership, section and period. A per-member key cannot leak across people or organizations. Dismissal and feedback (a table) come with Phase 2 notifications.

## 4. Roadmap

Each phase gets its own plan when it starts.

- **Phase 1, core intelligence:** A, B, C, E, plus the AI Insights page (Overview, Workforce, Timesheets, Projects). Plan: `docs/superpowers/plans/2026-11-10-ai-intelligence-phase1.md`.
- **Phase 2, administrative productivity:**
  - J: prioritized review queue, expense category suggestion (deterministic keyword rules plus an optional AI suggestion, always user-confirmed), reminder drafts.
  - K: a `POST /assistant/drafts` endpoint returning editable text, never sending.
  - L: a deterministic priority map per notification type, grouping, an insight-backed weekly summary through `notify()` with its own preference type, and dismissal.
- **Phase 3, advanced intelligence:**
  - F performance explanations;
  - D finance insights, behind finance permissions, with sensitive access audited;
  - G workload and capacity.
- **Phase 4, extended:**
  - I client portal summaries: a portal-scoped endpoint over `portalInsights`, no member tools;
  - forecasting refinements.

## 5. Non-negotiables carried into every phase
- Payroll, billing and performance calculations stay authoritative and unchanged. The AI never does official arithmetic.
- The AI never approves or rejects time, never finalizes payroll, never issues invoices, and never changes rates, policies or permissions.
- Keyboard and mouse activity, screenshots and monitoring data are never performance inputs. `private_note` never reaches the model.
- Every tool and endpoint is permission-gated server-side, organization-scoped through RLS, and allowlisted on output.
- The first-load JavaScript budget stays at 250 KB per route. AI interfaces load on demand.
