---
name: full-qa
description: Full-project QA pass for WorkPulse — audit, feature-by-feature testing, fixing, automated regression tests and a final QA report. Use when asked for a complete QA, a QA round, "test every feature", "find and fix bugs across the app" or a production-readiness check. Resumable across sessions through a ledger in docs/qa/.
---

# Full-project QA (WorkPulse)

Act as a senior QA automation engineer and full-stack developer. Work with the existing architecture. Do not rebuild, do not remove features, and do not change working code that is not part of a fix. Fix the bugs you find, then prove the fix with a test that failed before it.

Workflow, strictly in order, **one feature at a time**:

**DISCOVER → AUDIT → TEST → IDENTIFY → FIX → RETEST → REGRESSION TEST → VALIDATE → REPORT**

Do not move to the next feature while the current one has an unresolved Critical issue.

## 0. Ground rules (read first, every session)

- **AGENTS.md is binding.** Every fix ships with automated tests that were run and passed. Never weaken a business rule, permission or security control to make a test pass. Never skip or delete a failing test.
- **Where to test:**
  - Locally (`pnpm dev`, ports 3350 or 3200) and in the E2E server (`pnpm test:e2e`, in-memory database, ports 3100/3101).
  - **Never write to production** unless the user has authorized it for this session. The standing authorization is in memory `prod-qa-authorization`: only on clearly labelled "QA-AUDIT" records, and never security changes, real emails or non-QA money.
  - In production, never clock in on the desktop app (screenshots are unblurred) unless the user asks in this session.
- **Read before you start:**
  - the latest ledger in `docs/qa/` (a QA pass resumes where it stopped);
  - memory `qa-round3-and-phase6` (open bugs and their numbers);
  - `QUALITY_ASSURANCE.md` (the manual guide, by feature);
  - `docs/QUALITY_GATES.md`.
- **A blocker is not a pass.** If something can't be tested (missing credential, external service, infrastructure), mark it **Blocked** with the reason.
- **Bug numbers continue** the existing series (BUG-nn). Check memory and the ledger for the last number used.

## 1. Discover and audit (once per pass)

Build the feature inventory from the code, not from memory:

| Surface | Where to look |
|---|---|
| Web pages | `apps/web/app/**/page.tsx` (workspace under `app/o/[orgId]/`, auth, portal, support, download) |
| API endpoints | `packages/api/src/routes/*.ts` (route groups: auth, org, time, ops-finance, insight-platform, performance, agent, portal, support, assistant) |
| Business rules | `packages/domain/src`, and `docs/PROJECT_CONTEXT.md` §5 |
| Data | `packages/db/src/schema/*.ts`, migrations, RLS (`tenantTables()`) |
| Desktop | `apps/desktop/src/renderer/src` (screens), `src/main/services` |
| Permissions | `packages/domain/src/permissions.ts`, `docs/security/authorization-matrix.md` |
| Existing tests | `quality-gates.json` (every test file, by gate), `e2e/tests`, `packages/*/test` |

Write it to `docs/qa/<date>-feature-inventory.md`: one row per feature, with its pages, endpoints, roles, and which existing tests cover it. Mark the gaps: features with no E2E test, no permission test, or no validation test. Those gaps decide the test order, together with the open bugs.

Also record the baseline: `pnpm typecheck`, `pnpm test:gates`, and the latest CI run on `main` (`gh run list --branch main`), with pass and fail counts.

## 2. Test one feature

For the feature in hand, check each category. For each one, write down what was run and the result.

- **A. Functional:** every button, link, form and action. Create, read, update, delete. Calculations (money and time especially). Navigation and redirects. Success and failure paths.
- **B. Input validation:** required fields, empty submit, invalid formats, minimum and maximum lengths, duplicates, special and Unicode characters (`Zoë O'Brien-Nguyễn`), very long input. Messages must appear beside the field.
- **C. UI/UX:** loading, empty, success and error states (a "no data" state shown while loading is a bug). Desktop, tablet and phone widths (360 / 768 / 1280) and dark mode. No overlap and no horizontal scroll. For a full sweep, `pnpm test:e2e:audit` runs every page as every role, with axe.
- **D. Database:** data persists, relations and composite foreign keys hold, no duplicates, deletes and archives behave, and multi-step writes happen in one transaction.
- **E. API:** status codes (400 validation, 401, 403 vs 404 for things you can't see, 409, 422), payload shape, and `problem+json` errors.
- **F. Security:** each role (System Admin, Team Manager, Worker, custom role, client viewer, API key) sees and does only what it should. Another organization sees nothing (tenant isolation). Look for input sanitization and exposed secrets.

Prefer **automated checks over manual clicking**, using the existing harnesses:

- API: `packages/api/test/harness.ts` (PGlite). Use `signup`, `addMember`, `Client`, and `x-test-rate-limit: on` when rate limits matter.
- Database and RLS: `packages/db/test`.
- E2E: `e2e/support/fixtures.ts` (stored sessions per role, `data`, `adminApi`). Use unique names per run.
- Big data: `packages/api/test/support/big-org.ts` and `hot-reads.ts`.

## 3. Record each bug

Add each bug to the ledger with:
- title, module, **severity**, steps to reproduce, expected, actual;
- **root cause** (file:line);
- the fix, the test that proves it, and **status** (Open / Fixed / Verified / Won't fix — reason).

Severity:
- **Critical:** a crash, data loss, money wrong, someone sees data they must not, or a core flow is broken.
- **High:** a main task can't be done.
- **Medium:** wrong behaviour that has a workaround.
- **Low:** cosmetic issues and wording.

## 4. Fix, retest, regress

1. **Write the failing test first**, where the bug is testable. Run it and see it fail.
2. **Fix the root cause.** Don't hide the error or add a special case for the test. Add no new dependencies unless needed.
3. **Rerun that test**, then the feature's related suites:
   - `pnpm --filter <pkg> test`
   - `pnpm test:e2e <spec>` (when the build stops on "was not able to start", retry)
4. **Put each new test file in a gate** in `quality-gates.json`. `pnpm test:gates` must pass.
5. **Commit per feature**, on a branch (never on `main`), with a message that names the bug numbers.

## 5. Performance and stability (once per pass)

- Run `pnpm --filter @tallywork/api exec vitest run test/perf-budgets.test.ts` (query counts must not grow with organization size).
- Run `pnpm perf:index-review` (no sequential scans on large tables).
- Run `pnpm test:e2e tests/web/page-speed.spec.ts` (Largest Contentful Paint).
- Check the bundle budget: `pnpm --filter @tallywork/web build`, then `node apps/web/scripts/check-bundle-budget.mjs`.
- Add a new hot screen to `hot-reads.ts` with a budget.

## 6. Final validation

Run, and record the counts:
- `pnpm typecheck`
- `pnpm turbo run test --filter='!@tallywork/e2e'`
- `pnpm test:gates`
- the bundle budget
- then `pnpm test:e2e` **on its own** (not alongside Vitest)

Rerun known flaky failures (rate limits during setup, time of day) alone before calling them flaky, and say so in the report. Check that CI on the branch is green.

## 7. QA report

Write `docs/qa/<date>-qa-report.md`. If the user wants a page, also publish it as an Artifact. Sections:

1. **Project QA summary:**
   - features identified and features tested;
   - test cases executed, passed and failed;
   - bugs found, fixed and remaining.
2. **Feature-by-feature results:** for each feature, a table:

   | Test category | Status | Notes |
   |---|---|---|
   | Functional | PASS / FAIL | |
   | Input validation | PASS / FAIL | |
   | UI/UX | PASS / FAIL | |
   | Database | PASS / FAIL / N/A | |
   | API | PASS / FAIL / N/A | |
   | Security | PASS / FAIL | |
   | Regression | PASS / FAIL | |

3. **Bug and fix report:** every bug with severity, root cause, fix and verification.
4. **Automation report:** test files created or changed, by gate, with execution results.
5. **Remaining issues:** unresolved bugs, blockers (with reasons), and what still needs testing.
6. **Production readiness:** an honest yes or no with reasons. "Ready" requires no open Critical or High bugs, green CI, and every blocker named.

Write for the user: plain words, short sentences, and results before details.
