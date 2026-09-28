# 18. Development Roadmap

**Release markers:**
- **MVP** = end of Phase 7. An org can track (web + desktop, activity, screenshots, apps), then edit, submit, and approve timesheets.
- **Parity release** = end of Phase 13.
- **GA** = end of Phase 14.

**Gate after every phase** (brief §84): lint · typecheck · unit · integration · build · migrations up/down on a fresh DB and on a seeded DB · authorization suite (role × endpoint) · tenant-isolation suite (org A ↛ org B) · responsive check (360 / 768 / 1280) · axe a11y scan · Electron build on the Win/macOS/Linux CI matrix (from Phase 5) · sync tests (from Phase 5) · docs and feature matrix updated. **Do not proceed with a red gate on security or data-integrity checks.**

---

### Phase 0 — Product Discovery *(this document)*
- **Goal:** a shared understanding of scope, domain, roles, and the tracking model.
- **Features:** feature map, workflows, business rules, role/permission catalogue, tracking model, gap analysis.
- **Database / API / Web / Electron changes:** none.
- **Tests:** none. Review of the business rules with stakeholders.
- **Acceptance:** plan approved. Open questions in [08-decisions.md](08-decisions.md#open-questions) resolved or given defaults.
- **Dependencies:** none. **Risks:** scope creep, which is mitigated by the phased feature matrix.

### Phase 1 — Architecture
- **Goal:** decisions locked. The contracts that are expensive to change get written down.
- **Features:** ADRs, ERD, event catalogue v1 (`packages/events`), permission catalogue v1, API style guide, design tokens v1, threat model (STRIDE) for ingest/agent/auth.
- **Database:** ERD reviewed; naming and partition conventions set.
- **API:** OpenAPI skeleton and error format.
- **Web:** token sheet and a component inventory.
- **Electron:** spike to prove uiohook count-only capture, get-windows, desktopCapturer, SQLCipher, and safeStorage on all 3 OSes.
- **Tests:** spike results documented.
- **Acceptance:** the native spike works on Win11, macOS 14+, and Ubuntu X11, with the Wayland limitations documented.
- **Dependencies:** Phase 0. **Risks:** native module ABI/packaging pain. Mitigate early with electron-rebuild in CI.

### Phase 2 — Foundation
- **Goal:** a secure multi-tenant skeleton that is deployable.
- **Features:** monorepo, CI, dev compose, Next shell (AppShell, Sidebar, Topbar, auth pages), Nest app, config, logging/OTel, auth (signup, login, verify, reset, sessions, TOTP), orgs, memberships, invitations, roles and permissions engine, audit writer, outbox table plus relay skeleton, RLS.
- **Database:** users, organizations, memberships, roles, permissions, role_permissions, invitations, user_sessions, mfa_factors, audit_logs(P), outbox_events, idempotency_keys. RLS policies and composite FK pattern.
- **API:** `/auth/*`, `/me`, `/orgs`, `/invitations`, `/roles`, `/permissions`.
- **Web:** login/signup/invite flows, org switcher, empty overview, settings → organization, roles.
- **Electron:** none.
- **Tests:** argon2 hashing, session rotation, MFA, permission evaluator unit tests; **tenant-isolation harness** (auto-enumerates routes); RLS test (the query without context returns 0 rows); axe on auth pages.
- **Acceptance:** two orgs are created; users in org A cannot see anything in org B via API or by direct SQL through the app role; the audit log records role changes; deploys to staging.
- **Dependencies:** Phase 1. **Risks:** RLS + connection pooling (`SET LOCAL` inside transactions only, pgbouncer in transaction mode). Covered by a dedicated test.

### Phase 3 — Workforce structure
- **Goal:** the org can model its people and work.
- **Features:** workers and profiles, teams and managers, clients and contacts, projects (members, teams, archive), tasks (assignees, status, priority, due, estimate), tracking policies with inheritance, devices (admin view only for now), CSV member import, seed script v1.
- **Database:** worker_profiles, teams, team_members, clients, client_contacts, projects, project_members, project_teams, tasks, task_assignees, tracking_policies, policy_acks, devices, device_credentials.
- **API:** the workers/teams/clients/projects/tasks/policies/devices CRUD, `me/assignments`, `workers/{id}/effective-policy`.
- **Web:** DataTable v1 (sorting, filtering, column picker, density, bulk bar), list and detail pages, policy editor with inheritance display, Worker detail (Overview tab).
- **Electron:** none.
- **Tests:** team-scope evaluator (a manager sees only their teams), policy resolution (org → team → worker), archive rules, CSV import validation.
- **Acceptance:** seeded org of 30 workers, 4 teams, 10 clients, 20 projects, and 100 tasks renders; a manager sees only their teams' workers.
- **Dependencies:** Phase 2. **Risks:** the permission-filter design leaking into repositories inconsistently. Mitigate with a single `scopedQuery()` helper.

### Phase 4 — Tracking engine + web timer
- **Goal:** authoritative time tracking.
- **Features:** session state machine (`packages/domain`), commands, segments, time-entry derivation (midnight/DST split), single-timer rule, stale sweeper, SSE stream, presence, web timer bar, notifications core (in-app plus email provider abstraction).
- **Database:** tracking_sessions (with partial unique index), session_transitions, time_segments, time_entries, time_entry_revisions, ingest_receipts, notifications, notification_preferences.
- **API:** `/tracking/*`, `/sessions`, `/stream`, `/time-entries` (read), `/notifications`.
- **Web:** timer bar in the top bar, worker "Today" page, Sessions list, Live view.
- **Electron:** none.
- **Tests:** exhaustive state-machine table tests (every from × trigger); property tests for time math (no overlap, totals conserved across midnight/DST); concurrent start race (the DB constraint holds); idempotent start/stop.
- **Acceptance:** start on a tab and see it in another tab live; start on a second browser supersedes the first; totals are correct across a DST boundary fixture.
- **Dependencies:** Phase 3. **Risks:** time-zone bugs. Mitigate with a fixture suite over several TZs, including half-hour offsets.

### Phase 5 — Electron agent core
- **Goal:** a desktop timer that survives the real world.
- **Features:** Electron shell with the security checklist, PKCE login, device registration plus keypair, bootstrap, project/task command search, timer UI, tray, PowerWatcher (sleep, lock, shutdown), encrypted offline queue, sync engine with skew correction, heartbeat, updater (staging channel), crash reporting, consent/transparency panel, capability report.
- **Database:** device credential families, `devices.capabilities`, policy_acks usage.
- **API:** `/auth/device/*`, `/agent/register`, `/agent/bootstrap`, `/agent/ingest/batch`, `/agent/heartbeat`, device revoke/reauth.
- **Web:** Devices page (status, version, last sync, revoke), device authorize page.
- **Electron:** everything above.
- **Tests:** Playwright-Electron E2E (login → start → stop); offline simulation (drop network 30 min → events replay, no duplicates); kill -9 mid-session recovers; clock jump ±2h is corrected; token reuse detection; IPC fuzz (invalid payloads rejected); signed builds verified in CI.
- **Acceptance:** tracking 2h with the network toggled off/on randomly gives server totals within ±5s of agent-local elapsed; revoking a device stops ingest in ≤ 30s.
- **Dependencies:** Phase 4. **Risks:** code-signing and notarization lead time. Start acquiring certificates in Phase 1.
- **Delivered (Revision 4):** ✓ desktop sign-in, now primarily email + password in the app with 2FA and organization choice, PKCE via the browser as the alternative (ADR-129). ✓ Updater: GitHub Releases feed, `latest`/`beta` channels, 6-hour checks, install on quit (ADR-131). ✓ Win/macOS/Linux builds in CI ("Desktop release" workflow) and a Linux smoke test on Ubuntu 24.04. ✓ Linux keyring requirement and Wayland capability reporting (ADR-132). ✗ Signed builds are not in place yet (see Follow-ups).

### Phase 6 — Activity monitoring
- **Goal:** activity %, idle, screenshots, apps, URLs with privacy controls, plus the Activity review UX.
- **Features:** ActivityMonitor (counts), IdleDetector + idle sheet + resolution, ScreenshotService (random interval, multi-monitor, blur, delete-with-time), AppTracker, UrlTracker plus the Chrome/Edge extension (Native Messaging), projectors for activity windows and app/URL rollups, thumbnail worker, signed media URLs, access logging of screenshot views.
- **Database:** activity_minutes(P), activity_windows, idle_events, screenshots(P), app_spans(P), url_spans(P), rollup_activity_block, rollup_app_day, rollup_url_day, file_objects.
- **API:** `/agent/screenshots/*`, `/activity/*`, `/screenshots`, `/apps`, `/urls`, `/idle-events`.
- **Web:** Activity → Screenshots (three-pane review, timeline ribbon, 10-min blocks, filters, keyboard navigation), Apps, URLs; worker's My Activity; policy editor monitoring section.
- **Electron:** monitors, idle sheet, screenshot notice plus self-delete.
- **Tests:** unit test that asserts no key codes persist (hook callback contract); activity % math; idle retroactive start; blur applied before upload (the uploaded bytes differ from the original and pass a blur metric); excluded domains are never sent; screenshots only during ACTIVE; signed URL expiry; worker cannot fetch another worker's screenshot (403/404).
- **Acceptance:** a manager reviews a day for a worker (blocks, screenshots, apps, URLs) in under 2s load time with seeded data; policy changes propagate to the agent in ≤ 60s and require re-acknowledgement.
- **Dependencies:** Phase 5. **Risks:** macOS permission UX, Wayland, antivirus flagging the input hook. Mitigate with clear onboarding, capability flags, signed binaries, and vendor allowlisting docs.

### Phase 7 — Timesheets (→ **MVP**)
- **Goal:** accurate, approvable time.
- **Features:** timesheet periods from the org pay period, week/day/calendar views, time edits (trim, split, reassign, delete) with reasons and revisions, manual time requests plus policy (auto-approve vs require approval), approvals queue (single/bulk/reject/request changes/reopen), locking, notifications.
- **Database:** timesheets, timesheet_entries, approval_actions, manual_time_requests.
- **API:** `/timesheets/*`, `/manual-time/*`, time-entry mutations.
- **Web:** TimesheetGrid, day list, calendar drag-create, Approvals queue with ApprovalPanel (activity context).
- **Electron:** offline manual-time request, "timesheet due" reminder.
- **Tests:** lifecycle transitions; locked entries reject edits (422); revision chain integrity; approval snapshot is immutable after later edits (edits require a reopen); manager team scope on approvals.
- **Acceptance:** the E2E flow runs green: register → org → worker → project → task → agent → track → activity/idle/screenshot → stop → timesheet → submit → approve.
- **Dependencies:** Phase 6 (activity context), Phase 4. **Risks:** edit semantics complexity. Keep one domain function per edit type with property tests.

### Phase 8 — Workforce operations
- **Goal:** attendance, schedules, limits, time off, breaks.
- **Features:** schedules (rrule) plus shifts plus exceptions, attendance derivation (late/early/absent/overtime), shift alerts, daily/weekly limits enforced server-side plus agent warnings, break types and policies, time-off policies (accrual rules, carry-over), ledger balances, requests/approvals, holidays, team calendar, pay periods and overtime rule sets.
- **Database:** work_schedules, shifts, attendance_days, holiday_calendars, holidays, time_off_policies, time_off_ledger, time_off_requests, break_types, overtime_rules.
- **API:** `/schedules`, `/shifts`, `/attendance`, `/time-off/*`, `/holidays`.
- **Web:** Schedules week view, Attendance roster, Time Off (balances, request, queue, calendar), Worker detail tabs.
- **Electron:** limit warnings and auto-stop, break start/stop, shift reminders.
- **Tests:** accrual math (monthly/annual, pro-rata, carry-over caps); attendance classification fixtures; overtime rules (weekly > 40, daily > 8, configurable); limit enforcement races.
- **Acceptance:** a seeded month shows correct attendance statuses; a limit stops the timer within 60s of being reached.
- **Dependencies:** Phase 7. **Risks:** jurisdiction-specific overtime. Keep it rule-driven and configurable; no legal claims.

### Phase 9 — Finance
- **Goal:** money is accurate and traceable.
- **Features:** effective-dated pay/bill rates with scope resolution, billable classification, billing entries on approval, amounts owed, budgets (hours/money, thresholds, projection), expenses plus receipts plus approval plus reimbursement, invoices (composer, numbering, taxes, PDF, states, overdue job), payments plus allocations, payment provider interface (manual provider first; Stripe adapter as P1-late).
- **Database:** billing_rates, billing_entries, budgets, expenses, invoices, invoice_lines, invoice_sequences, tax_rates, payments, payment_allocations.
- **API:** `/rates`, `/billing/*`, `/budgets`, `/expenses`, `/files/upload-intent`, `/invoices/*`, `/payments/*`.
- **Web:** Billing, Budgets, Expenses, Invoice composer plus list plus detail, Payments.
- **Electron:** none.
- **Tests:** money arithmetic (banker's rounding rules documented, per-line vs total tax), rate resolution precedence, rate change does not reprice approved time, one-invoice-per-billing-entry constraint, budget threshold emits once per level, invoice status derivation (partial/paid/overdue/void).
- **Acceptance:** an invoice generated from approved time reconciles exactly with the Billing report and Amounts Owed.
- **Dependencies:** Phase 7. **Risks:** currency/tax complexity. Single currency per invoice; tax catalogue; no automatic tax calculation (explicitly out of scope).

### Phase 10 — Dashboards
- **Goal:** role-aware operational dashboards.
- **Features:** widget framework, the full widget catalogue, per-scope layouts, edit mode (keyboard-accessible drag and sizes), SSE live widgets, email digests.
- **Database:** dashboard_layouts, rollup_worker_day, rollup_worker_hour, rollup_project_budget (if not already added).
- **API:** `/dashboards/me`, `/widgets/{key}`.
- **Web:** three default dashboards and the customization UI.
- **Electron:** none.
- **Tests:** each widget's permission and scope filter; rollup correctness vs source (reconciliation test); p95 widget latency < 300ms on seeded data ×10.
- **Acceptance:** each role sees a useful default dashboard immediately after seeding.
- **Dependencies:** Phases 6–9. **Risks:** rollup drift. The nightly reconciliation job plus a drift metric alarm.

### Phase 11 — Reports
- **Goal:** a broad, trustworthy reporting suite.
- **Features:** report definition engine; the 17 reports (Time & Activity, Daily Totals, Work Sessions, Apps & URLs, Manual Time, Timesheet Approval, Expenses, Work Breaks, Amounts Owed, Payments, Project Budgets, Client Budgets, Attendance, Time Off, Billing, Invoices, Audit); payroll export; saved plus scheduled reports; async exports (CSV/XLSX/PDF); opt-in org-defined app/URL categories (P2).
- **Database:** saved_reports, report_schedules, report_runs, any missing rollups/matviews.
- **API:** `/reports`, `/reports/{key}/query|export`, `/report-runs`, `/saved-reports`.
- **Web:** report catalogue plus template (filters, group-by, KPI strip, chart, table, export, save, schedule).
- **Electron:** none.
- **Tests:** each report's totals reconcile with source tables on fixtures; scope filters on every report; 1M-row export completes and streams (memory stays under the budget); scheduled report fires in the org TZ.
- **Acceptance:** all 17 reports plus payroll export are available and permission-correct; exports are delivered via signed links.
- **Dependencies:** Phase 10. **Risks:** slow queries. Measure, then add matviews.

### Phase 12 — Integrations
- **Goal:** open the platform.
- **Features:** scoped API keys, public API docs, webhooks (signing, retries, logs, replay, SSRF guard), integration framework (connections, external refs, sync job skeleton), Firefox extension, subscription billing for our SaaS (G1) behind feature flags.
- **Database:** api_keys, webhook_endpoints, webhook_deliveries, integration_connections, external_refs, subscriptions.
- **API:** `/api-keys`, `/webhooks/*`, public docs.
- **Web:** Developer section.
- **Electron:** none.
- **Tests:** key scope intersection with creator permissions; secret is shown once and never logged; webhook signature verification sample; SSRF test matrix (private IPs, DNS rebinding); retry schedule.
- **Acceptance:** a sample external consumer reads timesheets with a `read:timesheets` key, is denied `read:billing`, and receives a `timesheet.approved` webhook.
- **Dependencies:** Phases 7–11. **Risks:** SSRF and secret leakage. Mitigated by a dedicated test matrix and the log redaction list.

### Phase 13 — Security, audit, retention (→ **Parity release**)
- **Goal:** compliance-ready controls.
- **Features:** audit log UI plus export, screenshot access logs, retention policies plus cleanup jobs (partition drops, S3 batch delete), security settings (enforce MFA, session TTL, IP allowlist, device approval), custom roles UI, DSAR export and anonymized deletion, permission review screen.
- **Database:** retention_policies, security_settings; custom role editing.
- **API:** `/audit-logs`, `/retention-policies`, `/security-settings`, `/roles` (full), worker data export.
- **Web:** Settings → Security, Retention, Roles; Audit report.
- **Electron:** honours new security settings (e.g. forced re-auth).
- **Tests:** retention deletes exactly the expired data (and nothing protected by legal minimums); audit is append-only (UPDATE denied at the DB role); custom role cannot exceed its creator; full auth matrix regenerated.
- **Acceptance:** external security review (pen test) with no open high/critical findings.
- **Dependencies:** all prior. **Risks:** destructive retention bugs. Dry-run mode, then soft-delete for 7 days, then purge.

### Phase 14 — Production hardening (→ **GA**)
- **Goal:** reliability at scale.
- **Features:** load tests (10k concurrent agents, 1 batch per 30s each), DB tuning, partition automation (pg_partman), autoscaling, backups plus PITR plus restore drill, observability dashboards and alerts (API latency, ingest lag, queue depth, DLQ size, webhook failure rate, agent sync lag, crash rate), status page, runbooks, MDM installers (MSI/PKG) with enrollment tokens, support console (G2), i18n translations, final docs.
- **Database:** partition management, index review from pg_stat_statements.
- **API:** performance fixes only.
- **Web:** performance budgets (LCP < 2.5s on reports list, JS < 250KB per route).
- **Electron:** staged rollout channels, crash-free-rate SLO.
- **Tests:** k6 load tests, chaos tests (Redis outage → outbox backlog drains after recovery; PG failover), full cross-browser plus responsive plus a11y audit.
- **Acceptance:** SLOs met (API p95 < 300ms for reads, ingest p95 < 500ms, 99.9% availability target); restore drill succeeds within the RTO.
- **Dependencies:** all prior. **Risks:** unknown hot spots, handled by measure-first optimization.
- **Delivered (Revision 4):** ✓ desktop installers published with stable names and a `/download` page that picks the visitor's OS (ADR-128, ADR-131). ✓ Managed settings for MDM (registry policy, macOS configuration profile), see [desktop-deployment.md](../ops/desktop-deployment.md). The MSI/PKG targets are configured but not published, and there is no enrollment token yet.

### Also delivered outside the phase plan (Revision 4)
- ✓ WorkPulse brand in the UI (mark, lockup, favicon, desktop icon), technical names kept as Tallywork (ADR-125).
- ✓ Email through Resend or SMTP behind one `Mailer` interface (ADR-126).
- ✓ Optional email verification with sign-in from the emailed link (ADR-127).
- ✓ Workers are desktop-only; the web workspace is for admins and managers (ADR-128).
- ✓ Tracking defaults by role: Workers tracked, owner/admins/managers untracked until switched on (ADR-130).

### Follow-ups (open)
- **macOS signing and notarization:** enroll in the Apple Developer Program, sign with a Developer ID, notarize and turn the hardened runtime back on, so macOS installs updates itself instead of the notification that links to `/download`.
- **Windows code signing** (Authenticode, EV certificate recommended), so SmartScreen stops warning on first run.
- **Optional rename of the desktop system name to WorkPulse** (install folder, app bundle, Linux executable, installer files). Needs a `userData` migration so installed apps keep their sign-in and offline queue, and a plan for the update feed and managed-policy paths.
- **GNOME/KDE Wayland support** for activity, apps and screenshots (e.g. a GNOME Shell extension, KDE/KWin scripting, or portal-based screenshots), replacing the current "unavailable on Wayland" reporting.
- **Custom domain for sending email** (SPF/DKIM/DMARC on our own domain with Resend or another provider), plus bounce handling, instead of a shared or personal SMTP mailbox.
- Publish the per-machine `.msi` and `.pkg` from the release workflow.

### Future (tracked, not dropped)
Mobile apps with GPS/geofences/job sites (Location subsystem schema is ready from Phase 1), PM integrations (Jira/Asana/Trello/GitHub/Linear), accounting sync (QuickBooks/Xero), worker payouts, SSO/SCIM, kiosk mode, anomaly insights, WebAuthn.
