# E2E tests (Playwright)

End-to-end tests for WorkPulse: they drive the real web app and the desktop app's window in Chromium, and launch the real Electron desktop app, against a real API and database.

```bash
pnpm test:e2e
```

That one command builds the web app, starts isolated test servers, creates test data, runs every test, prints the results and exits non-zero if anything fails. It takes about two minutes on a cold start and about 20 seconds when you skip the build (see below).

## How it is set up

| Piece | Where | What it does |
|---|---|---|
| Config | [playwright.config.ts](playwright.config.ts) | Two projects (`web`, `desktop`), servers, timeouts, retries, reports, artifacts |
| Web server | [scripts/serve-web.mjs](scripts/serve-web.mjs) | `next build` + `next start` on **:3100** with a **fresh in-memory database** |
| Desktop window | [scripts/serve-desktop.mjs](scripts/serve-desktop.mjs) | Builds the Electron renderer and serves it on **:3101** |
| Test data | [support/global-setup.ts](support/global-setup.ts) | Creates this run's org, team, projects, workers and a finalized payroll through the API |
| Fixtures | [support/fixtures.ts](support/fixtures.ts) | `data`, desktop sign-ins (`workerDevice`, `newcomerDevice`), `openDesktop()` |
| Electron | [support/electron.ts](support/electron.ts) | Launches the real desktop app (built by `serve-desktop.mjs`) with its own temporary user-data folder |
| Tests | [tests/web](tests/web), [tests/desktop](tests/desktop), [tests/electron](tests/electron) | One spec per feature |

**Isolation and safety.** The test server never uses your data:

- The database is in-memory PGlite. It is created on every server start, so it is never `apps/web/.data`, never Supabase, and never any `DATABASE_URL` from your `.env` files.
- Email, Supabase Storage and Vercel Blob are switched off, even if `apps/web/.env` configures them.
- Files go to `e2e/.tmp`.
- Global setup refuses to run against anything other than `localhost`.
- Rate limits, permissions and every other business rule stay on.

**Your dev server is not touched.** The suite uses ports 3100 and 3101, so `pnpm dev` on :3000 can keep running. Locally, Playwright reuses a server that is already up on those ports. Otherwise it starts its own servers and stops them at the end.

**The desktop project.** The Electron window is plain React that reaches the main process only through `window.tallywork` (the preload bridge).

- `openDesktop()` replaces that bridge with one that does what the main process does: it builds `/api/v1/agent/me/*` paths and calls the real API with a real device token from `POST /agent/login`.
- So the page, its states and the API are all real.
- The Electron main process itself (IPC validation, the native save dialog) is covered by the `electron` project below.

**The electron project.** It launches the real desktop app: main process, preload and window.

- It signs in through the app's own form, so the sign-in is stored with the OS keychain.
- It saves pay stub PDFs through the main process. The native Save dialog is replaced in the main process, so a test never waits for a person.
- It checks that the window has no Node access and that the main process rejects invalid requests.
- Each launch gets its own temporary user-data folder, deleted afterwards, so a WorkPulse app installed on your computer is never read or changed. The test fails before signing in if that isolation does not take effect.
- **App windows open on your screen while these tests run.**
- It needs a desktop session and a keychain. On Linux, run it under `xvfb-run` with a Secret Service keyring; without a display it is skipped.
- Run only this project with `pnpm test:e2e --project=electron`.

## Commands

Run from the repo root.

| Command | What it does |
|---|---|
| `pnpm test:e2e` | Full suite (web + desktop) |
| `pnpm test:e2e:smoke` | Critical paths only (tests tagged `@smoke`) |
| `pnpm test:e2e:regression` | Full suite: `web`, `desktop` and `electron` |
| `pnpm test:e2e tests/web/auth.spec.ts` | One file (paths are relative to `e2e/`) |
| `pnpm test:e2e -g "downloads the pay stub"` | One test, by title |
| `pnpm test:e2e --project=desktop` | One project (`web`, `desktop` or `electron`) |
| `pnpm test:e2e:headed` | With a visible browser |
| `pnpm test:e2e:ui` | Playwright's interactive UI mode (watch, time-travel, pick tests) |
| `pnpm test:e2e:debug` | Step through with the Playwright Inspector |
| `pnpm test:e2e:record` | Full suite, keeping a **video, trace and screenshot of every test** (not only failures) |
| `pnpm test:e2e:report` | Open the last HTML report (or `pnpm exec playwright show-report e2e/playwright-report`: in Git Bash use `/`, not `\`) |
| `pnpm test:e2e:install` | Install the Chromium build Playwright needs (once per machine) |

**Seeing what the browser rendered.** Tests run **headless**: Chromium renders every page fully, just without a window. To see it:

- **Watch it live:** `pnpm test:e2e:headed` opens real browser windows; `E2E_SLOWMO=500 pnpm test:e2e:headed` slows each action to 0.5 s. `pnpm test:e2e:ui` gives a step-by-step timeline with the rendered page at each step.
- **Review afterwards:** `pnpm test:e2e:record`, then `pnpm test:e2e:report`. Each test has its video, a final screenshot and a trace (DOM snapshots for every step, network and console). A normal run keeps these only for failed tests, plus the screenshots tests attach on purpose.

**Faster local runs:** `E2E_SKIP_BUILD=1 pnpm test:e2e` reuses the last web and desktop builds. Use it when only test files changed. Rebuild (drop the variable) after changing app code.

In PowerShell: `$env:E2E_SKIP_BUILD=1; pnpm test:e2e`.

## First-time setup

```bash
pnpm install
pnpm test:e2e:install   # Chromium for Playwright (Linux CI: add --with-deps)
pnpm test:e2e
```

## When a test fails

- The terminal shows the failing step, the expected value and the actual value.
- `e2e/test-results/<test>/` keeps a **screenshot**, a **video**, an `error-context.md` (the page's accessibility snapshot at the failure) and a **trace**.
- Open the trace: `pnpm --filter @tallywork/e2e exec playwright show-trace e2e/test-results/<test>/trace.zip`. It has a timeline, DOM snapshots, network calls and console output for every step.
- `pnpm test:e2e:report` opens the HTML report with all of this, plus the screenshots tests attach on purpose.
- Re-run just the failure with `-g "<title>"` and `--headed` or `--debug`.

## Environment variables

| Variable | Default | Use |
|---|---|---|
| `E2E_SKIP_BUILD` | unset | `1` reuses the last builds |
| `E2E_WEB_PORT` | `3100` | Port of the isolated web server |
| `E2E_DESKTOP_PORT` | `3101` | Port of the desktop window server |
| `CI` | unset | Set by CI: never reuses servers, 1 retry, `test.only` fails the run |

There are no credentials to configure. Every account is created per run with a test-only password ([support/env.ts](support/env.ts)) in the throwaway database.

## Test data

- [support/global-setup.ts](support/global-setup.ts) runs once per run. It signs up a new organization named `E2E Org <run id>` and writes `e2e/.auth/` (git-ignored). The admin's and the worker's signed-in state go to `admin.json` and `worker.json`, and the ids and names to `data.json`.
- Specs read that data through the `data` fixture, and add their own records with unique names (for example `unique('mia')` emails).
- So tests are independent of order and of each other, and can run in parallel.
- Nothing needs cleaning up: the database disappears when the server stops.

Available data:

- **Admin:** Erin Admin, signed in via `ADMIN_STATE`.
- **Workers:**
  - Wade Worker, on the team, with a finalized weekly payroll: 3 h at $25, a $50 bonus and a −$10 equipment deduction, so $115 net.
  - Nina Newcomer, on the team, in no payroll.
- **Team:** `Design <run>`.
- **Projects:** `Website <run>` and `Mobile App <run>`. The admin is a member of both.

## Live smoke (deployed site)

A separate, **read-only** suite in [live/](live/) checks a deployed site: production (https://tallywork-alpha.vercel.app) by default, or the URL in `LIVE_URL`. It has its own config, [playwright.live.config.ts](playwright.live.config.ts). There is no local server and no seeded data, and `pnpm test:e2e` never runs it.

```bash
pnpm test:live --project=live-public          # signed out: health, sign-in page, redirects. No account needed.
LIVE_EMAIL=… LIVE_PASSWORD=… pnpm test:live   # everything, including the signed-in workspace pages
```

| Variable | Use |
|---|---|
| `LIVE_URL` | Site to check (default: production). Use a preview URL to check a deployment before promoting it. |
| `LIVE_EMAIL`, `LIVE_PASSWORD` | A **dedicated test account**: an admin of its own test organization, with no two-factor sign-in. Never a real user's account. Pass them from the environment or CI secrets, never commit them. |
| `LIVE_ORG_ID` | Organization to open, if the account belongs to more than one. |

Rules:

- **Read only.** [live/fixtures.ts](live/fixtures.ts) aborts every POST, PUT, PATCH and DELETE to the site and fails the test. The one sign-in in [live/auth.setup.ts](live/auth.setup.ts) is the only write. Tests that create, change or delete data belong in the isolated suite above.
- **Production rate limits apply.** The suite signs in once per run, and runs on 2 workers.
- Reports go to `playwright-report/live`, failure artifacts to `test-results/live`.

## Adding tests for a new or changed feature

Every new feature or change that a user can see needs E2E coverage, alongside its unit tests. See [AGENTS.md](../AGENTS.md).

1. Find the flows the change affects: the pages, dialogs, API endpoints and roles involved.
2. Add or update a spec in `tests/web/<feature>.spec.ts` or `tests/desktop/<feature>.spec.ts`:
   - Cover the main journey, then validation and errors, empty and loading states, and permissions (who must **not** see or do it).
   - Tag the one or two most critical journeys `{ tag: '@smoke' }`.
3. **Locators.** Use roles, labels and visible text: `getByRole('button', { name: 'Send invitation' })`, `getByLabel('Email')`.
   - Copy names from the app's source or `apps/web/messages/en.ts`; don't guess.
   - Add a `data-testid` only when nothing accessible identifies the element.
4. **Waiting.** Rely on Playwright's built-in auto-waiting `expect(...)`. Never use `waitForTimeout`.
5. **Data.** Create records through the UI or the API with unique names. Never depend on another test's records. If the feature needs shared fixture data, extend `global-setup.ts`.
6. **Sign-in.**
   - The admin web session comes from `test.use({ storageState: ADMIN_STATE })`.
   - For a fresh session, use `test.use({ storageState: { cookies: [], origins: [] } })`.
   - `browser.newContext()` inherits the file's `storageState`, so pass `{ storageState: { cookies: [], origins: [] } }` for a second, signed-out person.
   - Never sign out the shared admin session; sign in separately for that.
7. Run the new spec, then the full suite, and make sure both pass. Then commit.

Example:

```ts
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

test.use({ storageState: ADMIN_STATE });

test('an admin creates a client', { tag: '@smoke' }, async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/clients`);
  await page.getByRole('button', { name: 'New client' }).click();
  // ...
});
```

## CI

Two jobs in [.github/workflows/ci.yml](../.github/workflows/ci.yml) run on every push to `main` and on every pull request:

- **E2E (Playwright)** on Ubuntu: install, typecheck the suite, install Chromium with its system dependencies, then `pnpm test:e2e --project=web --project=desktop`.
- **E2E desktop app (Electron, Windows)** on Windows: `pnpm test:e2e --project=electron`. Windows runners have the desktop session and the OS keychain the app needs.

Both always upload `playwright-report` and `test-results` as artifacts (`playwright-report` and `playwright-report-electron`), kept for 14 days. Download one from the run's summary page and open `playwright-report/index.html`.
