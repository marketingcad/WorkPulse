# Quality gates

Every automated test belongs to one of three gates, listed in [quality-gates.json](../quality-gates.json). A failure is reported under its gate, so a broken payroll rule is never mistaken for a broken layout.

| Gate | Severity | What it protects |
|---|---|---|
| **1 · Business correctness** | Critical | Time tracking, session state, timesheets, payroll, invoicing, money maths, permissions, authentication, tenant isolation |
| **2 · Product functionality** | High | Web workflows, desktop screens, integrations, reports, notifications, the client portal, the Performance Center, support |
| **3 · Product quality** | Standard | Accessibility, responsive layout, page weight, page health, loading and error states, form feedback, latency budgets |

A Gate 1 failure blocks a release. Fix it, never weaken the rule ([AGENTS.md](../AGENTS.md)).

## Commands

| Command | What it runs |
|---|---|
| `pnpm test:gates` | Checks every test file is in exactly one gate (CI fails otherwise) |
| `pnpm test:gate1` | Gate 1: Vitest (domain, database and RLS, API, desktop agent), then Playwright (web, desktop window, Electron) |
| `pnpm test:gate2` · `pnpm test:gate3` | The same for Gates 2 and 3 |
| `node scripts/quality-gates.mjs run 1 --unit` | One gate's Vitest files only (`--e2e`: Playwright only) |
| `node scripts/quality-gates.mjs run 1 --e2e -- --project=web` | Anything after `--` goes to Playwright |
| `node scripts/quality-gates.mjs list 1` | The files in a gate |

The full suites are unchanged: `pnpm test` and `pnpm test:e2e` still run everything. Playwright runs against the isolated test server only (see [e2e/README.md](../e2e/README.md)).

## In CI

[ci.yml](../.github/workflows/ci.yml) runs the gate check, then Gate 1, Gate 2 and Gate 3 as separate named steps, both for Vitest (`verify` job) and Playwright (`e2e` job). Gates 2 and 3 still run when Gate 1 fails, so one run reports everything. Each Playwright gate keeps its own report and traces (`playwright-report/gate-N`, `test-results/gate-N`). The desktop agent's Vitest suite runs in the `desktop` job on Windows, macOS and Linux, and the real Electron app in `e2e-electron`.

## Adding a test

Put the file next to the code as usual ([AGENTS.md](../AGENTS.md)), then add its name to one gate in `quality-gates.json`: Vitest files by name without `.test.ts`, under their package folder; Playwright specs by path under `e2e/tests` without `.spec.ts`. Choose by what breaks if it fails: money, time, access or another tenant's data is Gate 1.

## Boundary tests that cover new routes on their own

[route-boundaries.test.ts](../packages/api/test/route-boundaries.test.ts) reads the API's route table, so a route added later is checked without editing the test:

- every `/orgs/:orgId` route returns 404 to a member of another organization;
- every one refuses a desktop device token (devices use `/agent/*` only, so a client can never write time through the workspace API);
- an API key with every scope reaches exactly the endpoints [docs/api](api/README.md#scopes-and-the-endpoints-they-open) lists, nothing more. Update that list and the docs table together.
