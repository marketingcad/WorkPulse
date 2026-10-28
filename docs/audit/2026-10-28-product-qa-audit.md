# WorkPulse product QA, workflow and financial accuracy audit (2026-10-28)

Scope: the whole monorepo at `0849e8c` (branch `feat/sidebar-group-names`).

How the audit was done:
- **Reading.** Four reviewers each read one area in full: money calculations, time tracking and timesheets, permissions and report scope, and web forms and navigation.
- **Running.** The project's own checks were run.
- **Reproducing.** Every high-risk finding was replayed as an API test on the in-memory PGlite harness. Nothing shared, staging or production was touched.

This audit builds on the 16 October audit and on the 26–27 October time, money and work audits. Findings fixed by those audits are not repeated here unless the code shows they are still broken.

| Label | Meaning |
|---|---|
| **Runtime** | Reproduced in this audit with a test that ran |
| **Traced** | The code path was followed end to end but not run |
| **Potential** | Plausible from the code; needs a runtime check |

---

## A. Executive summary

WorkPulse is in good shape overall. The main flows work:
- tracking, then timesheets, then approval, then approved pay, then payroll, then pay stub;
- approved time, then invoice, then payment.

Those flows are covered by about 580 API tests and about 240 Playwright tests, and all of them pass. Money is stored as integer minor units, rounded per entry and priced once at approval. Payroll pays each billing entry once.

The audit found **15 defects reproduced at runtime** and about 40 more by reading the code.

**Fixed in this branch** (each has a regression test that fails on the old code):
- **Q4 (P1).** Custom roles with an "own" or "team" `rates:manage` grant could set their holder's own pay and the org-wide rates. An own-scope `time_off:manage` grant could add hours to its holder's own balance.
- **Q5 (P1).** A scheduled report was emailed to any member, including workers who can't open it. For example, the Payroll Export, with everyone's pay, reached a worker.
- **Q1 (P1).** A member who was removed but left in a pay group was paid 8 h for every later paid holiday. So was a new hire, for holidays before their start date.
- **Q2 (P2).** Time off on days without a shift was charged when no shift fell inside the request. For example, Thursday and Friday off for someone scheduled Monday to Wednesday cost 16 h.
- **Q3 (P2).** Resolving idle time as "Reassigned" without a project deleted the time.

**Highest-risk issues still open** (reproduced; they need a design decision before a fix):
- **Q6 (P1).** An offline desktop session that syncs late stops a web timer that is running now. That timer's time is lost: a 1-hour web session became 0.
- **Q7 (P1).** An offline session from yesterday is thrown away when it syncs after today's daily limit is reached, or after its project was archived. 2 h of Monday's work were lost.
- **Q8 (P1).** Paid time off that crosses a pay-period boundary is re-priced. A 40 h request with a holiday added later paid 32 h over two semimonthly payrolls.
- **Q9 and Q10 (P2):**
  - a money budget that includes non-billable time drops from $200 spent to $0 once that time is approved;
  - an invoice line uses today's time-type coefficient, so it shows 1 h × $300 = $200.

**Not fully verified:**
- Live email, storage and Supabase.
- The Electron app on macOS and Linux.
- Load and concurrency beyond the existing tests.
- Accessibility (no new audit was run).
- Every finding marked Traced.

## B. Feature inventory

The sidebar is defined in `apps/web/components/shell/nav.ts`, and its labels are in `apps/web/messages/en.ts`. Everything is under `/o/:orgId`, and API calls go to `/api/v1/orgs/:orgId`.

People who only hold "own"-scope grants (workers) are sent to `/download`: they use the desktop app.

| Group → item | Route(s) and tabs | Permission | Main data | Coverage (API / E2E) | Issues here |
|---|---|---|---|---|---|
| Overview | `/` (cards, setup checklist) | any | `/dashboard/*`, `/tracking/current` | dashboard.test / organizations.spec | F5 (invoices widget mixes currencies) |
| Time Tracking → Time entries | `/timesheets/all` (Add, Edit, Split, Delete, History, bulk, CSV import) | `time:read` team/org | `/time-entries*`, `/manual-time` | timesheet-entry, time-paging / time-entries, csv-import | U1, U2, U4, U7 |
| Time Tracking → Timesheets | `/timesheets/approvals` (Approvals, Team week) | `timesheets:approve`, `manual_time:*`, `timesheets:read` | `/timesheets*`, `/manual-time/*` | timesheets, timesheet-rules / timesheet-decisions | R1 (label) |
| Time Tracking → Live | `/tracking/live`, plus `/sessions` (Session history) | `tracking:read` | `/tracking/live`, `/sessions` | tracking / consolidated | Q6, Q7, T10 |
| Time Tracking → Activity | `/activity` (Screenshots, Apps, URLs) | `activity:read` | `/activity/day` | tracking, compliance / — | Q3, T3, T7 |
| Time Tracking → End-of-day reports | `/tracking/reports` | `tracking:read` team/org | `/eod-reports` | breaks-eod / breaks-eod | — |
| Workforce → Members | `/workers`, `/workers/:id` (Overview, Personal info, Time, Activity, Projects, Devices, Policy), `/teams` | `members:read`, `teams:read` | `/workers*`, `/teams*`, `/invitations` | access-consistency, staff-profile / member-profile, invitations, people-paging | Q1, A3, A6 |
| Workforce → Schedules & attendance | `/schedules`, `/attendance` | `schedules:read`, `attendance:read` | `/schedules`, `/shifts`, `/attendance` | ops, workforce / attendance-scheduled | U5 |
| Workforce → Time off | `/time-off` (My time off, Requests, Calendar, Policies & holidays) | `time_off:*` | `/time-off/*`, `/holidays` | workforce, money-p0 / — | Q2, Q8, T6, BE-9 |
| Project Management → Clients | `/clients`, `/clients/:id/portal` | `clients:*` | `/clients*` | clients, work-integrity / work-forms, portal | A8 |
| Project Management → Projects | `/projects`, `/projects/:id` (Tasks, Plan & budget, Members & teams, Documents, Settings) | `projects:*` | `/projects*`, `/budgets` | projects-details, work-scope / work-forms | U3 |
| Project Management → Tasks | `/tasks` | `tasks:*` | `/tasks*` | work-rules / work-forms | — |
| Finance → Rates | `/finance/billing` | `rates:*` | `/rates` | finance / money-p0 | Q4 (fixed), R6 |
| Finance → Budgets | `/finance/budgets` | `budgets:*` | `/budgets` | finance / budgets | Q9, F7, A2b |
| Finance → Expenses | `/finance/expenses` | `expenses:*` | `/expenses*`, `/files/receipts` | finance, money-p1-safety / — | U6 |
| Finance → Invoices | `/finance/invoices` (Invoices, Payments received), `/invoices/new`, `/invoices/:id` | `invoices:*`, `payments:*` | `/invoices*`, `/payments` | finance, finance-paging, money-p1-safety / invoices, finance-paging | Q10, F5, F10, U8 |
| Finance → Payroll | `/finance/payroll` (Payrolls, Owed, Pay groups), `/finance/payroll/:id` | `payroll:*` (org only), `billing:read`, `rates:read` | `/payroll/*`, `/billing/amounts-owed` | payroll, money-p0 / payroll, money-p0 | Q1, Q8, F8, F9 |
| Reports → Summary | `/insights` | `time:read` team/org | `/insights` | insights / insights | F11 |
| Reports → Report library | `/reports`, `/reports/:key` (saved, scheduled, recent exports) | `reports:*` plus the data permission | `/reports/*`, `/saved-reports`, `/report-runs` | reports / settings-integrations | Q5 (fixed), F5, F6, A4, A7 |
| Settings | Organization, Time & pay, Tracking policies, Devices, Roles, Access review, Security & retention, Screenshot retention, API keys, Webhooks, Audit log | per tab | `PATCH /`, `/policies/*`, `/roles`, … | security, compliance, integrations, screenshot-cleanup / two-factor, screenshot-retention, settings-integrations | A5 (SEC-6), A2b |
| Help | `/help` | any | static content | — / help | R9 |
| Account menu | `/me/profile`, `/timesheets` (My timesheet), `/pay-stubs`, `/me/monitoring` | any / `timesheets:*` | `/me*` | — / profiles | R10 |
| Client portal | `/portal`, `/portal/:accessId`, `/portal-invite` | portal viewer | `/portal/*` | portal / portal | A6 |
| Desktop app | Home, Track, Timesheet, Time Off, Schedule, Pay Stubs, Settings | worker (own data) | `/agent/*`, `/me/*` | agent-me, tracking / desktop specs | Q6, Q7, T3 |

## C. Defect register

### C1. Fixed in this branch

| ID | P | Area, role | What happened | Evidence | Fix |
|---|---|---|---|---|---|
| Q1 | P1 | Payroll; payroll admins | A removed member left in a pay group was paid for every later paid holiday (8 h, or the scheduled hours). A new hire was paid for holidays before their start date. Reproduced: removed on 21 Oct, holiday on 28 Oct, line 8 h / $80.00. | `pay-figures.ts` `paidHolidayHours` read every pay-group member with no employment check. Removing a member never takes them out of pay groups. | Holidays pay only inside the member's employment dates: from `start_date` to `end_date`, which removal sets. |
| Q2 | P2 | Time off; workers | A schedule only counted when a shift fell inside the requested dates. Reproduced: Mon–Wed schedule, Thu–Fri request charged 16 h instead of `no_working_days`. | `operations.ts` `requestTimeOff`: `hasSchedule = shiftsForMe.length > 0` | A day under a schedule version is a working day only if it has a shift. This is the rule paid holidays already use. Days with no schedule still count Mon–Fri. |
| Q3 | P2 | Idle time; managers and desktop | "Reassigned" with no project removed the idle span as if it were discarded. Reproduced: 60 min became 40 min. | `tracking.ts` `resolveIdle`: removal ran for every non-KEPT resolution, and the reassignment only ran `if (projectId)`. | The web API refuses it (400 with a field error). The service refuses it for desktop events too, so the idle period stays pending for an answer or the default. |
| Q4 | P1 | Rates and time-off balances; custom roles | `rates:manage` and `time_off:manage` only checked that the grant existed, not its scope. Reproduced: an own-scope rate clerk set their own pay to $999/h (201), set the org bill rate (201), and PATCHed their own pay (200). An own-scope leave clerk added 500 h to their own balance (200). | `finance.ts` `setRate`, `deleteRate`, `applyScopedRates`; `operations.ts` `adjustBalance` | Scope-aware checks. Org scope covers everything. A narrower grant covers members it reaches, its assigned projects and their clients. It never covers the org default or the holder's own pay or balance. |
| Q5 | P1 | Scheduled reports; any member | The only check on recipients was that they are members. Reproduced: a worker who gets 403 on the Payroll Export received it by email every run. The 7-day link works without signing in. | `report-runs.ts` `validateSaved`, `executeRun` | The report goes only to the owner and to members who may run it and see at least what the owner sees: the same permissions at org scope, or covering the owner's team or projects. This is checked when the schedule is saved and again on each run, so losing access stops the emails. The Recipients hint now says so. |

### C2. Open: reproduced at runtime

| ID | P | Area | Reproduction | Root cause | Recommended fix |
|---|---|---|---|---|---|
| Q6 | P1 | Tracking, offline sync | Web timer started 10:00. At 11:00 a desktop syncs an offline session from 09:00 to 09:30. Result: the web session is gone (`session: null`), the day shows 30 min, and the 10:00–11:00 hour is lost. | `tracking.ts` `startSession` supersedes the live session at the event's past time. `closeOpenSegment` clamps the end to the live segment's start, so the live segment has length 0. | A late start must not supersede a session that began after it. Record the offline session as a closed historical session, and let overlap trimming handle the shared span. Needs a design decision. |
| Q7 | P1 | Tracking, offline sync | 8 h daily limit. On Tuesday, after 8 h on the web, Monday's offline 18:00–20:00 session syncs. Both events are rejected (`limit_reached`, then `session_not_found`), Monday shows 0, and the desktop acks the rejection and deletes the events. | `startSession` checks the limit on the sync day, and re-checks archived or assigned projects at sync time. | Check limits against the day the session happened. Never reject recorded evidence; accept it and flag it for review. |
| Q8 | P1 | Payroll, time off | 40 h PTO 12–16 Oct, then a paid holiday added on the 14th. Semimonthly payrolls paid 24 h + 8 h = 32 h. By reading, a Mon–Wed schedule overpays the other way (32 h for a 24 h request). | `reports.ts` `timeOffHoursInRange` re-prices a request that crosses a period as Mon–Fri × hours per day. The holiday check in `pay-figures.ts` assumes the request is inside one period. | Store each request's per-day hours when it is approved and pay the days in each period from those. Needs a migration. |
| Q9 | P2 | Budgets | A money budget with non-billable time: $200 spent before approval, $0 after approval. | `finance.ts` budget estimate: approved non-billable entries carry `billAmountMinor = 0`. | For budgets that include non-billable time, price non-billable time at the bill rate whether or not it is approved. This is a financial rule, so confirm the intent first. |
| Q10 | P2 | Invoices | 1 h of Overtime (bill ×2) approved, then the coefficient edited to ×3. The invoice line shows "Overtime ×3", qty 1, unit $300.00, amount $200.00. | `finance.ts` invoice lines read the current coefficient. The amount was priced with the old one. | Group and price lines from the coefficient stored on each billing entry (new column), or derive the unit price from amount and seconds. |

### C3. Open: traced (read and followed, not run)

Money:
- **F5 (P2).** Finance exports, the invoices report and the dashboard invoices widget print and sum every row in the org currency. The invoices export also counts DRAFT as invoiced and VOID in totals. The Invoices page KPIs leave both out, so they disagree with the export.
  - Where: `lib/export.ts`, `reports.ts` invoices/payments/expenses, `dashboard.ts`.
- **F6 (P2).** The Billing report adds approved amounts in any currency, but leaves foreign currency out of its estimate column (`reports.ts` around line 400).
- **F7 (P3, BE-10 still open).** Money budgets mix currencies and round per rollup row.
- **F8 (P3).** Pay stub hours: "of which overtime" comes from all logged time, while "approved" includes carried time. So overtime can exceed approved hours (`payroll.ts`, `pay-stub-pdf.ts`).
- **F9 (P3).** Time-off pay uses one rate for the whole request, from WORKER or ORG scope only. A raise mid-request is ignored, and people paid only by project rates get $0 time off.
- **F10 (P3).** Invoice quantity × rate ≠ amount by cents:
  - the PDF prints 2 decimals for a 4-decimal quantity;
  - per-entry rounding of six 10-minute entries gives $100.02 for 1.0000 h × $100;
  - custom lines are priced from the unrounded quantity.
- **F11 (P3).** Summary credits approved money to the project's current client, while the Billing report and invoices use the billed client.

Time:
- **T3 (P2).** Resolving an idle period while it is still going (from the web) resumes the server timer. The rest of the away time then counts as work. The background job already guards against this case, but `resolveIdleByUser` does not.
- **T5 (P2).** The missing-time reminder uses the org's date and time zone, not the worker's (`reminders.ts`).
- **T6 (P3).** Time-off "used hours" goes up when a timesheet with per-hour accrual is reopened. The balance itself is right.
- **T7 (P3).** Discarding a closed idle period removes up to the first input, including time after "Resume". It also adds a second IDLE segment.
- **T9 (P3).** Idle discard and screenshot deletion cut into duration-only manual entries that tracking ignores.
- **T10 (P3).** Stop and force-stop read the session before taking the worker lock. This gives a duplicate STOP transition and event, but no time is lost.
- **Still open from 16 October:**
  - BE-9: a worker can cancel approved time off after taking it, and the balance is restored.
  - BE-4: the `webSwitch` race.

Permissions:
- **A2b (P2).** Other services still ignore the grant's scope:
  - `upsertBudget` and `deleteBudget`;
  - `listInvoices`, `getInvoice`, `listPayments` and the dashboard invoices widget;
  - `upsertTeam` and `archiveTeam`;
  - webhooks and API keys;
  - `listAudit`, whose rows include rate amounts.

  These need the same treatment as Q4. They only matter for custom roles with a narrower scope.
- **A3 (P3).** A member's own data export includes the admin-only HR notes, which `/details` hides from them. Decide whether this is intended for subject access requests.
- **A4 (P3).** The Billing report shows money to a role with `reports:finance` + `time:read` and no `billing:read`, which Summary hides from the same person.
- **A5 (P2, SEC-6 still open).** Policy layers ignore scope. A worker can read any team's layer, and a team-scope `policies:manage` holder can write the ORG layer.
- **A6 (P3).** Re-enabling a client portal skips the grant checks for monitoring sections that are already on.
- **A7 (P3).** Shared saved reports show their recipients and parameters to anyone who may run that report.
- **A8 (P3).** IDs from another organization are stored without a lookup in a few bodies (time-off adjust, budget subject, rate scope, schedule member). RLS keeps them from being read back.
- **Still open:** SEC-5 (`/files/:id` has no branch for project documents) and SEC-7.

Web forms:
- **U1 (P1, FE-A1 partly fixed).** On Time entries, only the Member filter clears the selection. After a Client, Project, Task, search, date or page change, bulk Delete or Mark billable acts on rows that are no longer visible.
- **U2 (P2).** The Edit entry dialog always sends `billable` and `note` from when it opened, and the server ignores `revision`. A concurrent change is silently reverted.
- **U3 (P2).** The Edit project dialog on the Projects list sends `member_ids` and `team_ids` from a snapshot, which overwrites access changes made in Members & teams. It also recomputes a day-based estimate from the current hours per day.
- **U4 (P2).** Archived projects and clients can't be chosen as filters in Time entries or reports, and the revision drawer shows their raw IDs.
- **U5 (P2).** Schedule versions can overlap or leave gaps:
  - a backdated version leaves two open-ended versions, and either one is used;
  - deleting the latest version doesn't reopen the previous one;
  - `effective_to` can be before `effective_from`.
- **U6 (P2).** The New expense currency doesn't follow the project's client. A billable expense in the wrong currency never reaches an invoice, and no warning is shown.
- **U7 (P2, FE-4 still open).** Entry dialogs use the browser's time zone; lists use the member's.
- **U8 (P3).** Smaller open items:
  - Record payment defaults to the org currency (FE-B7);
  - a deleted invoice draft stays in the list for up to 15 s (FE-B2);
  - Set budget silently replaces an existing budget;
  - Rotate webhook secret has no confirmation (FE-C8).

Possible risks, not confirmed:
- Two draft payrolls can both show the same unpaid time until one is finalized.
- Net pay can go negative.
- A $0 sent invoice becomes OVERDUE.
- Owed and Summary use the entry's current seconds, while payroll uses the billing entry's.
- Payroll Export prices pay in the org currency only.
- Duration-only manual time plus a late offline sync is counted twice. The overlap trim skips duration-only entries by design; decide whether that is still the right rule.

## D. Redundancy and UX

| # | Item | Evidence | Recommendation |
|---|---|---|---|
| R1 | The "Timesheets" item opens a page headed "Approvals" | `nav.ts` → `/timesheets/approvals` | **Rename** the item "Approvals", with Team week as its second tab |
| R2 | One member's timesheet at two URLs | `/timesheets/team?member=` and `/timesheets?member=` both render `TimesheetView` | **Merge**: Team week links to one route |
| R3 | Time entries, Team week, My timesheet, Approvals | Different concepts (ledger, period sheet, queue) sharing one set of dialogs | **Keep** |
| R4 | Live vs Session history vs the Work Sessions report | `/sessions` is reached only from a button on Live, with a different heading and permission gate | **Relocate**: Session history as a tab of Live, with the same gate |
| R5 | "Owed", "Amounts Owed", "Owed (estimate)" | All read `/billing/amounts-owed` | **Keep both**, use one name |
| R6 | Rates edited in four places with two behaviours | The Rates page takes an effective date; member, client and project forms always apply from today | **Keep**; label the form fields "from today" and link to Rates |
| R7 | "Pay period" in Settings is the timesheet period | Payroll pay groups have their own period | **Rename** to "Timesheet period" |
| R8 | Report category "People", Title Case report names | `reports.ts` catalogue | **Rename** to match "Workforce" and sentence case |
| R9 | Help categories still use the old group names | `components/help/content.ts` | **Rename**: "Time Tracking", "Project Management" |
| R10 | The account menu shows My timesheet with `timesheets:submit`, but the page needs `timesheets:read` | `app-shell.tsx`, `timesheets/page.tsx` | **Align** the gates |

Not duplicates:
- Attendance vs Team week: attendance comes from schedules.
- Security & retention vs Screenshot retention: they are separate settings on the server.
- Record payment on both the invoice page and Payments received.

## E. Relationship matrix

| Chain | Create | Edit | Persist | Authz | Propagation | History | Notes |
|---|---|---|---|---|---|---|---|
| Org → members → teams → roles | ✓ | ✓ | ✓ | ✓ built-in; ⚠ custom narrow scopes (Q4 fixed, A2b open) | ✓ | ✓ | Re-invite starts clean (27 Oct) |
| Client → project → task → time entry | ✓ | ⚠ U3 | ✓ | ✓ | ✓ | ✓ moving a project keeps billed client (F11 on Summary) | |
| Worker → session → activity → EOD report | ✓ | — | ✓ | ✓ | ⚠ Q6, Q7 (offline sync loses time) | ✓ | |
| Worker → schedule → attendance → timesheet | ✓ | ⚠ U5 | ✓ | ✓ | ✓ | — | |
| Worker → time off → approval → ledger | ✓ (Q2 fixed) | — | ✓ | ✓ (Q4 fixed) | ⚠ Q8 across periods; T6 | ✓ | |
| Entries → timesheet → approval → approved pay | ✓ | ⚠ U2 | ✓ | ✓ | ✓ | ✓ revisions | |
| Entries → billable → invoice → payment | ✓ | — | ✓ | ⚠ A2b invoices list | ⚠ Q10, F10 | ✓ void, payments | |
| Approved time + leave → payroll → pay stub | ✓ | — | ✓ | ✓ org-only | ⚠ Q1 fixed, Q8, F8, F9 | ✓ carried periods | |
| Rates → effective-dated pricing | ✓ | ✓ | ✓ | ✓ (Q4 fixed) | ✓ snapshot at approval | ✓ | |
| Expenses → receipt → reimbursement / invoice | ✓ | — | ✓ | ✓ | ⚠ U6 currency | ✓ | |
| Budgets → consumption | ✓ | ⚠ silent replace | ✓ | ⚠ A2b | ⚠ Q9, F7 | — | |
| Source → reports → exports | ✓ | — | ✓ | ✓ (Q5 fixed) | ⚠ F5, F6 | — | |

✓ = verified by existing or new tests. ⚠ = defect found. — = not applicable or not checked.

## F. Financial and time calculation audit

**Rules as built.**
- Time is stored in whole seconds. Money is integer minor units (`bigint`) with an ISO currency.
- Rate choice:
  - BILL: PROJECT_WORKER > PROJECT > WORKER > CLIENT > ORG.
  - PAY: PROJECT_WORKER > WORKER > PROJECT > CLIENT > ORG.
  - A rate applies when `effectiveFrom ≤ worker-local date < effectiveTo`.
- Approval prices each entry once: `round(round(seconds × coefficient) × rate / 3600)`. This per-entry rounding is the official figure.
- Estimates use the same per-entry rule at today's rates. Amounts in another currency count as 0.
- Overtime is reported only, over whole weeks starting on the org's week start. There is no premium beyond time-type coefficients.
- Payroll:
  - It pays approved, unpaid billing entries in the pay group's currency, including entries carried from earlier periods.
  - It adds paid time off at the WORKER or ORG rate, and paid holidays at the scheduled hours (8 h on a weekday without a schedule).
  - Net = gross + signed adjustments.
- Invoices: lines by label × rate × coefficient. The line amount is the sum of the entry amounts, tax is per line (half-up), and status is derived from the paid amount.

**Cases run in this audit (API harness):**

| Case | Inputs | Expected | Before | After this branch |
|---|---|---|---|---|
| Holiday pay, removed member | $10/h WORKER rate, monthly pay group, removed 21 Oct, paid holiday 28 Oct | $0 | 8 h, $80.00 | $0 ✓ |
| Holiday pay, before start date | Start 20 Sep, holiday 16 Sep | $0 | 8 h, $80.00 | $0 ✓ |
| Holiday pay, current member | Same holiday | 8 h, $80.00 | 8 h, $80.00 | 8 h, $80.00 ✓ |
| Time off on non-shift days | Mon–Wed 09–17 schedule, Thu–Fri request | refused, `no_working_days` | 16 h | refused ✓ |
| Time off across one shift | Same schedule, Wed–Thu | 8 h | 8 h | 8 h ✓ |
| Time off without a schedule | Thu–Sun | 16 h | 16 h | 16 h ✓ |
| PTO across semimonthly periods | 40 h 12–16 Oct, holiday added on the 14th | 40 h, $400.00 | 24 + 8 = 32 h, $320.00 | open (Q8) |
| Money budget, non-billable | $100/h bill rate, 2 h non-billable, budget $1,000 including non-billable | $200 before and after approval | $200, then $0 | open (Q9) |
| Invoice line after coefficient edit | 1 h at $100 × 2, coefficient later set to 3 | qty × unit = amount | 1 × $300 ≠ $200 | open (Q10) |
| Idle reassigned without a project | 60 min session, 20 min idle | refused, 60 min kept | 40 min | refused, 60 min ✓ |
| Late offline sync vs running web timer | Web 10:00–11:00 running, offline 09:00–09:30 | 90 min, web timer running | 30 min, web timer gone | open (Q6) |
| Offline session after the daily limit | 8 h limit; Monday 2 h synced Tuesday after 8 h | Monday 120 min | 0 | open (Q7) |

Breaks, overtime, idle defaults, rounding, carried payroll, paid breaks and overlap trimming are covered by the existing suites, and all of them pass:
- `time-accuracy`, `time-money`, `time-overlap`, `payroll`, `money-p0`, `money-p1-safety`;
- `calculator-accuracy.spec`.

## G. End-to-end results

| Journey | Result | Evidence |
|---|---|---|
| A. Organization setup | Pass (existing) | organizations, invitations, work-forms specs |
| B. Worker tracking (desktop) | Pass for online flows. **Fail** for late offline sync (Q6, Q7) | desktop specs; API reproductions |
| C. Timesheet approval | Pass | timesheet-decisions, timesheet-rules |
| D. Billing | Pass, with Q10 and F5 open | invoices, finance-paging specs |
| E. Payroll | Pass, with Q8 open; Q1 fixed | payroll, money-p0 specs and tests |
| F. Time off and attendance | Pass, with Q8 open; Q2 fixed | attendance-scheduled spec, workforce tests |
| G. Permission isolation | Pass for built-in roles. **Fail** for narrow custom roles (Q4 fixed, A2b open) and scheduled reports (Q5 fixed) | access-consistency, work-scope, `audit-oct28` |
| H. Failure and recovery | Partly covered (ops, tick-lease, money-p1-safety); offline sync fails (Q6, Q7) | — |

The full-run counts are in section I.

## H. Prioritized plan

The work ships in six phases, one pull request each. A phase is green before the next one starts.

Phases 2 and 3 change shared tracking and pricing code, so they run one after the other, never in parallel. Each of them starts with a short design note that needs approval.

Every phase meets the [definition of done](../../AGENTS.md):
- the affected package tests pass;
- the new E2E specs pass;
- the full `pnpm test:e2e` passes;
- `pnpm typecheck` passes;
- the results are reported with real counts.

### Phase 0: ship Q1–Q5

- Branch `fix/audit-oct28` from `main`, then commit and open a pull request. This report goes with it.
- Release note: custom roles with a narrow rates or time-off grant lose access outside their scope. Scheduled reports stop going to recipients who can't see them.

### Phase 1: permissions and security

No financial rules change in this phase.

| Item | Work |
|---|---|
| A2b | The Q4 scope checks for budgets, invoices, payments (and the dashboard widget), teams, webhooks, API keys and the audit log |
| A5 / SEC-6 | Policy layers: workers read only their own team's layer. A team-scope grant can't write the org layer. |
| SEC-5, SEC-7 | Project documents get a branch in `/files/:id`. SEC-7 is closed. |
| A4, A6, A7, A8 | The Billing report needs `billing:read`. Grants are checked again when a portal is re-enabled. Recipients are hidden on shared reports. IDs in request bodies are looked up. |
| U1 | The Time entries selection clears on every change of filter, search, date or page |
| T3, BE-9 | Idle resolution is refused while the idle period is still going. Time off that was already taken can't be cancelled. |

- **Decision needed:** A3. Should a member's own data export include the HR notes?
- **Tests:** API tests for each role and scope, covering who is refused. E2E for U1 and for the restricted-role views.

**Status: done on `fix/audit-phase1-permissions`, except A3.** Decisions made while building it:

| Item | As built |
|---|---|
| A2b, org settings | `org:update`, `roles:manage`, `api_keys:manage`, `webhooks:manage`, `audit:read`, `settings:security` and `retention:manage` join payroll as org-only permissions. A role can't be saved with a narrower scope, and a narrower grant already stored is ignored when the member signs in. |
| A2b, money | Budgets, invoices and payments follow `canOnClient`. Org scope covers everything. A narrower grant covers its assigned projects and their clients, in lists, page totals, single records, the dashboard widget and the Invoices and Payments reports. Recording a payment at a narrower scope needs one of those clients. |
| A2b, time off | Holidays and leave policies apply to everyone, so changing them needs `time_off:manage` at org scope. A narrower grant still adjusts the balances of members it reaches (Q4). |
| A2b, teams | Only org scope creates a team. A narrower grant renames or archives only the teams its holder manages. |
| SEC-7 | A team-scope grant adds a person only if its holder already manages them through another team. It can still remove people and change roles. |
| A5 / SEC-6 | Every policy reader can read the org layer, because it is part of their own policy. A team layer is readable at org scope, by its managers and by its members. A member layer follows `can()`. Writing the org layer needs org scope. A narrower grant never changes its holder's own policy. |
| SEC-5 | `/files/:id` serves only receipts and your own exports. Anything else is 404. Project documents, screenshots and invoice PDFs keep their own routes. |
| A4 | `mayRun` passes when any one of the `requires` permissions is held, so the Billing report hides its money columns and figures instead, as Summary does. Money needs `billing:read` or `rates:read`. |
| A6 | Switching a portal back on checks the activity and screenshot grants for the sections it still shares. |
| A7 | Only the owner sees a shared report's recipients. |
| A8 | Request bodies are looked up in the org: budget subjects, rate scopes, time-off adjustments (member and policy), schedule members and member policy layers. |
| T3 | The web refuses to resolve idle time while it is still going (`idle_ongoing`). It resolves once there is input again or the session ends, as the background job does. |
| BE-9 | Once approved time off has started (in the member's time zone), the requester can't cancel it (`time_off_started`). An approver can. My time off hides Cancel for it. |
| U1 | Any change of filter, search, dates, order or page clears the selection. A bulk action only sends rows that are on screen. |

**Found while building it, not changed:** inviting and revoking invitations (`members:manage`) still only check that the grant exists. A narrower grant can invite anyone into any role it holds. This needs a product decision: invite into your own team, or org-only.

### Phase 2: offline sync

- **First:** property tests that generate random orders of offline and online events. They check that no recorded second is lost or counted twice.
- **Q6:** a late offline session is stored as a closed historical session. It never supersedes a live session that started after it.
- **Q7:** limits are checked against the day the session happened. Recorded time is accepted and flagged for review, never rejected.
- **Also:** BE-4 (the `webSwitch` race), T10 (take the lock before reading), T7 and T9 (how idle discard cuts time).
- **Decisions needed:**
  - approve "accept and flag, never drop";
  - decide whether overlap trimming should still skip duration-only manual time.

**Status: done on `fix/audit-phase2-offline-sync`.** The design and the four approved decisions are in [the offline sync design note](2026-10-29-offline-sync-design.md).

| Item | As built |
|---|---|
| Q6 | A start recorded offline, or older than the running timer, becomes a **backfill** session: `tracking_sessions.backfill` is true and the session is left out of the one-live index. It takes its own events, never supersedes or shortens the running timer, and overlap is trimmed when its time entries are created. Only a start happening now takes over a running timer. |
| Q7 | A desktop start more than 2 minutes before it reached the server counts as recorded offline. It skips the limit check and the project and task checks. Whatever those checks would have refused is kept and flagged: over the limit on the day or week it happened, a project archived, inactive or unassigned since then, or a task that can no longer take time (that time is kept without the task). Tracking turned off for the member, or desktop tracking off by policy, is still refused. |
| Flags | A new `time_review_flags` table holds one flag per member, day and reason. The `time.needs_review` event notifies the member's approvers, and the approval queue shows "Needs review". |
| Duration-only time | It stays out of overlap trimming. A day with both duration-only and tracked time is flagged (`duration_only_and_tracked`). |
| BE-4, T10 | `webSwitch`, `webStop` and `forceStop` lock the worker before reading the session. |
| T7 | Discarding a paused-then-resumed idle period leaves its paused span unrecorded and touches nothing after Resume. Reassigning it moves only that span. |
| T9 | Removing a span on the clock (idle discard, screenshot deletion) never cuts a duration-only entry. |

**Migration `0026_offline_backfill`:** it adds two session columns with defaults, rebuilds the one-live index and creates the flags table. It can be re-run, and no existing rows change.

**Not covered by a test:** BE-4 is a race. PGlite runs one query at a time, so the test database can't reproduce it. The fix is structural: the lock is taken before the read.

### Phase 3: money

- **First:** reconciliation tests on one dataset. One compares approved pay, payroll, the pay stub and the export. The other compares invoice lines, the PDF and the CSV.
- **Q8:** each time-off request stores its per-day hours at approval, and each period pays its own days. This needs a migration and a backfill.
- **Q10:** each billing entry stores its coefficient, and invoice lines are grouped and priced from it. This needs a migration.
- **Q9:** the budget rule for non-billable time.
- **F5, F6, F7:** exports, reports and budgets handle currency. Drafts and voids are left out of totals.
- **F8–F11:**
  - overtime on the pay stub;
  - the time-off rate;
  - rounding on invoice lines;
  - which client Summary credits.
- **Decisions needed:**
  - the Q9 rule;
  - F9: should time off use project rates?
  - F10: round per line instead of per entry? Invoice totals would change by cents.

**Status: done on `fix/audit-phase3-money`.** The design and the four approved decisions (all as recommended) are in [the money design note](2026-10-29-money-design.md).

| Item | As built |
|---|---|
| Reconciliation | For one dataset: approved pay (Amounts Owed) = the payroll line = the pay stub. Every invoice line is quantity × unit price, the lines add up to the subtotal, and subtotal + tax = total. The Billing report's "Invoiced" plus "Invoice rounding" equals the invoice's time lines. |
| Q8 | `time_off_requests.day_hours` is written when a request is made. Payroll, the Payroll Export and Summary pay the stored days inside each period. Example: a 40 h request crossing the semimonthly boundary, with a holiday added later, pays 32 h + 8 h. Before the fix it paid 24 h + 8 h. The migration fills in existing requests by spreading their hours over weekdays outside holidays (the previous rule). |
| Q10 | `billing_entries.bill_coefficient` and `pay_coefficient` are stored at approval. Invoice lines group and price by the stored multiplier. Entries approved before the migration are priced from amount ÷ hours. |
| Q9 | A money budget that includes non-billable time values it at the bill rate of the day it was worked, before and after approval. |
| F5 | The Invoices, Payments and Expenses reports and their CSV, Excel and PDF exports show one total per currency, and have a Currency column. Drafts and void invoices are not counted. The dashboard widget totals the org currency only. A report with one currency still returns `totals`. |
| F6 | Billing report rows are split by project, client and currency. The not-yet-approved estimate is priced in each client's currency. |
| F7 | Money budgets count only amounts in their own currency, and round once per budget. |
| F8 | The pay stub's overtime is calculated from approved time only. |
| F9 | Time off and paid holidays are paid at each day's worker or org rate. A line with paid time off but no rate has the `time_off_no_rate` warning, and the payroll page shows "No pay rate for time off". |
| F10 | Lines are quantity (4 decimals) × unit price, rounded once, including custom lines. The PDF prints the same quantity. The Billing report shows the difference from approved amounts as "Invoice rounding". |
| F11 | Summary credits approved money to the client it was billed to. |

**Migration `0027_money_integrity`:**
- adds `time_off_requests.day_hours` and fills it for existing requests;
- adds `billing_entries.bill_coefficient` and `billing_entries.pay_coefficient`;
- adds `payroll_run_lines.warnings`.

It can be run again safely.

**What users will notice:**
- Invoices issued from now on can differ by a few cents from approved billing, and the Billing report shows that difference.
- Finance reports show one total per currency.
- Payrolls that cross a period boundary, or include a raise in the middle of a time-off request, now pay the correct amounts.

### Phase 4: form integrity

- **U2:** the Edit entry dialog sends only the fields that changed, and the server checks `revision`.
- **U3:** the Edit project dialog sends only the fields that changed.
- **U5:** schedule versions can't overlap or leave gaps.
- **U6:** an expense takes its currency from the client.
- **U4:** archived records can be chosen in filters.
- **U7 / FE-4:** dialogs use the member's time zone.
- **T5:** the reminder uses the worker's time zone.
- **T6:** "used hours" when a timesheet is reopened.
- **U8.**
- **Tests:** E2E for each dialog, covering a concurrent edit, validation and the empty state.

### Phase 5: UX and naming

- **R1:** rename the "Timesheets" menu item to "Approvals".
- **R2:** one route for a member's timesheet.
- **R4:** Session history becomes a tab of Live.
- **R6:** rate fields say "from today".
- **R7:** "Pay period" becomes "Timesheet period".
- **R8, R9:** report and help category names.
- **R10:** the My timesheet gate.
- **Decision needed:** approve the renames and moves before work starts, because they change navigation that users already know.

### Order

Phase 0, 1, 2, 3, 4, 5. Phases 1 and 5 have no open design questions.

## I. Verification of the fixes in this branch

Files changed:
- `packages/api/src/services/pay-figures.ts` (Q1)
- `operations.ts` (Q2, Q4)
- `tracking.ts` (Q3)
- `finance.ts` (Q4)
- `report-runs.ts` (Q5)
- `packages/contracts/src/inputs.ts` (Q3)
- `apps/web/components/reports/save-dialog.tsx` (the Recipients hint)

Tests added:
- `packages/api/test/audit-oct28.test.ts`: 9 tests. 8 of them fail on the old code; the ninth is a control that must keep passing.
- `e2e/tests/web/qa/settings-integrations.spec.ts`: "refuses to schedule the payroll export to a worker".

Commands run after the fixes:

| Command | Result |
|---|---|
| `pnpm typecheck` | **Pass** (8 of 8 tasks) |
| `pnpm test --force` | **Pass**: api 580 passed + 2 skipped (53 files); domain 70; web 84; desktop 62; db 17; ui 11 |
| `pnpm test:e2e tests/web/qa/settings-integrations.spec.ts -g "Report runner"` | **Pass**: 2 of 2 (the new test and the existing @smoke test) |
| `pnpm test:e2e` (full regression) | **Pass**: 274 of 274 in 6.5 min |

Baseline before the changes:
- Typecheck passed.
- The first full Vitest run crashed 12 API test workers (Windows exit code 0x80000003) while the four reviewers were running alongside it. This was memory pressure, not a test failure.
- With 2 workers, the API suite gave 571 passed and 2 skipped.

Deployment: no migration. Behaviour changes that affect people:
- Custom roles with a narrow `rates:manage` or `time_off:manage` grant can no longer act outside their scope or on their own pay and balance.
- Existing scheduled reports stop emailing recipients who can't see the report. Their owners still receive them.
- Desktop "Reassigned" answers without a project are rejected. The desktop app only offers Keep and Discard (`App.tsx`) and the web has no Reassign control, so only direct API callers are affected.
