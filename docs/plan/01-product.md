# Product: Feature Map, Comparison Matrix, Parity UX Map, Gap Analysis

## 1. Product Feature Map

The map follows the core business flow: **Org → People → Work structure → Tracking → Time → Approval → Money → Insight**. Every node below is a capability the platform must own.

```text
WORKPULSE
├── A. Identity & Organization
│   ├── Sign-up, login, password reset, email verification (optional per deployment)
│   ├── MFA (TOTP now; WebAuthn later), session management, device sessions list
│   ├── Organizations (multi-org users), org switching, ownership transfer
│   ├── Invitations (email link, bulk CSV import), onboarding checklist
│   ├── Roles & permissions (SYSTEM_ADMIN, TEAM_MANAGER, WORKER, AGENT principal; custom roles later)
│   └── Org settings: timezone, week start, currency, locale, pay period, branding
│
├── B. Workforce Structure
│   ├── Workers (membership + profile: title, timezone, pay rate, bill rate, weekly limit, schedule)
│   ├── Teams (manager(s) + members); team-scoped management
│   ├── Clients (contacts, billing details, budget, rates)
│   ├── Projects (client, members, teams, budget, rates, billable flag, status, archive)
│   └── Tasks (assignees, status, priority, due date, estimate, actual)
│
├── C. Time Tracking
│   ├── Session engine (state machine, one active session per worker)
│   ├── Desktop timer (Electron agent; the only workspace for Workers); web timer for admins/managers who track
│   ├── Work notes per session / time entry
│   ├── Idle detection + idle prompt (keep / discard / reassign)
│   ├── Work breaks (paid/unpaid break types, break policies)
│   ├── Time limits (daily/weekly caps; the agent stops tracking at the limit)
│   └── Tracking reminders (didn't start by X, forgot to stop)
│
├── D. Activity Monitoring (desktop only, policy-controlled)
│   ├── Activity %: keyboard and mouse *frequency* per minute → 10-minute blocks
│   ├── Screenshots (interval, randomized, multi-monitor, blur, delete-with-time)
│   ├── App usage (name, bundle/exe id, duration)
│   ├── URL/domain usage (browser extension; domain-only mode; excluded/sensitive domains)
│   └── Location (Future: GPS, job sites, geofences — mobile clients)
│
├── E. Timesheets
│   ├── Views: daily, weekly, monthly, custom range; calendar & list
│   ├── Manual time (with reason; approval policy)
│   ├── Time edits (split, trim, reassign project/task, delete) → revision history
│   ├── Timesheet periods (by org pay period) + lifecycle DRAFT→SUBMITTED→APPROVED/REJECTED
│   └── Approvals (single, bulk, request changes, with activity context)
│
├── F. Workforce Operations
│   ├── Attendance (clock-in/out derived from tracking; late, early, absent, overtime)
│   ├── Schedules & shifts (recurring, exceptions, availability, expected hours)
│   ├── Time off policies (accrual, balances, carry-over), requests, approvals, holidays
│   └── Team calendar (shifts + time off + holidays)
│
├── G. Finance
│   ├── Rates: effective-dated pay rates and bill rates (worker, project, client, org default)
│   ├── Billable vs non-billable classification
│   ├── Budgets (project, client; hours or money; thresholds; projections)
│   ├── Expenses (receipts, approval, reimbursement, billable pass-through)
│   ├── Invoices (client invoices from approved billable time + expenses; PDF; states)
│   ├── Payments (recorded manually now; provider abstraction for Stripe etc.)
│   └── Amounts owed to workers (payroll-ready; payouts are Future)
│
├── H. Insight
│   ├── Configurable dashboards (All / Me / Worker), role-aware widgets
│   ├── Reports: Time & Activity, Daily Totals, Work Sessions, Apps & URLs, Manual Time,
│   │   Timesheet Approval, Expenses, Work Breaks, Amounts Owed, Payments, Project Budgets,
│   │   Client Budgets, Attendance, Time Off, Billing, Invoices, Audit Log, Payroll export
│   ├── Report builder: filters, group-by, saved reports, scheduled emails, CSV/XLSX/PDF
│   └── Notifications center + email digests
│
├── I. Platform
│   ├── Devices (registration, status, health, revoke, force re-auth, agent version)
│   ├── Tracking policies (org default + team/worker overrides)
│   ├── Data retention policies per data class + cleanup jobs
│   ├── Audit log (who changed what, who *viewed* sensitive media)
│   ├── Public REST API /api/v1, scoped API keys, webhooks
│   └── Integration framework (Future connectors: Jira, Asana, GitHub, QuickBooks, payroll)
│
└── J. Our own SaaS operations (not in the brief; see §19)
    ├── Subscription plans & seat billing for customer orgs
    └── Internal support console (audited, time-limited impersonation)
```

## 2. Feature Comparison Matrix

Priority: **P0** = required for first usable release (MVP), **P1** = required for parity release, **P2** = parity nice-to-have, **F** = future.
Phase numbers refer to [07-roadmap.md](07-roadmap.md).

| Feature | Purpose | Primary user | Dependencies | Priority | Phase |
|---|---|---|---|---|---|
| Auth, orgs, invitations | Tenant + identity foundation | All | — | P0 | 2 |
| RBAC + team scoping | Right data for right role | All | Auth | P0 | 2 |
| Workers & worker profile | Person-in-org record, rates, TZ | Admin | RBAC | P0 | 3 |
| Teams | Manager scope boundary | Admin, Manager | Workers | P0 | 3 |
| Clients | Billing parent of projects | Admin | Orgs | P0 | 3 |
| Projects | Unit of work + budget | Admin, Manager | Clients (optional) | P0 | 3 |
| Tasks | Granular tracked work | All | Projects | P0 | 3 |
| Tracking policies | Per-org/team/worker monitoring rules | Admin | Teams | P0 | 3 |
| Session engine | Authoritative timer state | System | Projects, Tasks | P0 | 4 |
| Web timer | Track without the desktop agent | Admin, Manager (Workers are desktop-only, ADR-128) | Session engine | P0 | 4 |
| Time entries + revisions | Canonical time record | System | Session engine | P0 | 4 |
| Electron agent core | Desktop timer, offline queue | Worker | Session engine, Devices | P0 | 5 |
| Device registration | Trusted agent principal | Worker, Admin | Auth | P0 | 5 |
| Activity % | Input-frequency signal | Manager | Agent | P0 | 6 |
| Idle detection + prompt | Accurate time | Worker, Manager | Agent, Policies | P0 | 6 |
| Screenshots | Visual work verification (optional) | Manager | Agent, S3, Policies | P0 | 6 |
| App tracking | What tools time went to | Manager | Agent | P1 | 6 |
| URL tracking | What sites time went to | Manager | Agent + browser extension | P1 | 6 |
| Activity page (Screenshots/Apps/URLs) | Review workflow | Manager | Activity data | P0 | 6 |
| Timesheets (views) | Worker/period time summary | All | Time entries | P0 | 7 |
| Manual time | Record untracked work | Worker | Time entries, Policies | P0 | 7 |
| Time edits | Correct mistakes, audited | Worker, Manager | Revisions | P0 | 7 |
| Timesheet approval | Lock time before billing/pay | Manager | Timesheets | P0 | 7 |
| Attendance | Clock-in/out, late, absent | Manager, Admin | Schedules, Time entries | P1 | 8 |
| Schedules & shifts | Expected hours | Manager | Workers | P1 | 8 |
| Weekly/daily limits | Cost control | Admin | Session engine | P1 | 8 |
| Time off & PTO | Leave management | Worker, Manager | Policies, Calendar | P1 | 8 |
| Holidays | Non-working days | Admin | Time off | P1 | 8 |
| Rates (pay/bill) | Cost & revenue | Admin | Workers, Projects | P0 | 9 |
| Billable classification | Revenue accuracy | Admin | Rates | P0 | 9 |
| Budgets | Spend control | Admin, Manager | Rates | P1 | 9 |
| Expenses | Reimbursable/billable costs | Worker, Admin | S3, Approvals | P1 | 9 |
| Invoices + PDF | Bill clients | Admin | Approved billable time | P1 | 9 |
| Payments (record + abstraction) | Track receivables | Admin | Invoices | P1 | 9 |
| Amounts owed | Payroll readiness | Admin | Pay rates, approvals | P1 | 9 |
| Dashboards (3 roles) | At-a-glance operations | All | Rollups | P0 | 10 |
| Widget customization | Personal dashboards | All | Dashboards | P1 | 10 |
| Report engine + 17 reports | Business intelligence | Admin, Manager | Rollups | P0 (core 5) / P1 (rest) | 11 |
| Exports CSV/XLSX/PDF | Offline analysis | Admin | Report engine | P1 | 11 |
| Saved + scheduled reports | Recurring insight | Admin | Report engine, Email | P1 | 11 |
| Payroll export | Hand-off to payroll providers | Admin | Approvals, Time off | P1 | 11 |
| Notifications (in-app, email) | Timely action | All | Event bus | P0 (core) / P1 | 4→10 |
| API keys (scoped) | Integrations | Admin | API | P1 | 12 |
| Webhooks | Push integrations | Admin | Event bus | P1 | 12 |
| Audit log | Accountability | Admin | Everything | P0 (write) / P1 (UI) | 2→13 |
| Retention policies | Privacy/compliance | Admin | Jobs | P1 | 13 |
| Security settings (MFA enforce, session TTL, IP allowlist) | Org security | Admin | Auth | P1 | 13 |
| Location / GPS / geofences | Field workforce | Manager | Mobile clients | F | Future |
| Mobile apps (iOS/Android) | Track on the go | Worker | API | F | Future |
| PM integrations | Two-way task sync | Admin | Integration framework | F | Future |
| Worker payouts | Pay workers | Admin | Payment providers | F | Future |
| SSO (SAML/OIDC), SCIM | Enterprise identity | Admin | Auth | F | Future |
| Kiosk clock-in | Shared-device attendance | Worker | Attendance | F | Future |
| Productivity classification (org-defined) | Opt-in app/URL ratings | Admin | Apps/URLs | P2 | 11+ |

## 14. Parity UX Map

For each area: the **workflow a Hubstaff user expects**, followed by **our original implementation**. The layouts are our own. We reuse the familiar mental model, not the visuals.

### Time tracking (desktop)
- **Expected workflow:** open the app → pick a project (with search) → optionally pick a task → press play → the timer runs → press stop. Today's total is always visible. An idle prompt appears when you return.
- **Ours:** a compact 360×560 window. **Top:** org switcher and a *tracking-state pill* (Tracking / Paused / Stopped, colour plus text). **Body:** a single *command field* that searches projects and tasks together (`proj / task` fuzzy matching), recent pairs below it, a large tabular-figure timer, and one primary button whose label is the action ("Start tracking" / "Stop tracking"). **Footer:** Today · This week · Limit remaining · Activity dot. The tray/menu-bar icon shows the elapsed time, and the tray menu offers start/stop and recent projects. The idle prompt is a modal sheet: "You were idle 12m (09:35–09:47). Keep / Discard / Assign to other task".

### Web timer
- **Expected workflow:** from the dashboard, start a timer on a project/task.
- **Ours:** (for admins and managers who track; Workers use the desktop app only, ADR-128) a persistent *timer bar* in the top bar across all pages (project/task combobox, play/stop, elapsed time). It is visible on every page, so the worker never navigates away to stop. A "Web" source badge marks entries with no screenshots or activity. If the desktop agent is also running, the bar mirrors its state live over SSE.

### Activity review
- **Expected workflow:** Activity → Screenshots. Pick a date and member, see hourly rows of 10-minute blocks, each with a screenshot, activity %, project/task, and notes. Click to enlarge. Filter by activity level. Apps/URLs tabs.
- **Ours:** a three-pane *Review* layout.
  - **Left rail:** a mini calendar with per-day tracked-hours heat, and a member list with live status dots.
  - **Centre:** a *day timeline ribbon* (24h strip coloured by project, idle gaps hatched), then hour rows of 6 block tiles. Each tile holds the thumbnail, an activity bar (keyboard vs mouse split), the project chip, and a flag icon for low activity, manual, or idle.
  - **Right:** a detail drawer with the full screenshot, the session, apps/URLs in that block, and notes. Actions depend on permission: delete screenshot (optionally removes that time), open session, open timesheet day.
  - **Keyboard:** `←/→` block, `↑/↓` hour, `[`/`]` day, `J/K` member.

### Timesheets
- **Expected workflow:** weekly grid of days × projects with totals, a daily list with start/stop entries, add/edit time, submit, approve.
- **Ours:** `View & Edit` has three tabs:
  - **Week grid:** rows are project/task, columns are days, cells show duration. Click a cell to open that day's entries.
  - **Day list:** the entry timeline with start–end, source badge, edit/split/reassign.
  - **Calendar:** a drag-to-create manual-time view.

  Each edit asks for a reason when policy requires one and writes a revision. The *Approvals* page is a queue of worker-periods showing total, variance vs schedule, manual %, avg activity, and flags. Bulk approve, reject with comment, and "request changes" are available. Each row opens a side-by-side panel with the timesheet and its activity context.

### Projects & tasks
- **Expected workflow:** a project list with budget progress, members, and archive. Tasks per project, assigned to members, visible in the timer.
- **Ours:** a project list table with budget bars and status. The project detail has tabs: Overview (budget burn chart, top workers, recent activity), Tasks (table + simple board), Members & Teams, Rates, Settings. Tasks are table-first (inline status/assignee edits); the board view is P2.

### Attendance, schedules, time off
- **Expected workflow:** shifts per member, late/missed alerts, attendance report; time-off requests with balances and approval.
- **Ours:** *Schedules* is a team week view (rows = members, shift blocks, time-off overlays, holiday columns). *Attendance* is a daily roster: Scheduled · Clocked in · Late by · Left early · Worked · Status chip. *Time Off* has My balances + Request, a Requests queue, and a team calendar.

### Finance
- **Expected workflow:** see amounts owed, create a client invoice from tracked hours, record a payment, track budgets.
- **Ours:** an *Invoice composer* in four steps: choose client and period → pick approved billable entries grouped by project/task/worker (preview) → add expenses and ad-hoc lines → review, tax, due date → PDF preview → mark sent. Payments are recorded against invoices (partial allowed). The Budgets page is a table of project and client budgets with threshold states and a projected overrun date.

### Reports
- **Expected workflow:** pick a report, set a date range and filters, see summary and table, export.
- **Ours:** a report catalog grouped by question ("Where did time go?", "What do we owe?", …). Each report uses one template: header → filter bar → group-by chips → KPI summary strip → one purposeful chart → data table → Export / Save / Schedule.

### Dashboards
- **Expected workflow:** widgets for today/week totals, activity, members working, pending approvals, budgets.
- **Ours:** a 12-column widget grid with scope tabs (All / Me / a picked worker). An "Edit layout" mode offers drag, resize (S/M/L presets), hide/show, and per-widget settings. Every widget links to the full page or report behind it.

### Settings & policies
- **Expected workflow:** org settings; per-member overrides for screenshots, idle, limits, apps/URLs.
- **Ours:** a *Policy editor* showing inheritance: Org default → Team → Worker. Each overridden field shows where its value comes from ("inherited from Org"), with a reset button. Changing a monitoring policy triggers a notice to affected workers (transparency requirement).

## 19. Feature Gap Analysis

These items are required, or very likely expected, for true parity with a mature workforce platform but are **not fully specified in the brief**. They are listed here so nothing is silently omitted.

| # | Gap | Why it matters | Proposed handling | Phase |
|---|---|---|---|---|
| G1 | **Own SaaS subscription billing** (plans, seats, trials, dunning) | The product has to charge its customers. This is separate from invoicing *their* clients. | `subscriptions` module + Stripe Billing. Plan gates are enforced as feature flags per org. | 12–14 |
| G2 | **Platform super-admin / support console** | Customer support needs a safe way to investigate issues | A separate internal app. Impersonation is read-only by default, time-boxed, reason required, audited, and visible to the org. | 14 |
| G3 | **Org owner** role distinct from admins | Ownership transfer, billing, and org deletion need one accountable person | Owner flag on one SYSTEM_ADMIN membership | 2 |
| G4 | **Project Manager, Viewer, Client** roles | Common intermediate roles | The custom-role engine ships these as presets | 13 / Future |
| G5 | **Browser extension** for URL tracking | Reading URLs from window titles is unreliable. OS APIs differ per platform, and on Linux they barely work. | A Chrome/Edge/Firefox extension talks to the agent via Native Messaging. It only reports while a session is ACTIVE. | 6 (Chrome/Edge), 12 (Firefox) |
| G6 | **Linux Wayland limitations** | On Wayland, screenshots and active-window detection need portals or are unavailable | Capability detection: the agent reports `capabilities` to the server and the UI shows "not supported on this device". Fully supported on X11. Built: on Wayland the `wayland` capability marks activity, apps and screenshots unavailable instead of recording partial data (ADR-132). | 5–6 |
| G7 | **Mobile apps** (timer + GPS) | Field teams; GPS depends on mobile | The API is designed mobile-ready now. React Native app later. The Location subsystem is designed now and ships with mobile. | Future |
| G8 | **PM tool integrations** (Jira, Asana, Trello, GitHub, Linear) | Many teams track against external tasks | Integration framework: `integration_connections`, `external_refs` on tasks, sync jobs | Future (framework 12) |
| G9 | **Accounting integrations** (QuickBooks, Xero) | Invoice/payment sync | Behind the payments/invoices abstraction | Future |
| G10 | **Worker payouts** (Wise, PayPal, Payoneer, ACH) | Paying contractors | `payouts` module behind a provider interface. Payroll-ready data exists first. | Future |
| G11 | **Pay periods & overtime rules** | Payroll accuracy (weekly OT > 40h, daily OT, jurisdiction rules) | `pay_period` config on org. Overtime rule sets (configurable, not hard-coded). | 8 |
| G12 | **Work-break policies** | Break reminders, paid vs unpaid breaks, the Work Breaks report | `break_types` + break sessions (a session kind) | 8 |
| G13 | **Shift alerts** (late, missed shift, forgot to stop) | Manager attention | Scheduled evaluator job → notifications | 8 |
| G14 | **Kiosk / shared-device clock-in** | Hourly/shift workers without their own device | PIN-based kiosk mode in the web app | Future |
| G15 | **SSO (SAML/OIDC) + SCIM** | Enterprise requirement | Auth module designed with pluggable identity providers | Future |
| G16 | **Data export & DSAR / account deletion** | GDPR/CCPA rights | Per-worker export job; anonymize-on-delete strategy | 13 |
| G17 | **Monitoring consent & jurisdiction notices** | Legal: GDPR, NY Electronic Monitoring Law, works councils | Worker consent acknowledgement on first agent run and on each policy change, stored with policy version | 5–6 |
| G18 | **Localization, timezones, currencies** | Global teams | i18n from day one (ICU messages), per-worker TZ, org currency + per-client currency on invoices | 2 (infra), 14 (translations) |
| G19 | **Opt-in productivity classification** | Users often want "productive/unproductive" ratings | The brief says never auto-label. The org *may* define categories; the default is none; the UI names the rating as org-defined. | P2 |
| G20 | **Unusual-activity / insights** (anomaly flags) | Parity with modern "insights" features | Deterministic rules first (e.g. activity pinned at 100% for 30 minutes = possible input simulator). ML later. | Future |
| G21 | **Screenshot self-service for workers** | Workers can see, and optionally delete, their own screenshots | Policy flag `worker_can_delete_screenshots` + `delete_removes_time` | 6 |
| G22 | **Offline manual time on desktop** | Record time while offline | Queued `manual_time.requested` command | 7 |
| G23 | **Invoice numbering, tax rates, multi-tax** | Real invoicing | Configurable sequences per org; tax rate catalog | 9 |
| G24 | **Email deliverability & templates** | Notifications must arrive | `Mailer` provider abstraction: Resend or SMTP today, console in dev (ADR-126); Postmark/SES can be added behind it. Per-org sender name, bounce handling and a custom sending domain are still to do. | 4 / 10 |
| G25 | **Agent distribution & MDM deployment** | Admins roll the agent out to fleets | Built: GitHub Releases with stable installer names, a `/download` page, auto-update, and managed settings (registry / configuration profile) for silent installs (ADR-131, [desktop-deployment.md](../ops/desktop-deployment.md)). Still to do: code signing, published MSI/PKG, org enrollment token. | 14 |
