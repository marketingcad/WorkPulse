# WorkPulse — Feature, Flow & UX Simplification Audit

_2026-09-30 · read-only audit of the current working tree (including uncommitted changes) · no code changed_

**Goal:** make the product simpler and clearer without losing needed business functionality. Recommendations favour merging, renaming, re-gating and fixing over adding. New capability is proposed only where an existing flow dead-ends.

Paths: `W/` = `apps/web/app/o/[orgId]/`, `API/` = `packages/api/src/`, `D/` = `apps/desktop/src/`.

---

## 0. Executive summary

The product is broad and mostly well built. Loading, empty and error states and confirm dialogs are generally present, the authorization matrix is test-enforced, and RLS is solid. The complexity comes from **overlap**, not from missing features.

1. **Workers have no web app, but a lot of web UI was built for them.** Anyone without a team/org-scope grant is redirected to `/download` (`W/layout.tsx:37-40`, `packages/domain/src/permissions.ts:170`). These things are unreachable for workers:
   - Pay stubs, My timesheet and "What is monitored"
   - all `workerLabel` nav labels and every `!isManagerView` branch
   - the payroll "your pay stub is ready" notification link

   The desktop app has no pay stubs, bank details, expenses, profile or entry editing. It even says "review your own activity and screenshots on the web" (`D/renderer/src/App.tsx:280`). **This is the largest dead end in the product.**
2. **Time has five overlapping management pages:**
   - My timesheet
   - All time entries
   - View & edit
   - Approvals
   - Manual time

   Sessions, Activity and Live also show tracked time. The approval queue and the manual-time queue are separate, and that causes a real dead end: manual time for a submitted period cannot be approved (`API/services/timesheets.ts:480`).
3. **Money has no single definition.**
   - "What we owe staff" has four figures: Overview Wage, Billing "Estimated owed", Reports earnings, and Payroll gross.
   - "Billable amount" has three: Insights prices at current rates, invoices use approved snapshots, and the Billing report is a hybrid.
   - "Outstanding" has two that disagree across currencies.
4. **Rates can be edited in four places:** Billing, the client dialog, the project form and the member profile. They use different hints and currency behaviour. The Billing page shows the **wrong PAY precedence**: it omits CLIENT, while the engine includes it (`W/finance/billing/page.tsx:40-43` vs `packages/domain/src/billing.ts:28`).
5. **Nav and page permissions disagree.**
   - Teams, Clients and Tracking policies are hidden from Team Managers, although the page and the API allow them read access.
   - `GET /roles` has no permission check (`API/services/org.ts:98`).
   - `members:read_pay_rate` is never enforced.
   - Reports appear in the catalogue and then 403 when run.
6. **Settings are split along permission lines, not by how admins think.** Timesheet rules are split between Organization and Tracking policies. Screenshot capture is under Policies, but screenshot retention is under Security. Developer is a top-level group for two rarely used pages.
7. **Reports duplicate list pages and silently ignore filters.** There are 18 reports; about 8 repeat an existing page. The runner shows every filter for every report, while many reports ignore some of them (`API/services/reports.ts`).
8. **Concrete bugs found along the way** are in §9. Examples: budget edit resets its settings; two notification links 404; the History drawer on All time entries shows raw IDs; bulk actions send no reason.

Suggested outcome: the admin nav goes from **36 items / 9 groups to about 24 items / 6 groups**, with no business capability removed.

---

## 1. System overview (as built)

| Area | Implementation |
|---|---|
| Web | Next.js App Router; every org page is `'use client'`; `OrgProvider` + `AppShell` in `W/layout.tsx`; TanStack Query via `useOrgQuery` / `useOrgMutation` (`apps/web/lib/api.ts`); SSE only on Overview + Live |
| API | Hono (`API/app.ts`); `authenticate` → `tenant` middleware; thin routes (6 files), logic in services with `Ctx`; scope helpers in `API/services/scope.ts` |
| AuthZ | 62 permissions × scopes own/assigned/team/org; presets SYSTEM_ADMIN, TEAM_MANAGER, WORKER, AGENT (`permissions.ts:84-158`); enforced partly by `requirePermission` (~20 routes), mostly inside services (~90 ad-hoc checks, plus `need()` / `assertCan` styles) |
| DB | Postgres + Drizzle, FORCE RLS on every tenant table (`app.org_id` / `app.bypass_rls`), 17 migrations, RLS test |
| Auth | Session cookie + CSRF origin check, TOTP MFA + recovery codes, org-enforced MFA, device bearer tokens (`/device/authorize`), API keys |
| Desktop | Electron; zod-validated IPC allowlist (`D/shared/ipc.ts`); timer, idle prompts, manual time (start–end only), read-only timesheet + submit, time off, schedule, monitoring acknowledgement |
| Extension | Chrome MV3; only reports the active tab URL to the local desktop app. No time capture, no overlap |
| Jobs | Outbox pattern (`API/jobs/index.ts`): per-minute tick (sessions, alerts, report schedules/exports, device offline, webhooks, integration syncs) and daily (retention, accruals, reconcile, overdue invoices, digests) |
| Other | Storage (Blob/Supabase/File/Memory), mail (Resend/SMTP), in-app notifications (30 s poll) + opt-in digest, webhooks, integrations registry (no providers registered) |
| Tests | 25 API files, RLS, domain (including the matrix-drift test), ui, desktop. **No web / e2e tests** |
| Design system | `packages/ui` (PageHeader, DataTable, FilterBar, Dialog/ConfirmDialog/Drawer, Empty/Error/Permission states, formatters); conventions in `docs/web-conventions.md`; i18n covers only nav, shell and profile (14 of 104 web files) |

**Core entity chain:** Organization → Membership (the "member/worker") → Team (team-role MANAGER/MEMBER) → Client → Project (members/teams assigned) → Task. Tracking produces a Session, then Time entries. Time entries roll up into daily rollups and a Timesheet per pay period (submit → approve snapshots pay/bill amounts). Approved amounts feed Invoices, Payroll runs and Pay stubs. Schedules, Time off and Attendance sit beside timesheets. Policies (Org → Team → Member) drive what the desktop captures (activity, screenshots, apps/URLs).

---

## 2. Application map (current)

```text
WorkPulse
├── Public / auth
│   ├── Login · Signup · Forgot / Reset password · Verify email
│   ├── Invite (accept) · Welcome (new org) · Download (desktop) · Device authorize
│   └── Support (internal staff tool)
├── Web app (/o/:org) — admins, managers, custom team/org roles only
│   ├── (top) Overview · My timesheet · Pay stubs
│   ├── Workspace: Members (/workers, /workers/:id) · Teams · Clients · Projects (/projects/:id) · Tasks
│   ├── Tracking: Live · Activity · Sessions · Devices
│   ├── Timesheets: All time entries · View & edit · Approvals · Manual time
│   ├── People: Attendance · Schedules · Time off
│   ├── Finance: Billing & rates · Budgets · Expenses · Invoices (/new, /:id) · Payments · Payroll (/:id)
│   ├── Insights: Insights · Reports (/reports/:key, saved, exports)
│   ├── Developer: API keys · Webhooks
│   ├── Settings: Organization · Tracking policies · Roles & permissions · Security & retention · Access review · Audit log · What is monitored
│   └── User menu: Profile & devices (/me/profile) · theme · sign out   |   Bell: notifications
├── Desktop app — workers (and anyone tracking)
│   └── Home/Dashboard · Time tracking (timer, manual time) · Timesheet (read-only + submit) · Time off · Schedule · What is monitored
└── Browser extension — active-URL helper for the desktop app
```

---

## 3. Roles and what they see

| | System admin | Team manager | Worker / Agent |
|---|---|---|---|
| Web nav | 36 items / 9 groups | 22 items / 8 groups | none (redirected to `/download`) |
| Hidden although allowed | — | Teams, Clients, Tracking policies (nav needs `*:manage`, page/API need `*:read`) | everything |
| Shown but weak | My timesheet and Pay stubs, even when untracked or not on payroll | Budgets (read-only, often empty), Devices (read-only), Settings group holding only "What is monitored" | — |

A second trap: the Team Manager **role** sees nobody unless the person is also a team member with team-role **MANAGER** (`API/middleware/tenant.ts:71`). The invite dialog cannot set the team role (`W/workers/page.tsx:340-344`), and invites default to MEMBER. So an invited manager lands on empty pages.

---

## 4. Page audit

Classification key: KEEP · SIMPLIFY · MERGE · MOVE · REDESIGN · REMOVE · NBC (needs business clarification).

### Time & tracking

| Page | Purpose / primary action | Main issues | Class |
|---|---|---|---|
| **My timesheet** `/timesheets` | Own period → Submit | Also serves `?member=` (a second URL for the team view). Up to 7 KPI tiles. Server returns entries, then the client re-fetches `/time-entries` and `/insights`. Empty state says "start the timer in the top bar", which isn't there when tracking is off. Nav gate (`timesheets:submit`) ≠ page gate (`timesheets:read`) | SIMPLIFY |
| **All time entries** `/timesheets/all` | Cross-member ledger → find & correct, bulk edit | Entry row and menu copy-pasted from `TimesheetView` and already drifted: no "Edited" badge or activity bar; History drawer gets `names={new Map()}` so shows raw IDs (`all/page.tsx:503`). Add time shown on locked periods. Bulk sends no reason. "Save as report" overlaps Reports | KEEP + SIMPLIFY |
| **View & edit** `/timesheets/team` | Pick member → their sheet + team week table | Summary uses calendar weeks while timesheets use pay periods (they disagree on bi-weekly/semi-monthly). Pulls every raw entry for the team to sum on the client. Sheet renders above the table. Label is a verb. No ErrorState | MERGE → Team timesheets |
| **Approvals** | Approver queue → approve / bulk approve | Pending manual time lives on another page. Overview count includes the manager's own sheet, the queue doesn't. Extra query just for the count | MERGE → Team timesheets |
| **Manual time** | Approve/reject requests; request own | "Request" is the same dialog as Add time. Approved/All tabs duplicate the entry list. API uses `time:read` scope while nav/page use `manual_time:*`. Same icon as All entries | MERGE into the approvals queue |
| **Live** | Who is working now | Copy says "refreshes every 15 seconds" (it's 60 s + SSE). "Idle" also covers paused/break. Empty state names a "Workers" screen that doesn't exist | KEEP (copy fixes) |
| **Activity** | One member's day: blocks, screenshots, apps/URLs | Main tab named "Screenshots". Delete-screenshot-with-time is another way to edit time that bypasses the entry reason/lock UI. Spinner-only loading | SIMPLIFY |
| **Sessions** | Raw sessions and transitions | Diagnostic data at top level. No link to the resulting entries. Wrong empty-state copy | MOVE (to member profile / History drawer / diagnostics) |
| **Devices** | Approve / revoke desktop installs | Device administration, not tracking. The only place an admin would look for the installer, and it says "ask your administrator" | MOVE → Settings; link `/download` |
| **Timer bar** | Web timer for tracked managers | Every start/stop invalidates all org queries | KEEP (narrow invalidation) |

### Workspace & people

| Page | Purpose / primary action | Main issues | Class |
|---|---|---|---|
| **Overview** | "What needs attention?" | 20 widgets that repeat Live, Approvals, Time off, Attendance, Budgets, Invoices, Insights. `current_timer` ignores the scope switch. `my_timesheet` shows the latest row, not the due period. Money not labelled as estimates. `?welcome=1` never read, so no first-run guidance | SIMPLIFY (setup checklist; drop Member scope) |
| **Members** `/workers` | Invite member | Invite cannot assign projects or a team role, so the invitee can't track or manage. Says "We sent an invitation" even when email is off | SIMPLIFY |
| **Member detail** | Edit profile / suspend / remove | 7 tabs: Activity is only a link, Projects is read-only, Policy duplicates `/me/monitoring`. 11-field edit block. Pay/bill always shown in org currency | SIMPLIFY (5 tabs, grouped form, editable projects) |
| **Teams** | New team, members, team roles | Hidden from managers. Copy says "assign from a project's settings" but assignment lives in Members & teams. Nothing explains that team-role Manager is what makes the manager role work | SIMPLIFY (NBC: fold into Members?) |
| **Clients** | New client | 13 fields up front. "Active" duplicates Archive. No client page, so there is no place to start an invoice from a client. Project header client link goes to the unfiltered list | SIMPLIFY |
| **Projects** | New project | ~16-field create form. "Not billable project" double negative. "Completed" status vs Archive. Budget column duplicates Budgets | SIMPLIFY (create with name, client, people) |
| **Project detail** | Tasks, plan, people, documents, settings | Plan & budget repeats Settings (its Edit jumps there). Rates panel shows only the project override, not the effective rate. Two progress bars (estimate vs budget) | SIMPLIFY (Tasks · People · Documents · Settings) |
| **Tasks** | Cross-project task list | Columns and dialogs copied from the project Tasks tab. "Delete task?" actually archives | KEEP (share one TaskTable) |
| **Attendance** | Late / absent today | Read-only derived view; repeats the Overview widget | KEEP (or tab of Schedules) |
| **Schedules** | Weekly shift grid | Holidays shown but managed in Time off. Dead worker branch | SIMPLIFY |
| **Time off** | Requests, calendar, policies | Approvers land on "My time off", not Requests. New orgs have no policy, so Request is disabled. Notifications link to a non-existent route | SIMPLIFY |
| **Pay stubs** | Own stubs & bank details | Unreachable for workers. Shown to admins who aren't on payroll. No page gate | NBC (see §10) |
| **What is monitored** | Transparency for the tracked person | Under "Settings" for every role. One inaccurate promise ("notified before any change takes effect") | MOVE → user menu / Profile |
| **Profile** `/me/profile` | Account, password, 2FA, devices, notifications, data | No name field (API supports it). No "resend verification". Devices duplicated. Preferences miss ~7 notification types that are actually sent | SIMPLIFY |
| **Auth / onboarding** | — | Login ignores last-used org. Signup silently sets USD while Welcome asks for currency. Download step 3 copy is wrong for existing users. Device authorize tells invited workers to "Create an organization" | SIMPLIFY (copy + consistency) |
| Forgot / Reset / Verify / Welcome / Support | — | Fine | KEEP |

### Finance

| Page | Purpose / primary action | Main issues | Class |
|---|---|---|---|
| **Billing & rates** | Set rates; "Amounts owed" | Wrong PAY precedence (no CLIENT), so it can't create client pay rates the client dialog can. Free-text currency. No "effective rate for X on Y" answer. "Amounts owed" is a payroll concept under Billing | REDESIGN → **Rates** (single source of truth + effective-rate lookup) |
| **Budgets** | Set hours/money limits | Edit resets period, warning % and non-billable (the dialog claims the server doesn't return them; it does). "Spent" means billed value. Org currency even when spend is in client currency. Managers see bill amounts without billing permission | SIMPLIFY |
| **Expenses** | Submit / approve / reimburse | No reject reason. Submitter can't edit or withdraw. Total counts only org currency. "Reimburse" is a manual mark, not connected to payroll | SIMPLIFY (NBC: reimburse via payroll?) |
| **Invoices** (+ new, detail) | Invoice approved time | 4-step composer (step 3 is thin). Drafts can't be edited or deleted (API supports delete). Void consumes a number. Send emails the client with no confirm and no PDF/link. No "invoice this client" entry point | SIMPLIFY |
| **Payments** | Client payments log | Duplicates invoice → Record payment. Can't delete a wrong payment, which also blocks Void. Unallocated money can't be applied. Name reads like staff pay | MERGE → Invoices tab "Payments received" |
| **Payroll** (+ run) | Pay groups, runs, finalize, paid | Members without a rate silently get $0. Overtime column shown but never paid. "Any day in the period" picker. "Payroll profiles" jargon | KEEP + SIMPLIFY (absorb "Amounts owed" as a preview) |

### Insights, reports, settings, developer

| Page | Purpose / primary action | Main issues | Class |
|---|---|---|---|
| **Insights** | Hours, pay, bill by person/client/project | Duplicates Overview widgets and Reports; prices at current rates. Top 10 clients only, no filter or drill-down. Own period control. Nav gate ≠ page gate | MERGE (into Reports landing or Overview), or keep as a Reports "summary" |
| **Reports** catalogue | Pick a question | 18 reports. Duplicates: daily-totals ⊂ time-activity, work-breaks ⊂ work-sessions, project/client-budgets identical, plus manual-time, approval, attendance, time-off, invoices, payments, expenses and audit-log copies of list pages. Listed reports can 403 when run | SIMPLIFY (~10 reports; list pages get an Export button instead) |
| **Report runner** | Filter → read → export | Shows all filters; many are silently ignored per report. Two export menus side by side. Default "This week" | SIMPLIFY (per-report filter list, one export menu) |
| **Organization** settings | Workspace defaults | 8 panels with mixed save models (header Save vs "Save overtime" vs dialogs). `budgetWarnPct` saved but never read by the API | REDESIGN (tabs) |
| **Tracking policies** | What is captured, per scope | ~30 fields incl. low-level (heartbeat grace, crash window), a disabled "future" section, `window.confirm`. No "affects N members" or "N acknowledged". Saving notifies *every* tracked member, and the notification can be switched off | SIMPLIFY (Advanced section; affected/acknowledged counts) |
| **Roles & permissions** | Custom roles | 61 × 4 matrix with raw keys. Built-ins locked. No member counts or assignment link | SIMPLIFY |
| **Security & retention** | 2FA, sessions, IP, retention, support access | Retention far from what is captured | MOVE (retention next to monitoring) |
| **Access review** | Read-only 2FA / roles / keys review | Repeats Members, Roles and API keys | MERGE (2FA column on Members; counts on Roles) |
| **Audit log** | Filter audit events | No export (the duplicate report has one). Raw target identifiers | KEEP (+ export; remove audit-log report) |
| **API keys / Webhooks** | Integrations for developers | Good pages; top-level group for rare use | MOVE → Settings › Integrations & API |
| **Integrations API** | `/integrations/*` + sync scheduler | No providers registered, no UI | NBC (build UI or remove) |
| **Notifications bell** | In-app notifications | Clicking doesn't mark as read. Shows "All caught up" while loading. No error state. No full list. 2 links 404 | SIMPLIFY / FIX |

---

## 5. Navigation audit

**Problems**

- **Mismatched names:**
  - Members vs `/workers` vs role WORKER vs "People" group (which holds no people)
  - "View & edit" (a verb)
  - Insights group containing an "Insights" item
  - Timesheets group containing no "Timesheets" item, while "My timesheet" sits at the top level
- **Items in the wrong place:**
  - Personal items (My timesheet, Pay stubs, What is monitored) mixed into the admin tree
  - Settings for a manager containing only "What is monitored"
  - Developer as a top-level group
  - Sessions and Devices (diagnostics/admin) under Tracking
- **Duplicate icon:** `ListChecks` is used for both All time entries and Manual time. Dead code: `filterNav` `&& false` (`nav.ts:158`) and identical branches (`:153-154`).
- **Several nav entries for the same data:**
  - Tracked time: All entries, View & edit, My timesheet, Sessions, Activity
  - Money summaries: Insights, Reports, Billing "Amounts owed", Overview

**Proposed nav (admin), no capability removed**

```text
Overview
Time
  Timesheets        (team table by pay period; drawer = one member's sheet; tabs: Needs approval · All)
                    (includes manual-time requests inline; replaces View & edit + Approvals + Manual time)
  Time entries      (All time entries ledger)
  Live
  Activity
People
  Members           (Teams as a tab/grouping; 2FA column from Access review)
  Schedules         (Attendance as a "Today" tab)
  Time off
Work
  Clients · Projects · Tasks
Money
  Rates · Budgets · Expenses · Invoices (tab: Payments received) · Payroll (tab: Owed / preview)
Reports             (catalogue incl. the Insights summary)
Settings            (single area with tabs)
  General · Company/invoicing profile · Time & timesheets (pay period, locks, overtime, time/break types)
  Monitoring (policies + retention) · Security · Roles & access · Devices · Integrations & API · Audit log
User menu: Profile · My timesheet · Pay stubs · What is monitored  (only when relevant to the person)
```

Result: about 24 visible items in 6 groups for admins (from 36 / 9), and fewer for managers. Sessions moves into the member profile and the entry History drawer.

---

## 6. Key user flows

### 6.1 Worker tracks time and submits
**Current:** desktop sign-in → admin approves the device → pick project → Start → idle prompts → Stop → "Timesheet due" banner → read-only grid → Submit.
**Friction:**
- The worker can't see or fix individual entries before submitting, although they hold `time:edit: own`.
- There's no warning about pending manual requests.
- Time that syncs after submit blocks approval.

**Proposed:** show the entries list on desktop (read-only at minimum) and warn on Submit if requests are pending. Whether workers self-edit is NBC.

### 6.2 Worker adds missing time
**Current:** desktop → Add manual time (start–end only) → "Sent" → manager approves on web.
**Friction:**
- Desktop only knows "Sent" / "Not added"; rejections never come back (no agent endpoint for request status).
- There's no duration mode, although the web has one.
- A submitted period fails with no "ask to reopen" path.

**Proposed:** expose own requests and their status to the agent, reuse duration mode, and give a plain "period is locked — ask your manager" message.

### 6.3 Manager corrects someone's time
**Current:** View & edit → pick member → Entries tab → ⋯ → Edit. If the sheet is submitted: Request changes (the worker can't act on desktop) → Edit → Submit on their behalf → Approve. Alternatively: All time entries → Edit (a different, drifted menu).
**Proposed:** one Timesheets drawer. On a locked sheet, offer **"Unlock to edit"** (reopen with an audit note), then approve. One shared entry row and menu.

### 6.4 Manager approves
**Current:** Approvals → drawer → Approve. Pending manual time for that period is on another page, and approving it after submit throws `timesheet_locked`. `late_time` disables Approve with only a tooltip.
**Proposed:** a single queue where each sheet shows its pending manual requests inline. **"Approve including manual time"** is one transaction; "Include late time and approve" is subject to a business decision.

### 6.5 Admin sets up the workspace and gets a team tracking
**Current:** Signup → empty Overview with no timer (owner tracking off by default) → Projects (16-field form) → Members → Invite (no project, no team role) → invitee installs → "You are not assigned to any project yet". The admin has no link to the installer.
**Proposed:** read `?welcome=1` and show a **setup checklist** on Overview: create a project → invite people *to that project* (with team + Manager toggle) → get the desktop app → optional "track my own time". The invite dialog gains project and team-role fields. These are existing concepts, just exposed where needed.

### 6.6 Set up rates
**Current:** four editors (Billing, client, project, member), inconsistent hints and currency. Client pay rates can't be set from Billing. Non-Billing forms always start the rate today. Multipliers live in Settings under `org:update`.
**Proposed:** **Rates** is the single editor with an "applies to" picker and an **effective-rate preview** ("Ava on Project X on 3 Oct → bill $120 from Project, pay $40 from Member"). Other forms show the effective rate read-only with a link, and time-type multipliers are linked from Rates.

### 6.7 Invoice a client and record payment
**Current:** approve timesheets → Invoices → New (4 steps) → draft (not editable/deletable) → Send (no confirm, plain-text email) → Record payment (on the invoice or in Payments; can't be deleted).
**Proposed:** start from the client (`?client=` already supported) or from the Reports "Ready to invoice" figure. Three steps. Edit/delete drafts (the API already has delete). Confirm Send. Payments become a tab. Allow deleting a payment (the API exists).

### 6.8 Payroll and pay stubs
**Current:** rates → create payroll profile → bank details → approve timesheets → run (pick "any day in the period") → recalc → finalize (notifies) → mark paid → the worker is sent to `/pay-stubs`, which redirects to `/download`.
**Proposed:** Payroll home shows the "next run" preview (moved from Billing "Amounts owed"), warns about members without a rate, and labels overtime as hours only (or applies a multiplier: NBC). Pay stubs need a worker surface (§10).

### 6.9 Time off
**Current:** admin must first create a policy (none seeded) → worker requests on desktop → approvers get an in-app notification whose link 404s (`/attendance/time-off`) → the approver lands on "My time off" → Requests tab → decide → the worker's notification also links to the 404.
**Proposed:** seed one default policy (or a one-click "Vacation" button), fix the link to `/time-off?tab=requests`, and default approvers to the Requests tab when items are pending.

### 6.10 Change monitoring
**Current:** Tracking policies → scope → toggle → Save ("affected members notified") → *every* tracked member is notified, even for a one-member change, and can mute it → the desktop blocks until acknowledged → retention must be changed separately under Security. The admin cannot see acknowledgements.
**Proposed:** one Monitoring tab (capture + retention). Before saving: "affects N members". Notify only them, and make the notification mandatory. After saving: "N of M acknowledged" (the data exists in `policyAcks`).

### 6.11 Give a manager limited permissions
**Current:** Roles → create a custom role (built-ins locked) → up to 61 dropdowns → Members → person → role → Save → Teams → make them team MANAGER. Three pages, three saves, no preview.
**Proposed:** an "Access" panel on the member page: role (with "customise" to copy it), teams they manage, and a plain-language summary ("Can approve timesheets for Team A; cannot see pay"). Roles page shows member counts and hides raw keys.

---

## 7. Business-rule inconsistencies

| Rule | Where it diverges |
|---|---|
| Pay-rate precedence | Engine `PROJECT_WORKER → WORKER → PROJECT → CLIENT → ORG`; Billing page list omits CLIENT; project form hint says project rates override member-wide rates (true for BILL, false for PAY) |
| Money basis | Estimates at per-day rates on all tracked time (Overview, Insights, Reports payroll, Billing "Estimated owed") vs approved snapshots (invoices, payroll) vs hybrid (budgets, Billing report). Labels don't say which |
| Currency | Member rates always in org currency, so they're dropped from other-currency invoices. Budgets labelled in org currency. Overview "Outstanding" sums all currencies; Invoices KPI shows the org currency only |
| Overtime | Split and shown in payroll but never priced; the only premium is from time-type multipliers |
| Reason required | Self-edits by policy; the Split dialog never marks it required; bulk actions send none; managers editing others never need one (NBC) |
| Reject vs Request changes | Both unlock and both require a comment. Desktop and web label them the opposite way round |
| "Lock" | Three meanings: org lock date/age, approved-entry lock, submitted-period lock |
| Manager scope | The TEAM_MANAGER role is meaningless without team-role MANAGER; invites can't set it |
| Budget warning | Org setting `budgetWarnPct` is saved but unused; per-budget `warnPct` is what applies |

---

## 8. Permissions audit

| Issue | Evidence | Fix |
|---|---|---|
| Nav hides pages the role may read (Teams, Clients, Tracking policies) | `nav.ts:73-74,134` vs `teams/page.tsx:46`, `clients/page.tsx:25`, `settings/policies/page.tsx:36` | Gate the nav on `*:read` |
| `GET /roles` unguarded, so any member or API key can read every role's grants | `API/services/org.ts:98` | Require `members:read` or `roles:manage` |
| Manual time: nav/page use `manual_time:*`; API scopes by `time:read` | `API/routes/time.ts:92`, `timesheets.ts:436` | Use one rule |
| Reports listed by `reports:read/finance` but each run needs another permission | `reports.ts:541-551` vs `:497`, `finance.ts:326`, `:245` | Filter the catalogue by the run permission |
| `members:read_pay_rate` defined and flagged "sensitive" but never enforced | `permissions.ts:16`, `access-review/page.tsx:20` | Enforce it or remove it |
| Managers see bill amounts in budgets without `billing:read` | `permissions.ts:116`, `finance.ts:262-268` | Hide money unless `billing:read` (as Insights does) |
| Team managers can mark expenses reimbursed (a finance action) | `permissions.ts:119` | NBC |
| Access review API accepts `members:manage` at any scope but returns org-wide data | `API/services/privacy.ts:156` | Require org scope |
| Pay stubs nav gated by `timesheets:submit`; endpoint ungated | `nav.ts:66`, `ops-finance.ts:210` | Gate on payroll-profile membership |
| Unguarded list endpoints (time types, holidays) | `time-types.ts:27`, `operations.ts:242` | Low risk; make consistent |
| Mixed enforcement styles (`requirePermission`, raw `grants[]`, `need()`, `assertCan`); list endpoints 403 while detail endpoints 404 | across services | Standardise on one helper over time |

`docs/security/authorization-matrix.md` is in sync with the presets (test-enforced). It doesn't capture the desktop-only rule, unguarded endpoints or nav-level hiding.

---

## 9. Concrete bugs found (quick wins)

| # | Bug | Evidence |
|---|---|---|
| 1 | Editing a budget resets period / warn % / non-billable to defaults; saving turns a monthly budget into a lifetime budget at 80 % | `apps/web/components/finance/budget-dialog.tsx:42-44,149` (the DTO returns them: `finance.ts:254-256`) |
| 2 | Billing page PAY precedence omits CLIENT (wrong footer, can't create client pay rate, sort index −1) | `W/finance/billing/page.tsx:40-43` |
| 3 | Time-off notifications link to `/attendance/time-off`; device-offline links to `/tracking/devices`; both 404 | `API/jobs/index.ts:116,121,135` |
| 4 | All time entries History drawer shows raw project/task IDs | `W/timesheets/all/page.tsx:503` |
| 5 | Bulk actions send no reason, so they fail under a reason-required policy; the dialog says locked entries are "skipped" but they come back as errors | `W/timesheets/all/page.tsx:161,525` |
| 6 | Add time offered on submitted/approved periods on All time entries (server rejects) | `W/timesheets/all/page.tsx:209,354` |
| 7 | View & edit summary uses calendar weeks, not pay periods | `W/timesheets/team/page.tsx:36-37` |
| 8 | Split dialog never marks reason as required even when policy requires it | `apps/web/components/timesheets/entry-dialogs.tsx:196` |
| 9 | Notification click doesn't mark it read; loading shows "All caught up" | `apps/web/components/shell/app-shell.tsx:271,274` |
| 10 | Desktop says "review your own activity and screenshots on the web" (workers are redirected) | `D/renderer/src/App.tsx:280` |
| 11 | Wrong copy: Live "refreshes every 15 seconds", Live empty state names "Workers", "start the timer in the top bar" when there's no timer, Download step 3, Teams "assign from project settings", `/me/monitoring` "notified before any change takes effect" | see §4 |
| 12 | "Delete task?" actually archives | `W/tasks/page.tsx:218`, `W/projects/[id]/page.tsx:301` |
| 13 | Overview approvals count ≠ queue (own sheet counted) | `API/services/dashboard.ts:192` vs `timesheets.ts:730` |
| 14 | Login ignores last-used org | `apps/web/app/(auth)/login/page.tsx:25` |

Items 1, 4, 5 and 6 are in code added during the current uncommitted Trackabi-parity work.

---

## 10. Needs business clarification

1. **Worker surface on the web.** Should workers get a minimal web area (Pay stubs, Profile, What is monitored), or should those move into the desktop app? Today pay stubs are unreachable for them.
2. **Worker self-edit.** Should workers edit or split their own entries (they hold `time:edit: own`), or only request manual time?
3. **Manager edits.** Should managers need a reason when editing others' time? And do "Reject" and "Request changes" need to be separate actions?
4. **Money definition per label.** Should Overview, Insights and Reports show estimates or approved amounts? Pick one per label and write "Estimated" where applicable.
5. **Overtime pay.** Should overtime carry a multiplier, or only time types?
6. **Reimbursements.** Should approved reimbursable expenses flow into the next payroll draft (the adjustments mechanism already exists)?
7. **Manager money access.** Should team managers see bill amounts in budgets, or mark expenses reimbursed?
8. **Integrations.** Build a UI for `/integrations/*`, or remove the unused backend and scheduler?
9. **Teams.** Separate page, or a grouping inside Members?
10. **Reports for workers.** The WORKER preset holds `reports:read` own; it's unusable today. Remove it or expose it?
11. **Brand.** The UI is WorkPulse, but the webhook header `Tallywork-Event`, the extension, the support page, desktop internals and packages still say Tallywork. Should the external surfaces (webhook header, extension name) change? Renaming a webhook header breaks integrators.

---

## 11. Cross-cutting findings

**UI patterns**
- **Date range pickers: at least 7 implementations**, including two different components both named `DateRangeFilter` (`components/reports/date-range.tsx`, `components/tracking/filters.tsx`), the Insights period stepper, the inline range on All time entries, and raw from/to fields in Billing, Audit, Save report and New invoice. → one `DateRange` component with presets.
- **Two `MultiSelect`s** (`components/reports/multi-select.tsx`, `components/workspace/multi-select.tsx`). → one.
- **Duplicated tables:** the entry row and menu (timesheet-view vs all entries) and the task table (Tasks vs project Tasks). → shared components.
- **Formatting bypassed:** hard-coded `en-GB` / `en-US`, manual `/100`, `toFixed(2)`, a local `toMinor` (`people/shared.tsx:111-125`, `reports/format.tsx:83`, `insights/page.tsx:47`, `finance/types.ts:127`, invoices). → `fmtMoney` / `fmtDate` only.
- **Confirmations:**
  - Missing on invoice **Send**, dashboard reset and support-access revoke.
  - Arguably unnecessary on bulk "Mark billable" and on archives that can be restored.
  - `window.confirm` in Tracking policies goes against `docs/web-conventions.md`.
- **Permission states:** some pages wrap `PermissionState` in a header and panel, others return it bare.
- **Missing states:** Activity (spinner only), View & edit (no ErrorState), Settings (no skeleton/error), Audit (no explicit empty state).
- **i18n:** only nav, shell and profile are translated. Widget titles and all page copy are hard-coded.

**Data fetching**
- `useOrgMutation` invalidates **every** org query after every mutation (`apps/web/lib/api.ts:73`). Heavy pages refetch 8–9 queries per edit. → invalidate by resource prefix.
- SSE plus polling on the same data (Live, Overview). Activity polls `/tracking/live` just to get a member list. The shell polls every 15 s (timer) and every 30 s (notifications).
- Whole lists fetched for tiny results:
  - `/workers` just for time zones
  - all clients, projects and workers just to get a name map
  - all team entries for a week just to sum them (rollups exist)
  - the whole `/insights` endpoint just for money per day
  - all `/devices`, then filtered in memory
- Duplicate count queries on Approvals and Manual time.
- N+1 loops in services: `approvalQueue` activity per sheet, `budgetStatuses` spend per budget, `recomputeWorkerDays` per worker, `loadActor` per digest member.

**Terminology: pick one of each**

| Concept | Terms in use | Recommend |
|---|---|---|
| Person in the org | member, worker, employee, people, user | **Member** (UI). Keep `/workers` and `WorkerDto` internally, but fix copy that says "Workers" / "worker" / "Employee" |
| Pay | pay rate, employee hourly rate, wage, earnings, owed, to pay, gross | **Pay rate**, and **Pay** for amounts (Estimated / Approved) |
| Bill | bill rate, billable rate, billable hourly rate, billable amount | **Bill rate**, **Billable amount** |
| Money in | Payments | **Payments received** |
| Pay groups | payroll profiles | **Pay groups** |
| Timesheet decision | reject / request changes / reopen / comment | **Request changes** (one action), **Reopen** |
| Lock | lock date, locked entry, locked period | "Locked after approval" and "Lock date"; avoid a third meaning |
| Archive | delete (tasks), archive, inactive (clients), completed (projects) | **Archive** everywhere; drop the client "Active" toggle |

**Over-engineering and dead code**
- Integrations registry + sync scheduler with no providers and no UI.
- Unused permission (`members:read_pay_rate`), unused domain helpers (`hasPermission`, `scopeFor`), `filterNav` dead branches, `workerLabel` and worker-only branches that can't render, `void onIdle` in `timer.ts:199`.
- Unused API endpoints: `DELETE /payments/:id` and `DELETE /invoices/:id` (these are needed, so add the UI); `GET /idle-events`.
- Stray untracked full repo copy at `.kilo/worktrees/bloom-judge/`, not git-ignored.

---

## 12. Prioritised plan

**P0: bugs and dead ends (small, safe)** — _done 2026-09-30 except §9 items 6 and 7, which move to P2 (Team timesheets). Item 6 needs per-member lock state on the cross-member page; item 7 is labelled "Team week" and becomes pay-period-aware with the merge._
- §9 items 1–6, 8, 9, 12, 13 and the copy fixes in item 11.
- Nav gating for Teams, Clients and Policies. Guard `GET /roles`. Filter the Reports catalogue by run permission.

**P1: simplify without restructuring** — _done 2026-09-30 (migration 0017). Reports: daily-totals, work-breaks, project/client-budgets and audit-log are hidden from the catalogue but still run for saved reports; a combined "Budgets" report replaces the two budget reports; the Audit log page has its own CSV export. Query invalidation is scoped for the timer bar (`invalidateOrg` prefixes); other mutations still refresh everything._
- Invite dialog: projects + team role.
- Time off: fix links, approver default tab, seed a default policy.
- Invoices: edit/delete drafts, confirm Send, Payments as a tab, delete payment.
- Budgets: rename "Spent" → "Billed"; hide money without billing permission.
- Reports: per-report filters, one export menu; remove daily-totals, work-breaks, client-budgets and audit-log (merge into their siblings).
- Label estimates as "Estimated". Unify the terminology per the glossary.
- Narrow query invalidation.

**P2: consolidate**
- **Team timesheets:** merge View & edit + Approvals + Manual time into one pay-period-aware queue/table with a drawer, inline manual requests and "Unlock to edit".
- One shared entry row/menu, date-range component, `MultiSelect` and TaskTable.
- **Rates** as the single editor with an effective-rate preview. Move "Amounts owed" into Payroll.
- **Settings** as one tabbed area (absorbs Developer, Devices, Access review, retention). Move personal items to the user menu.
- Overview setup checklist for new orgs.

**P3: after business decisions (§10)**
- Worker surface (web area or desktop): pay stubs, requests status, entries list.
- Money definition, overtime pay, reimbursements via payroll, integrations.
