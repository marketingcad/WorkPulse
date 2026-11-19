# Feature inventory and QA plan, 19 November 2026

Phase 1 of the full QA pass (skill: `.claude/skills/full-qa/SKILL.md`). Built from the code on `main` at `34dec0a`. Results go in [2026-11-19-qa-ledger.md](2026-11-19-qa-ledger.md).

## Baseline

| Item | Value |
|---|---|
| Web pages | 74 (`apps/web/app/**/page.tsx`) |
| API endpoints | about 340, in 10 route groups (org 76, ops-finance 67, insight-platform 57, time 37, performance 30, agent 29, auth 24, assistant 9, portal 7, support 4) |
| Desktop app | one Electron window: Home, Track, Timesheet, My performance, Time off, Schedule, Pay stubs, Settings |
| Automated tests | 322 files, each in a quality gate. Domain 19, DB 9, API 108, web unit 40, desktop 19, Playwright web 94, desktop window 9, real Electron 4 |
| CI on `main` | green (merge of #145, 19 Nov) |
| Stack | Next.js 16 / React 19 web, Hono API with Zod, Drizzle on PostgreSQL (PGlite in tests) with RLS, Electron 44 desktop, Vitest and Playwright |
| Earlier QA | seven audit rounds on production (memory `qa-round3-and-phase6`) and the audits in `docs/audit/` |

## Features

Roles: **SA** System Admin · **TM** Team Manager · **W** Worker (desktop only) · **C** client portal viewer · **K** API key · **S** WorkPulse support staff.

| # | Feature | Pages | Roles | Existing automated coverage | Gaps | Open bugs |
|---|---|---|---|---|---|---|
| 1 | Sign-up, sign-in, verification, password reset, 2FA, sessions | `(auth)/*`, `welcome` | all | API: security-auth, mfa-hardening, email-verification, session-timeouts. E2E: auth, two-factor, qa/public-auth | — | — |
| 2 | Organizations and settings (general, security, time rules, policies, screenshot retention) | `settings/*` | SA | API: new-organization, policy-notice, timesheet-rules. E2E: organizations, tracking-policies, time-rules, screenshot-retention, monitoring-card-setting | Settings › Time negative cases | — |
| 3 | Roles, permissions, access review | `settings/roles`, `settings/access-review` | SA | API: security-authz, access-consistency, route-boundaries. E2E: roles | access review E2E | — |
| 4 | Members, invitations, profiles, teams | `workers/*`, `teams`, `me/profile` | SA, TM | API: invitations, invitation-peek, workforce, staff-profile, people-paging. E2E: invitations, member-profile, profiles, people-paging | Teams page E2E | — |
| 5 | Clients and client folders | `clients`, `projects/folders/*` | SA | API: clients, client-delete, client-folders. E2E: client-delete, client-folders | — | — |
| 6 | Projects, tasks, milestones, documents, revisions | `projects/*`, `tasks` | SA, TM | API: projects-details, work-rules, work-scope, work-integrity. E2E: work-forms, project-milestones | Tasks page as TM | — |
| 7 | Desktop app and devices (sign-in, tracking, offline, enrollment) | `devices`, `download`, `device/authorize` | W, SA | API: agent-*, device-approval, offline-sync, enrollment-tokens. Desktop 19 unit. E2E: desktop/*, electron/*, enrollment-tokens | — | **BUG-23** (Low) "Request sent." for refused manual time · **OBS-R7-2** Submit gives no feedback for 8.5 s · **C-27** task "tracked" total includes other workers |
| 8 | Live tracking, sessions, end-of-day reports | `tracking/live`, `sessions`, `tracking/reports` | SA, TM | API: tracking, breaks-eod, tick-lease. E2E: breaks-eod | **no E2E for Live tracking or Sessions** | — |
| 9 | Activity, screenshots, apps and websites | `activity`, `me/monitoring` | SA, TM, W | API: screenshot-cleanup, multi-monitor. E2E: qa/activity-default, multi-monitor | **no E2E for the Activity page's day view** | **BUG-28** (Med) Activity page mixes time zones |
| 10 | Time entries and manual time | `timesheets/all`, `timesheets/manual`, `timesheets/not-added` | SA, TM, W | API: time-*, refused-time. E2E: time-entries, time-paging, add-time-picker | — | — |
| 11 | Timesheets and approvals | `timesheets`, `timesheets/approvals`, `timesheets/team` | all | API: timesheets, timesheet-entry, confirm-window. E2E: timesheet-decisions, stale-decisions | — | **BUG-24** (Low) Approvals shows a false empty state while loading · **BUG-26** (Low) unpriced time says "Approve timesheets first" |
| 12 | Attendance and schedules | `attendance`, `schedules` | SA, TM | API: ops. E2E: attendance-scheduled, schedules | — | — |
| 13 | Time off | `time-off` | all | API: agent-time-off-cancel. E2E: time-off | — | — |
| 14 | Rates, billing, budgets | `finance/billing`, `finance/budgets` | SA | API: rates-effective-date, finance-calculations, money-*. E2E: budgets, rates-start, finance-figures | — | — |
| 15 | Expenses | `finance/expenses` | SA, TM, W | API: expense-rejection, finance | **no dedicated E2E** | — |
| 16 | Invoices and payments | `finance/invoices/*`, `finance/payments` | SA | API: invoice-*, pdf-documents. E2E: invoices, pdf-documents, document-logo | — | — |
| 17 | Payroll and pay stubs | `finance/payroll/*`, `pay-stubs` | SA, W | API: payroll, money-*. E2E: payroll, desktop/pay-stubs | — | **BUG-32** (Med) payroll pays approved time with no pay rate at $0, with no warning |
| 18 | Reports and exports (saved, scheduled) | `reports/*` | SA, TM | API: reports, invoice-export-filters. E2E: report-exports, data-export, consolidated | — | — |
| 19 | Overview dashboard and Summary | `/o/[orgId]`, `insights` | SA, TM | API: dashboard, insights, perf-budgets. E2E: insights, charts, page-speed | — | **OBS-R7-1** Summary shows new money before new hours |
| 20 | Performance Center | `performance/*` | SA, TM, W | API: performance-*. E2E: performance-* (7) | — | **BUG-31** (Low–Med) Performance pages show daily snapshots with no "as of" time |
| 21 | WorkPulse AI assistant and AI Insights | panel, `ai-insights` | SA, TM | API: assistant-*, ai-insights-*. E2E: assistant, ai-* | — | — |
| 22 | Client portal | `portal/*`, `portal-invite`, `clients/[id]/portal` | C, SA | API: portal, portal-ai-summary. E2E: portal, portal-insights, ai-forecast-portal | — | **BUG-22** (Med) a bad date range leaves the client stuck on an error · **BUG-27** (Low) portal has no main landmark · **C-26** portal counts approved manual time before the timesheet is approved |
| 23 | API keys, webhooks, integrations | `developer/*` | SA, K | API: integrations, route-boundaries. E2E: api-keys, webhooks, qa/settings-integrations | — | — |
| 24 | Audit log, privacy (data export, anonymize), retention | `settings/audit` | SA | API: compliance, audit-*. E2E: data-export | **audit log page E2E** | — |
| 25 | Support console | `support` | S | API: support. E2E: support-console | — | — |
| 26 | Help Center, product tour, calculator, download page | `help`, `download/*` | all | API: help-tutorial. Web unit: help, calculator. E2E: help, help-video, calculator, download | — | — |
| 27 | Notifications and email | bell menu | all | API: notification-priority, mailer, email | — | — |
| 28 | Cross-cutting: navigation, responsive layout, accessibility, page speed | all | all | E2E: navigation*, mobile-*, a11y-sweep, qa/responsive, page-speed; `pnpm test:e2e:audit` | — | — |

## Test order

1. **Features with open bugs, highest severity first:** 22 client portal (BUG-22), 9 activity (BUG-28), 17 payroll (BUG-32), 20 performance (BUG-31), 11 timesheets (BUG-24, BUG-26), 7 desktop (BUG-23, OBS-R7-2, C-27), 22 again (BUG-27).
2. **Coverage gaps:** Live tracking and Sessions (8), Activity day view (9), Expenses (15), Teams (4), audit log (24), access review (3).
3. **The rest**, Gate 1 features (money, time, access) first.

Decisions the user still owes from earlier rounds (C-1 to C-7, C-26, C-27) are noted in the ledger and not changed without an answer.
