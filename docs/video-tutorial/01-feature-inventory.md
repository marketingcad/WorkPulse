# Feature inventory

What WorkPulse does, as built: checked against the web app's routes and menu (`apps/web/app`, `apps/web/components/shell/nav.ts`), the desktop app (`apps/desktop/src/renderer`), the Report library (`packages/api/src/services/reports.ts`) and the Help Center (`apps/web/components/help/content.ts`). The last column gives the scene that shows each feature.

## Who uses what

| Role | App | What they see |
|---|---|---|
| System Admin (owner and admins) | Web app | Everything in the organization | 
| Team Manager | Web app | Their teams and assigned projects; no rates, payroll or organization settings |
| Worker | **Desktop app only** (the website sends them to a download page) | Only their own data |
| Custom roles | Web app | The permissions an admin gives them, at the scope chosen: own, assigned, team or organization |
| Client portal user | Client portal | Read-only progress for their company; never money |

Menus follow permissions, so two people can see different menus (scene 14.1).

## Web app

| Area | Pages | Features | Scene |
|---|---|---|---|
| Getting in | Sign up, Log in, Forgot / reset password, Verify email, Invitation | Create an organization; sign in; password reset; join from an invitation | 02.1–02.3 |
| | Profile › Two-factor authentication | QR setup, 10 recovery codes, password-checked changes | 02.4 |
| Overview | Overview | Live cards (This month, Worked today, Waiting for approval, Project budgets, and more); scope All / Me / Member; Customize layout; Getting started checklist for new organizations | 03.1, 03.2, 02.1 |
| Shell | Sidebar, organization switcher, notifications, account menu | Menu groups; switch or create organizations; notifications; profile, What is monitored, theme | 03.3 |
| Help | Help Center, product tour | 45 guides with search, FAQ and troubleshooting; guided tour | 03.4, 15.1, 15.2 |
| Time Tracking | Time entries | Filter, edit with a reason, revision history, split, duplicate, bulk actions, Add time | 09.1, 09.2 |
| | Approvals · Team week | Approve, reject or request changes on timesheets; bulk approve; manual time requests; hours per member | 09.3, 09.4 |
| | Live · Session history | Who is working now; force stop a timer; session details | 08.1, 08.2 |
| | Activity | 10-minute activity blocks, screenshots, apps and URLs per member and day | 08.3 |
| | End-of-day reports | Clock-out reports grouped by day; read, step through, copy | 08.4 |
| Workforce | Members · Teams | Invite (role, teams, projects, shareable link); member profiles (HR details, devices, policy); teams with managers | 05.1–05.3 |
| | Schedules · Attendance | Versioned working hours per member; present / late / absent / on leave roster | 10.1, 10.2 |
| | Time off | Requests, calendar, policies with accruals, balances, holidays | 10.3 |
| Project Management | Clients | Client profiles, archive and restore, **delete a client that was never used**, client portal | 06.1–06.3 |
| | Projects | Dates, estimates, members and teams, rates, documents, **planned breaks** | 06.4, 06.5 |
| | Tasks | Status, priority, due date, estimate, assignees, archive and restore | 06.6 |
| Finance | Rates | Effective-dated bill and pay rates at organization, client, project, member or member-on-project level | 11.1 |
| | Budgets | Hour or money budgets per project or client, lifetime or monthly, warning level | 11.2 |
| | Expenses | Submitted with receipts; approve, reject, reimburse; billable to client | 11.3 |
| | Invoices · Payments received | Four-step invoice wizard, PDF, send, void, record and allocate payments | 11.4, 11.5 |
| | Payroll (Payrolls · Owed · Pay groups) | Pay groups, payroll runs from approved time, bonuses and deductions, finalize, mark as paid, pay stub PDFs, amounts owed | 11.6, 11.7 |
| | Export on every finance list | Period filter; CSV, Excel, PDF | 11.3 |
| Reports | Summary | Time, pay, billing, activity and days off per period, client, project and person | 12.1 |
| | Report library | 9 reports (Time & activity, Work sessions, Manual time edits, Apps & URLs, Timesheet approval, Attendance, Time off, Payroll export, Billing); filters, grouping, export, saved and scheduled reports | 12.2, 12.3 |
| Settings | Organization · Time & pay | Company details and logo; timesheet period and rules, overtime, time types, break types | 04.1, 04.2 |
| | Tracking policies | What the desktop app records, per organization, team or member | 04.3 |
| | Roles & permissions | Permission matrix; custom roles | 04.4 |
| | Devices | Approve, require sign-in again, revoke | 13.1 |
| | Security & retention · Access review | Require two-factor, session lifetime, device approval, IP allowlist; data retention; access review | 13.2 |
| | Screenshot retention | Retention period, preview and approval before any deletion, history | 13.3 |
| | API keys · Webhooks | Scoped, expiring keys; signed webhooks | 13.4 |
| | Audit log | Filter, details, CSV export | 13.5 |
| Account | What is monitored | Plain-language list of what is tracked and who can see it | 08.5 |
| Client portal | Portal settings and preview | What the client sees, preview as client, invite and revoke access | 06.3 |

## Desktop app (workers)

| Screen | Features | Scene |
|---|---|---|
| Download page and setup guides | Installer per system; step-by-step guide with pictures | 07.1 |
| Sign in | Email and password, or through the browser; device approval | 07.2 |
| Home | Clock in by choosing a project; timer; work note; Today's summary; activity | 07.3 |
| Breaks and idle | One-tap planned breaks with a countdown; idle prompt (keep or discard) | 07.4 |
| Clock out | End-of-day report, saved on the computer first; offline tracking | 07.5 |
| Track (Projects · Tasks · Sessions) | Start from a project or task; session list; manual time requests | 07.6 |
| Timesheet (Timesheet · Activity · Reports) | Hours by day, Submit; own activity, apps and websites; personal reports | 07.7 |
| Time off · Schedule · Pay stubs · Settings | Request time off; working hours; pay stub PDFs; account and device | 07.8 |

## Not covered in the video

These exist but are left out to keep the video focused; they are in the Help Center:

- The WorkPulse support console (internal staff only).
- Browser extension setup for website tracking on Windows (it is part of the desktop install).
- Each Report library report one by one (the video shows one, and the rest work the same way).
- Data export and erasure for a member (mentioned in 13.5).
- CSV time import (mentioned in 09.2).
