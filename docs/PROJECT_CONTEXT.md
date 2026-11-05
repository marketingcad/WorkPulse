# WorkPulse: project context

For developers and AI assistants starting work in this repo. It explains what the product does, who uses it and where, the business rules the code must keep, and where each concern lives. It points to the detailed docs instead of repeating them; [README.md](../README.md) is the full reference for architecture, the data model and setup, and [AGENTS.md](../AGENTS.md) holds the working rules.

Checked against the code on 6 November 2026 (desktop app 0.2.0).

---

## 1. What WorkPulse is

WorkPulse is a **workforce time tracking platform for organizations that pay or bill by the hour**: agencies, outsourcing and remote teams. Workers track time on their own computer with a desktop app. Managers and admins use a web app to see that time, approve it, and turn it into pay and invoices.

The business flow everything follows is **Organization → People → Work structure → Tracking → Time → Approval → Money → Insight**.

**Names.** *WorkPulse* is the product name people see. The technical name is *Tallywork*, and it has not changed: the `@tallywork/*` packages, `TALLYWORK_*` variables, the `tallywork.app` domain, the installed desktop app and its installers, and the `marketingcad/tallywork-desktop` releases repo. Don't rename these: installed apps rely on them for sign-in and updates.

---

## 2. Who uses it, and where

| Person | What they do | Where |
|---|---|---|
| **Owner / System admin** (`SYSTEM_ADMIN`) | Sets up the organization: people, teams, clients, projects, tracking policies, rates. Approves time, runs payroll, sends invoices, sees everything. | Web app, `/o/[orgId]/…` |
| **Team manager** (`TEAM_MANAGER`) | Manages the teams they lead: live tracking, activity, timesheet and time-off approvals, schedules, expenses, goals and reviews. Sees projects and clients they are assigned to. No rates, invoices or payroll. | Web app (same workspace, filtered by scope) |
| **Worker** (`WORKER`) | Tracks time, sees their own timesheet, activity, schedule, time off, pay stubs and performance. Submits timesheets, requests time off. | **Desktop app only.** The web app sends anyone whose role sees only their own work to `/download` (`isDesktopOnly` in [permissions.ts](../packages/domain/src/permissions.ts)). |
| **Client viewer** | Sees how their own projects are delivered: hours, tasks, shared milestones, optionally activity and screenshots. Never money. Can send appreciation, which waits for the organization's approval. | Client portal, `/portal/[accessId]` (invited per client; not a member of the organization) |
| **WorkPulse support staff** | Help customers. Can see an organization's details only while that organization has granted access (1–72 hours, under Settings → Security). Needs two-factor, and every view is written to the customer's audit log. | Support console, `/support` (listed in `SUPPORT_STAFF_EMAILS`) |
| **Integrations** | Other systems reading or writing data. | Public API with API keys (`Bearer tw_live_…`) and signed webhooks. See [docs/api](api/README.md). |
| **Company IT** | Install and configure the desktop app across many computers. | Installers, MDM / Group Policy settings. See [desktop-deployment.md](ops/desktop-deployment.md). |

Roles are data. The four built-in roles above can be copied into **custom roles**, which can grant any subset of permissions, never more than the admin creating them holds. A permission is `resource:action` plus a **scope**: `own`, `assigned` (projects they're on), `team` (teams they manage) or `org`. The full table is in [authorization-matrix.md](security/authorization-matrix.md), generated from the code.

**Who is tracked.** Invited workers start with tracking on. Owners, admins and managers start with it off, so they don't appear in Live tracking. An admin switches it per person.

---

## 3. The surfaces

| Surface | Code | Notes |
|---|---|---|
| **Web app** | [apps/web](../apps/web) (Next.js 16, App Router) | Admin and manager workspace under `app/o/[orgId]/`; sign-in pages in `app/(auth)/`; `/download`; `/device/authorize` (desktop browser sign-in); `/portal` (clients); `/support` (staff). |
| **API** | [packages/api](../packages/api) (Hono), mounted at `/api/v1/*` inside the Next.js app | One deployment, one origin. Route groups in `src/routes/`: `auth`, `org`, `time`, `ops-finance`, `insight-platform`, `performance`, `agent`, `portal`, `support`. |
| **Desktop app** | [apps/desktop](../apps/desktop) (Electron) | The worker's whole workspace, not only a timer: Home, Track, Timesheet, My performance, Time off, Schedule, Pay stubs, Settings. Works offline. Released to GitHub Releases with automatic updates. |
| **Browser extension** | [apps/extension](../apps/extension) (Manifest V3) | Reports the active tab to the desktop app on Windows, over a local `127.0.0.1` bridge. |
| **Hosting** | Vercel (Next.js + cron), PostgreSQL on Supabase, Supabase Storage, Resend or SMTP | Locally everything runs with no external services: PGlite (Postgres in WASM), local file storage, email printed to the console. |

---

## 4. How it works, end to end

1. **Onboarding.** An owner signs up, which creates the organization, its built-in roles and their membership. They add teams, clients, projects and tasks, set the tracking policy and invite people. A worker accepts the invitation and lands on `/download`.
2. **Desktop sign-in.** Email and password in the app, or "sign in with browser" (PKCE). The device gets its own token, bound to one organization, one person and one device. Revoking the device cuts access at once.
3. **Tracking.** The app sends *commands* (start, pause, stop) and *observations* (activity counts, idle time, app and website use, screenshots). **The server owns time:** it runs the session state machine and derives time entries; clients never write time entries. Events are written to an encrypted queue on disk before sending, so nothing is lost offline.
4. **Time.** Tracked work becomes time entries. Every edit creates a revision with who and why. Workers can request manual time; managers approve it.
5. **Approval.** Workers submit timesheets for a period: `DRAFT → SUBMITTED → APPROVED / REJECTED / changes requested`. Approval takes a snapshot.
6. **Money.** Approved time becomes billing entries priced by effective-dated rates. These feed client invoices (with billable expenses), payments, budgets, payroll runs and pay stubs.
7. **Insight.** Dashboards, reports with CSV, Excel and PDF export, scheduled reports, the Summary page, the Performance Center, notifications, webhooks and the audit log.

Side effects go through a transactional **outbox**: every change writes an event in the same transaction. Events are dispatched right after the response, with Vercel Cron as the backstop: `/cron/tick` every minute, and `/cron/daily` at 03:15 UTC. Diagrams for each step are in [README › How it works](../README.md#how-it-works).

---

## 5. Business rules the code must keep

These are product and legal commitments. Never weaken one to make a test pass ([AGENTS.md](../AGENTS.md)).

**Tenancy and access**
- Every tenant table has PostgreSQL **row-level security** and composite `(organization_id, id)` foreign keys. Services also scope by organization. Requests run in `withTenant`; only system jobs use `withSystem`. The app connects as a role that cannot bypass RLS.
- Checks happen in layers: the route guard (`requirePermission`), then a scope check in the service, then RLS. List endpoints apply the same scope filter as single reads, so lists, reports and exports never show more.
- A device token reads only its own worker's data (`/agent/me/*`) and **never receives screenshots**, even on a manager's or admin's computer.
- API keys reach only the endpoints their scopes list. The Performance Center, payroll and the portal are not open to them.

**Time**
- One live session per worker; starting elsewhere supersedes the old one. The session state machine is in [session-machine.ts](../packages/domain/src/session-machine.ts). Defaults: confirm within 120 s, recovery window 15 min, maximum pause 4 h, offline tracking up to 24 h. Organizations can override these in the tracking policy.
- Time history is **append-only** (`time_entry_revisions`).
- Daily and weekly limits stop tracking when they are reached. App updates never install while a timer is running.
- Time entries can be **locked** after a set number of days or before a set date.

**Privacy (decided on the device)**
- Keystrokes are **counted, never recorded**. Screenshots are blurred on the device when the policy says so. Website addresses are cut to the domain on the device in domain-only mode. Nothing is recorded unless a timer is running.
- Each monitoring feature (activity, screenshots, apps, websites) is switched on or off by the organization's policy.
- A client can see a worker's monitoring data only if the organization enables it, and the worker is told.
- **No performance score uses activity levels, keystrokes or screenshots.**

**Money**
- Amounts are stored as **integer minor units** (`*_minor`, e.g. cents) and must match to the cent across invoices, reports and exports.
- Rates are effective-dated, and the most specific one wins. Bill rate order: member-on-project, project, member, client, organization. Pay rate order: member-on-project, member, project, client, organization (`RATE_PRECEDENCE` in [billing.ts](../packages/domain/src/billing.ts)).
- **Each approved hour is paid exactly once.** Time approved after its payroll was finalized is paid by the next payroll ("from earlier periods"); overlapping payrolls are refused.
- Money is hidden from anyone without the finance permissions, including clients in the portal and team managers.

**Performance Center** ([packages/domain/src/performance.ts](../packages/domain/src/performance.ts))
- The score (0–100) comes from five outcomes: goal completion 30%, delivery against due dates 25%, approved-work consistency 20%, quality from manager reviews 15%, attendance 10%. A missing measure is left out and the rest re-weighted, never counted as zero. Weights are set per organization; each change is a new rules version.
- A period stays open for 14 days after it ends, then its score is final and never recalculated.
- People are ranked within their role family by default. Someone with too few approved days is shown as not ranked. Organizations choose whether workers and managers see rankings, and whether workers see their own score.
- A manager review's **private note is never shown to the person reviewed**, in any app.

**Support access**
- Staff see an organization's details only during a grant the organization created. Every view is audited as a `support` actor.

---

## 6. Where things live

| Concern | Code |
|---|---|
| Pure business logic: session machine, time maths, permissions, rates, payroll, performance scoring. No I/O. | [packages/domain/src](../packages/domain/src) |
| Request and response shapes (Zod), shared by API, web and desktop | [packages/contracts/src](../packages/contracts/src) (import browser-side values from subpaths such as `@tallywork/contracts/messages`, not the root) |
| Database schema, migrations, RLS | [packages/db](../packages/db) (Drizzle; schema in `src/schema/`) |
| API routes, services, background jobs, seed data | [packages/api/src](../packages/api/src) (`routes/`, `services/`, `jobs/`, `seed.ts`) |
| Shared React components and design tokens | [packages/ui/src](../packages/ui/src) |
| Web pages and features | `apps/web/app/` (routes), `apps/web/components/` (features) |
| Web sidebar | [apps/web/components/shell/nav.ts](../apps/web/components/shell/nav.ts) (plain data, unit-tested) |
| Desktop: main process, IPC contract, screens | `apps/desktop/src/main/`, [src/shared/ipc.ts](../apps/desktop/src/shared/ipc.ts), `src/renderer/src/` (sidebar in `nav.ts`) |
| End-to-end tests | [e2e](../e2e) (`tests/web`, `tests/desktop`, `tests/electron`) |
| Plans, decisions, operations, security | [docs/plan](plan/README.md) (decisions in `08-decisions.md`), [docs/ops](ops), [docs/security](security), [docs/api](api/README.md) |

**Dependency direction:** `domain` depends on nothing with I/O. `contracts` and `db` depend on `domain`; `api` on `db`, `contracts` and `domain`; the apps on the packages. Keep logic that both the API and the desktop app need in `domain`.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| Organization | A customer workspace (tenant). A person can belong to several. |
| Membership | A person in one organization, with one role. Most records point to a membership, not a user. |
| Agent / device | An installed desktop app, registered to one membership. |
| Session | One run of the timer, with WORK, IDLE and BREAK segments. |
| Time entry | A derived block of tracked or manual time; edited only through revisions. |
| Activity block | 10 minutes of activity (keyboard and mouse counts), aligned to the clock. |
| Tracking policy | The organization's (or a team's or person's) monitoring and tracking settings. |
| Timesheet | One person's time for one period, submitted for approval. |
| Billing entry | Approved time priced by bill and pay rates. |
| Payroll run | Pay for a period from approved time and paid time off; produces pay stubs. |
| Portal access | A client viewer's access to one client's dashboard. |
| Outbox event | A side effect recorded in the same transaction as the change, dispatched later. |
| Score snapshot | A person's Performance Center score for a period, with the rules version used. |

---

## 8. Working in this repo

- **Definition of done:** every change has tests that were run and passed: Vitest next to the code, and Playwright for anything a user sees or does, including permissions, empty, loading and error states. Report real results. Details: [AGENTS.md](../AGENTS.md), [e2e/README.md](../e2e/README.md).
- **Commands:** `pnpm dev` (web and API on :3000), `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. E2E runs against its own in-memory server on ports 3100/3101; never point tests at a shared or real environment.
- **Page weight:** each web route must stay under **250 KB** of first-load JavaScript (gzip). CI runs `apps/web/scripts/check-bundle-budget.mjs`, and `apps/web/test/bundle-imports.test.ts` stops things only needed after a click from coming back into every page. Load dialogs, tabs and rarely used panels with `React.lazy`.
- **Text:** web UI text goes through `t()` with message catalogs (`apps/web/messages/en.ts`, plus per-area catalogs such as `components/performance/messages/`).
- **Accessibility:** screens meet WCAG 2.1 AA in light and dark mode; the E2E sweeps check this with axe.
- **Database changes:** add a Drizzle migration in `packages/db`; migrations must be safe to run again ([README › Changing the database schema](../README.md#changing-the-database-schema)).
- **Desktop releases:** bump `version` in `apps/desktop/package.json`, merge to `main`, then run **Actions → Desktop release** and the Linux smoke test ([runbooks.md](ops/runbooks.md#desktop-release-staged)). Installed Windows and Linux apps update themselves; Macs are pointed to `/download`.

---

## 9. Read next

- [README.md](../README.md): architecture diagrams, request pipeline, data model (ERD), API overview, environment variables, deployment.
- [docs/plan/08-decisions.md](plan/08-decisions.md): why things are the way they are (ADRs).
- [docs/security/authorization-matrix.md](security/authorization-matrix.md): every permission for every built-in role.
- [Performance.md](../Performance.md): the Performance Center plan, status and known gaps.
- [docs/ops](ops): runbooks, desktop rollout, SLOs, screenshot retention.
