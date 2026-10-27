# QA Project Context: WorkPulse (Tallywork)

Read by every skill in `.claude/skills` (installed from `petrkindlmann/qa-skills`).
Detected from the repository on 2026-10-27; each value cites its source. Repo rules in
[AGENTS.md](../AGENTS.md) take precedence over generic skill advice.

## Product

- **Name:** WorkPulse (technical name Tallywork: repo, `@tallywork/*` packages, desktop app). Source: README.md.
- **What it does:** workforce time tracking platform: activity monitoring, timesheets, payroll and billing. A web app for admins and managers, a desktop app (Electron) for workers, and a browser extension for website capture.
- **Type:** multi-tenant B2B SaaS (organizations, roles, RLS).
- **URLs:**
  - Production: https://tallywork-alpha.vercel.app (README.md)
  - Local dev: http://localhost:3000 (`pnpm dev`, PGlite in `apps/web/.data`)
  - E2E: http://localhost:3100 (web + API), http://localhost:3101 (desktop window)
  - Staging: referenced by `load/README.md` for load tests; URL unknown, not in the repo.
- **Critical user journeys** (from README.md "Organization → People → Work → Tracking → Time → Approval → Money → Insight"):
  1. Sign-up, sign-in, two-factor, invitations and joining an organization.
  2. Worker clocks in / out on the desktop app (breaks, idle, offline sync); no tracked time is lost or double counted.
  3. Timesheet submit → approve / reject / request changes, with time-entry locks.
  4. Payroll: run from approved time + paid time off, finalize, mark paid; each approved hour paid exactly once.
  5. Invoices and payments: totals match time to the cent; void and payment flows safe under concurrency.
  6. Permissions and tenant isolation: roles and scoped grants (projects, clients, payroll, bank details).
  7. Activity monitoring and screenshot retention (privacy rules, scheduled deletion only after approval).
  8. Reports and exports (CSV / XLSX / PDF), personal data export.

## Tech Stack

pnpm 10.18 + Turborepo monorepo, Node >= 24 (`package.json`, `pnpm-workspace.yaml`, `turbo.json`).

| Workspace | Stack | Source |
|---|---|---|
| `apps/web` | Next.js 16.3.8 (App Router), React 19.3.0, Hono API mounted in Next | apps/web/package.json, pnpm-lock.yaml |
| `apps/desktop` | Electron 44.4.5, React 19.3.0 renderer, preload bridge `window.tallywork` | apps/desktop/package.json, e2e/README.md |
| `apps/extension` | Browser extension for website capture | README.md |
| `packages/api` | Hono + Zod 4, Drizzle ORM 0.45 | packages/api/package.json |
| `packages/db` | Drizzle schema + migrations, PGlite 0.5 locally/tests, PostgreSQL 16 in prod and CI | packages/db/package.json, ci.yml |
| `packages/domain`, `contracts`, `ui` | Pure logic, shared Zod contracts, UI components | package.json files |

- **Hosting:** Vercel; database and file storage on Supabase; Upstash Redis for rate limits (turbo.json env, README.md).
- **API style:** REST under `/api/v1`.

## Test Stack

### E2E / Integration
- **Framework:** Playwright `@playwright/test` 1.64.0 (pinned, root and e2e package.json).
- **Config:** `e2e/playwright.config.ts`. Projects: `web`, `desktop` (renderer in Chromium with a real API bridge), `electron` (real app), opt-in `firefox` / `webkit` smoke via `E2E_CROSS_BROWSER=1`.
- **Test directory:** `e2e/tests/{web,desktop,electron}`, plus `e2e/tests/web/qa/`. About 235 tests (README.md); 52 `@smoke` tags.
- **Servers:** `e2e/scripts/serve-web.mjs` (build + start on :3100, fresh in-memory PGlite, email/storage off), `serve-desktop.mjs` (:3101).
- **Data:** `e2e/support/global-setup.ts` creates a per-run org, users and payroll; stored sessions in `e2e/.auth/` (admin, worker). Fixtures in `e2e/support/fixtures.ts`.
- **Settings:** fullyParallel, workers 3 local / 2 CI (single-connection PGlite), retries 0 local / 1 CI, trace/video/screenshot on failure, timezone UTC, locale en-US.

### Unit / API / DB (Vitest 5.0.1)
- `packages/domain/test`: pure logic.
- `packages/api/test`: API flows, permissions, tenant isolation (PGlite harness `test/harness.ts`).
- `packages/db/test`: RLS.
- `apps/web/test`: browser-side logic. `apps/desktop/test`: agent and IPC contract.

### Performance
- k6 scripts in `load/k6` + `load/provision.ts`, run against staging only (load/README.md).
- CI load smoke: ingest p95 < 500 ms (20 agents), dashboard p95 < 300 ms; bundle budget 250 KB gzip first-load JS per route.

### Visual / Accessibility
- No visual regression tool detected. WCAG 2.1 AA claimed for main screens (README.md); dedicated a11y test tooling not detected.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) on every push to `main` and every PR:
- **verify:** typecheck, Vitest for domain/ui/db/api/web, load smoke, dashboard latency, web build, bundle budget.
- **postgres:** applies all migrations twice on real PostgreSQL 16; checks the app role can't rewrite the audit log.
- **desktop:** agent tests on Windows, macOS, Ubuntu.
- **E2E (Playwright):** Ubuntu, `pnpm test:e2e --project=web --project=desktop`.
- **E2E desktop app:** Windows, `--project=electron`.
- Artifacts: `playwright-report`, `playwright-report-electron`, kept 14 days.
- Manual: `desktop-release.yml` (builds installers), `desktop-linux-smoke.yml` (installs published Linux packages and checks startup).
- Deploy gating on Vercel: unknown; not inspected.

## Environments

| Env | DB | External services |
|---|---|---|
| Vitest | PGlite in-process | rate limits off unless header `x-test-rate-limit: on` |
| E2E | in-memory PGlite, recreated per server start | email, Supabase Storage, Vercel Blob off; rate limits ON; global setup refuses non-localhost |
| Local dev | PGlite in `apps/web/.data` | per `apps/web/.env` |
| CI postgres job | PostgreSQL 16 service | none |
| Production | Supabase PostgreSQL | Supabase Storage, Upstash Redis, email |

Parity gap: tests run on PGlite, production on PostgreSQL. Migrations are checked on real Postgres, but query behaviour under load and concurrency is only exercised in the k6 staging runs.

**Never** point tests at staging, production or real customer data (AGENTS.md).

## Quality Goals

Agreed (from AGENTS.md and CI):
- Every change ships with Vitest + Playwright tests that were run and passed; full `pnpm test:e2e` and `pnpm typecheck` before done.
- Performance budgets: ingest p95 < 500 ms, dashboard p95 < 300 ms, first-load JS < 250 KB gzip per route.
- Business rules, permission checks and security controls are never weakened to make a test pass; failing tests are never skipped or deleted.

Unknown / not agreed: coverage targets, flake-rate tolerance, E2E suite duration budget (README cites about 2 min cold, 20 s with `E2E_SKIP_BUILD=1`).

## Risk Areas

Evidenced by recent audit fixes in README.md (PRs #56–#72). Likelihood scores are proposals; there is no incident history in the repo.

| Area | Risk Level | Business Impact | Notes |
|---|---|---|---|
| Payroll and pay calculation | Critical | Wrong pay, double pay | Recent fixes: holiday paid twice, overtime across periods, paid-once rule, concurrency on finalize |
| Time tracking accuracy | Critical | Lost or double-counted hours | Running timer counted twice, idle discard, offline sync overlap, locks |
| Permissions and tenant isolation | Critical | Data leak across orgs or scopes | Scoped grants leaked all projects and payroll/bank details before PRs #64–#71 |
| Invoices and payments | Critical | Billing errors, money under concurrency | Void/payment race fixes, decimal comma parsing |
| Two-factor and auth | Important | Account takeover | Lockout, password-checked changes, owner reset (PR #63) |
| Desktop app (Electron) | Important | Workers can't track | Native modules, keychain, OS-specific startup; 3-OS CI + Linux smoke |
| Screenshot retention / privacy | Important | Data deleted wrongly or kept too long | Deletion only after approval, server enforced |
| Reports and exports | Monitor | Figures disagree between screens | Rounding per entry must match approved pay |
| PGlite vs PostgreSQL parity | Monitor | Bugs only in prod | Proposed; see Environments |

## Team

Unknown; not in the repo. Commits come from a single GitHub account (`marketingcad`). Dev:QA ratio and methodology unknown. Current model per AGENTS.md: developers own all tests (unit, API, E2E).

## Conventions

- **Spec layout:** one spec per feature, `e2e/tests/web/<feature>.spec.ts` or `e2e/tests/desktop/<feature>.spec.ts`; unit tests in each package's `test/` folder.
- **Selectors:** accessible first. `getByRole` (about 760 uses), `getByLabel` (about 255), `getByText` (about 200); `data-testid` only when nothing accessible identifies the element (8 uses). Copy names from source or `apps/web/messages/en.ts`; never guess.
- **Waiting:** web-first `expect(...)` auto-waiting only; never `waitForTimeout`.
- **Test data:** per-run org from global setup + records created per test with `unique(...)` names; no cross-test dependencies; no cleanup (DB is thrown away).
- **Sign-in:** reuse stored sessions (`ADMIN_STATE`, worker state); never sign out the shared admin session; rate limits are on in E2E.
- **Tags:** the one or two critical journeys per feature get `{ tag: '@smoke' }`.
- **Coverage per change:** main journey, validation and errors, empty and loading states, permissions (who must not see or do it), and the regression that motivated a fix.
- **Commands:** `pnpm --filter <pkg> test`, `pnpm test:e2e <file>` or `-g "<title>"`, `pnpm test:e2e`, `pnpm test:e2e:smoke`, `pnpm typecheck`.
- **Branching:** feature branches (`fix/...`, `docs/...`) merged to `main` through PRs.
