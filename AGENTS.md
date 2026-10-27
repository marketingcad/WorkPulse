# Working in this repository

WorkPulse (technical name Tallywork) is a pnpm + Turborepo monorepo. See [README.md](README.md) for the architecture, and [apps/web/AGENTS.md](apps/web/AGENTS.md) for the Next.js version notes.

## Definition of done: every change ships with tests

A feature or change is not finished until it has automated tests that were **run and passed**. Writing test files is not enough.

1. **Inspect the change.** List the affected code, the user flows (pages, dialogs, desktop screens), the API endpoints and the roles involved.
2. **Unit and integration tests (Vitest)**, next to the code:
   - `packages/domain/test`: pure logic.
   - `packages/api/test`: API flows, permissions and tenant isolation, using the PGlite harness in `test/harness.ts`.
   - `packages/db/test`: RLS.
   - `apps/web/test`: browser-side logic.
   - `apps/desktop/test`: agent and IPC contract.
3. **E2E tests (Playwright)** for anything a user can see or do. Add or update a spec in `e2e/tests/web` or `e2e/tests/desktop` (see [e2e/README.md](e2e/README.md#adding-tests-for-a-new-or-changed-feature)). Cover:
   - the main journey;
   - validation and error handling;
   - empty and loading states;
   - permissions: who must *not* see or do it;
   - the regression that motivated the change, if it is a fix.

   Tag the critical journey `@smoke`.
4. **Run them:**
   - The affected package: `pnpm --filter <pkg> test`.
   - The new or changed E2E specs: `pnpm test:e2e <file>`, or `-g "<title>"`.
   - Then the full regression suite: `pnpm test:e2e`.
   - And `pnpm typecheck`.
5. **Fix failures** that are within the scope of the change and re-run. Never weaken a business rule, a permission check or a security control to make a test pass, and never skip or delete a failing test to get green.
6. **Report the real results**: what ran, how many passed, and anything that could not be run, with the reason (for example a missing service or credential).

## Test environment rules

- E2E runs against an isolated server: in-memory database, no email or storage services, ports 3100/3101 (`e2e/scripts/serve-web.mjs`). Never point tests at a shared, staging or production environment, or at real customer data.
- The one exception is the read-only live smoke in `e2e/live` (`pnpm test:live`, see [e2e/README.md](e2e/README.md#live-smoke-deployed-site)). It signs in as a dedicated test account, and its fixture blocks every write. Never add a test that writes to it, and never weaken that guard.
- Rate limits are on in E2E, as in production. Avoid unnecessary sign-ins: use the stored sessions from `e2e/support/global-setup.ts`.
- Rate limits are off in Vitest unless a test sends `x-test-rate-limit: on`. Routes that combine rate limits with transactions need a test with them on (see `packages/api/test/agent-me.test.ts`).

## Useful commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web app + API on :3000 (local PGlite in `apps/web/.data`) |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm test` | All Vitest suites |
| `pnpm test:e2e` | All Playwright tests, one command |
| `pnpm test:e2e:smoke` | Critical E2E paths only |
