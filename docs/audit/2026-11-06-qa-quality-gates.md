# QA assessment and quality gates: 6 November 2026

Branch `qa/quality-gates`, from `main` at 3356cb0 (after PR #106). For developers and reviewers. All runs below used the isolated E2E server (in-memory database, ports 3100/3101) or the PGlite test harness; no shared, staging or production system was touched.

## A. Assessment

### What already exists

The repository had a mature automated suite before this work. Nothing was replaced; everything below reuses its tools and conventions.

| Layer | Tool and location | Size before this work |
|---|---|---|
| Pure logic | Vitest, `packages/domain/test` | 4 files (session machine, rates, permissions, payroll rules, performance scoring) |
| Database | Vitest + PGlite, `packages/db/test` | 5 files (RLS forced on every tenant table, composite tenant keys, migrations re-runnable) |
| API flows and security | Vitest + PGlite harness (`packages/api/test/harness.ts`, real Hono app, controllable clock) | 73 files, about 700 tests |
| Web logic | Vitest, `apps/web/test` | 23 files |
| Desktop agent and IPC | Vitest, `apps/desktop/test` | 15 files |
| Web E2E | Playwright, `e2e/tests/web` (stored sessions, `adminApi`, `ok`, `uid` fixtures; axe) | 66 specs |
| Desktop window E2E | Playwright (renderer in Chromium), `e2e/tests/desktop` | 9 specs |
| Real desktop app | Playwright Electron, `e2e/tests/electron` (Windows CI) | 3 specs |
| Live smoke | `e2e/live`, read-only, write-blocking fixture | 3 specs |
| CI | `ci.yml`: typecheck, all Vitest, load and latency smoke, build, bundle budget, PostgreSQL migrations, desktop on three OSes, Playwright web + desktop, Electron on Windows | |

Most Gate 1 invariants were already pinned: paying each approved hour exactly once, late-approved time carried to the next payroll, overlapping payrolls refused, append-only revisions with reasons, supersede on a second device, offline replay without double counting, device reads never returning screenshots, the private review note, tenant isolation on 44 listed routes, API key scope intersection with the creator, custom roles never exceeding their creator.

### Gaps found (Gate 1)

| # | Gap | Now |
|---|---|---|
| 1 | Cross-tenant checks used a hand-kept list of 44 GET and 10 write routes; about 200 of the 254 `/orgs/:orgId` routes (payroll, Performance Center, pay stubs, portal settings, support access…) had none, and new routes needed remembering | Covered for every route, read from the API's own route table |
| 2 | Nothing proved a full-scope API key cannot reach payroll, the Performance Center, portal settings or support access | Covered: keys reach exactly the documented list |
| 3 | Nothing proved a desktop token cannot call workspace routes (for example write time entries) | Covered: all 254 routes refuse device tokens |
| 4 | Session timeouts tested as transitions, not at their boundaries or with policy overrides | Covered to the second |
| 5 | Invitation tracking defaults (workers on; owner, admins, managers off) untested | Covered |
| 6 | Support grant edges (0, 1, 72, 73 hours; end of a 72-hour grant) untested | Covered |
| 7 | Pay rate precedence not asserted in full (member-on-project over member) | Covered, both orders |

## B. What was implemented

**Quality gates** (`quality-gates.json`, `scripts/quality-gates.mjs`, [docs/QUALITY_GATES.md](../QUALITY_GATES.md)): all 209 test files are classified into Gate 1 (68), Gate 2 (119) and Gate 3 (22). `pnpm test:gates` fails CI if a file is in no gate, in two, or missing. `pnpm test:gate1|2|3` run one gate. CI runs each gate as its own named step in the Vitest and Playwright jobs; Gates 2 and 3 still run and report when Gate 1 fails, and each Playwright gate keeps its own report and traces. `AGENTS.md` now asks for every new test to be put in a gate.

**New and extended tests**

| File | Gate | What it proves |
|---|---|---|
| `packages/api/test/route-boundaries.test.ts` (new) | 1 | Every org route: 404 to another organization, 403 to device tokens; an all-scope API key reaches exactly the endpoints in docs/api, and payroll, Performance Center, support access, audit log and API keys stay closed |
| `packages/api/test/session-timeouts.test.ts` (new) | 1 | Heartbeat grace (180 s), offline window (24 h), maximum pause (4 h): unchanged at the limit, acted on one second later, time counted only up to the last work; organization overrides (60 s grace, 30 min pause) |
| `packages/api/test/invitations.test.ts` | 1 | Tracking starts on for invited workers and off for the owner, admins and managers |
| `packages/api/test/support.test.ts` | 1 | Grants of 1–72 whole hours only; a 72-hour grant works at 71:59:59 and ends at 72:00:00 |
| `packages/domain/test/domain.test.ts` | 1 | Bill and pay rate precedence in the documented order, level by level; a rate of the other kind never stands in |
| `apps/web/test/bundle-imports.test.ts` | 3 | The Help page keeps its manual out of the first load |

## C. Execution results

All numbers are from runs in this session, on this branch.

| Suite | Result |
|---|---|
| `pnpm typecheck` | 8 of 8 workspaces |
| Gate 1 · Vitest (domain, db/RLS, API, desktop agent) | **600 passed** (65 + 22 + 457 + 56), 51 files |
| Gate 1 · Playwright (web, desktop window, Electron) | **102 passed** (3.1 min) |
| Gate 2 · Vitest | **558 passed**, 1 skipped (73 files) |
| Gate 2 · Playwright | 255 passed, **2 failed** (`profile-avatar.spec.ts`, see D-5); after the fix the file passed 15/15 (run 3 times) |
| Gate 3 · Vitest | **52 passed**, 1 skipped (7 files) |
| Gate 3 · Playwright | **465 passed** (accessibility, responsive, page health, forms) |
| After the Help fix: Help, video tutorial, a11y sweep, page health | **224 passed** on a fresh build |
| Web Vitest after the Help fix | 141 passed |
| Bundle budget | 75 routes, all under 250 KB; largest 248.1 KB; Help 237.8 KB (was 250.7) |
| `pnpm test:gates` | All 209 test files in exactly one gate |

The two skipped tests are the load smoke (`ops.test.ts`) and dashboard latency (`dashboard.test.ts`). They run only with `LOAD_SMOKE=1`, which CI sets in its own steps; they are not silently skipped. Gate 2 Playwright was not re-run as a whole after the avatar fix; only the changed file was (three times).

## D. Coverage matrix

| Module | Unit | Integration (API / DB) | API E2E | Web E2E | Desktop E2E | Status |
|---|---|---|---|---|---|---|
| Authentication | Covered | Covered (security-auth, mfa-hardening, email-verification, agent-login) | Covered (qa/api-security, qa/public-auth) | Covered (auth, two-factor) | Covered (Electron sign-in, sign-in feedback) | Covered |
| Organization and onboarding | — | Covered (flow, new-organization, invitations, tracking defaults) | Partially | Covered (organizations, invitations) | n/a | Covered |
| People | — | Covered (people-paging, staff-profile, workforce) | — | Covered (member-profile, profiles, qa/people-flows) | n/a | Covered |
| Permissions and tenancy | Covered (permission evaluator, generated matrix) | Covered (security, security-authz, work-scope, route-boundaries on all 254 routes, RLS) | Covered | Covered ("who cannot open it" in each page spec) | Partially (device grants in agent-me) | Covered |
| Tracking and sessions | Covered (state machine) | Covered (tracking, time-integrity, offline-sync incl. property test, session-timeouts) | — | Covered (offline-sync, time-rules) | Covered (clock-breaks, worker-status, Electron offline) | Covered (see G-1) |
| Timesheets | Covered | Covered (timesheets, timesheet-rules, timesheet-entry) | — | Covered (timesheet-decisions, consolidated, time-entries) | Partially | Covered |
| Payroll | Covered (overtime, pay rules) | Covered (payroll, money-p0/p1/phase3, time-money) | — | Covered (payroll, money-p0) | Covered (pay stubs, Electron download) | Covered |
| Invoices | Covered | Covered (finance, audit-phase1, invoice-reminder, invoice-export-filters) | — | Covered (invoices, finance-paging) | n/a | Covered |
| Performance | Covered (scoring) | Covered (performance-center, -foundation, -integrity, -jobs-isolation) | — | Covered (7 specs) | Covered (desktop/performance) | Covered |
| Client portal | — | Covered (portal, 34 tests) | — | Covered (portal, portal-insights) | n/a | Covered |
| Support console | — | Covered (support, incl. grant edges) | — | **Not Covered** (no `/support` E2E) | n/a | Partially Covered |
| Integrations (API keys, webhooks) | Covered (scope map) | Covered (integrations, route-boundaries) | Partially | Covered (qa/settings-integrations) | n/a | Partially Covered (D-2) |
| Desktop app | Covered (agent, IPC) | Covered (agent-me) | — | — | Covered (window: 9 specs; real app: 3 specs, Windows) | Covered on Windows; macOS and Linux run unit tests and the Linux release smoke only |
| Browser extension | **Not Covered** | Partially (the desktop side of the bridge: origin, loopback host, domain trimming, nothing when off) | — | — | — | Partially Covered |

## E. Defects

| ID | Severity | Module | Title | Status |
|---|---|---|---|---|
| D-1 | Medium | Integrations | An API key with `write:clients` could delete clients | **Fixed** |
| D-2 | Medium | Integrations | Seven documented read endpoints refuse every API key | Open: needs a decision |
| D-3 | Low | Integrations | `GET /workers/options` was open to `read:workers` keys, undocumented | **Fixed** |
| D-4 | High | Web (performance budget) | Help over the 250 KB budget; `main` CI red since PR #106 | **Fixed** |
| D-5 | Low | Tests | `profile-avatar.spec.ts` races with itself under parallel workers | **Fixed** |
| D-6 | Low | Tests | `time-entries.spec.ts` bulk-delete test collides with its own earlier run | **Fixed** |

**D-1.** *Steps:* create a key with `write:clients`; `DELETE /api/v1/orgs/:orgId/clients/:id` with it. *Expected:* 403, since docs/api lists create, update, archive and restore only. *Actual:* the delete ran. *Root cause:* the key allowlist (26 Sep) matched write routes by path for any method; client deletion (30 Oct) then became reachable. *Fix:* `packages/api/src/middleware/tenant.ts` names the method of every write rule and matches ids as UUIDs only. *Regression test:* `route-boundaries.test.ts`, "should_open_only_the_documented_endpoints_even_with_every_scope" (failed on D-1 and D-3 before the fix).

**D-2.** *Steps:* key with every scope; `GET /sessions`, `/screenshots`, `/apps`, `/urls`, `/rates`, `/budgets`, `/payments`. *Expected:* data, as docs/api lists them under `read:time`, `read:activity`, `read:billing` and `read:invoices`. *Actual:* 403. *Root cause:* each scope grants one permission (`read:time` → `time:read`), but these routes need another (`tracking:read`, `screenshots:read`, `apps:read`, `rates:read`, `budgets:read`, `payments:read`). *Not changed:* fixing it widens what keys can read, including screenshots, which is a product and privacy decision. Either map the scopes to the extra permissions or remove the rows from the docs.

**D-3.** As D-1: `/workers/[^/]+` matched the word `options`. Fixed by matching UUIDs only.

**D-4.** *Steps:* `pnpm --filter @tallywork/web build && node apps/web/scripts/check-bundle-budget.mjs`. *Expected:* every route ≤ 250 KB. *Actual:* `/o/[orgId]/help` 250.7 KB (CI run 42107704120 failed on this step). *Root cause:* the Help manual (`components/help/content.ts`, about 13 KB gzip) was in the first load; Help had 0.7 KB of headroom and the settings sidebar items from #106 used it. *Fix:* the page starts the manual's import at module level and reads it with `use()` under `Suspense` (a skeleton shows meanwhile); deep links to a guide still open it. Help is now 237.8 KB. *Regression test:* `bundle-imports.test.ts`, "the Help page loads the manual alongside it", plus the 224 Help, a11y and page-health specs.

**D-5.** *Actual:* "a worker cannot see or change anyone else's picture" failed at its check of the admin's own picture, and the upload test failed at the member list. Every privacy assertion in it passed. *Root cause:* both tests change the shared admin's picture and ran at the same time (`fullyParallel`). *Fix:* the file's tests run in order (`test.describe.configure({ mode: 'default' })`). *Regression:* the file passed 15 of 15 over three repeats.

**D-6.** *Actual:* "changing a filter clears the selection" failed in its setup with 422 `time_overlap` (2 of 3 repeats on one server). *Root cause:* it adds time at a fixed date and hour (3 Dec 2025, 10:00 and 11:00) and keeps one entry, so the next run on the same server overlaps it; the API refusing the overlap is correct. *Fix:* each run picks its own day in 2025. *Regression:* 5 of 5 repeats on one server.

**G-1 (product gap, not a defect in code).** The README and plan describe a session that starts `CREATED` and is stopped if not confirmed within 120 seconds. The state machine supports it, but the server never creates `CREATED` sessions; they start `ACTIVE`. Either implement the confirm window or update the diagram.

## F. Remaining risks

- **Support console** has no browser test (its API, two-factor requirement, grants and audit are covered in Vitest).
- **Browser extension** code (`apps/extension`) has no tests; only the desktop side of its bridge is tested.
- **Real desktop app** E2E runs on Windows only; macOS and Linux get unit tests in CI and the Linux release smoke test after publishing.
- **Visual regression** (screenshot comparison) does not exist. Gate 3 covers accessibility, layout overflow and page health instead.
- **D-2** and **G-1** need decisions.
- **Help** has 12 KB of headroom now, but the shared shell is about 231 KB of every page's 250 KB: further sidebar or shell additions should be lazy.

## G. Commands

| What | Command |
|---|---|
| Gate check | `pnpm test:gates` |
| One gate, everything | `pnpm test:gate1` (or `2`, `3`) |
| Unit and integration only | `node scripts/quality-gates.mjs run 1 --unit` |
| E2E only, web + desktop window | `node scripts/quality-gates.mjs run 1 --e2e -- --project=web --project=desktop` |
| All Vitest | `pnpm test` |
| All Playwright | `pnpm test:e2e` (Electron: `--project=electron`, Windows) |
| Smoke | `pnpm test:e2e:smoke` |
| Typecheck | `pnpm typecheck` |
| Accessibility | `node scripts/quality-gates.mjs run 3 --e2e` (axe sweeps are in Gate 3) |
| Bundle budget | `pnpm --filter @tallywork/web build && node apps/web/scripts/check-bundle-budget.mjs` |

## H. Continuation plan

1. Decide D-2 (map the scopes or correct the docs) and G-1 (implement the confirm window or correct the diagram).
2. Add a `/support` browser spec (staff sign-in with two-factor, grant required, grant expiry, audit entry).
3. Add tests for the extension (`background.js`, `popup.js`): message shapes, only the loopback bridge, nothing from incognito.
4. Consider a visual regression baseline for a handful of key screens in Gate 3, once screenshots can be made deterministic.
