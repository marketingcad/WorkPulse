# QA automation report — 30 Oct 2026

Branch `test/qa-automation-suite` (from `main` at 686b4c0, after PR #92). No application code was changed for this report.

## A. Summary

| | |
|---|---|
| Environment | Isolated E2E server only: production build, in-memory database, ports 3100/3101, no email or storage services (`e2e/scripts/serve-web.mjs`). No staging or production system was touched. |
| Tools | Playwright 1.64 (existing suite), Playwright MCP browser (exploration), `@axe-core/playwright` 4.13.0 (added, see F), Vitest. |
| Full E2E run | **389 tests: 370 passed, 19 failed**, in 6.9 min (`pnpm test:e2e`, web + desktop + electron projects). Two of the 19 were faults in the new tests (keyboard sign-in, drawer navigation); both were fixed and re-run green. |
| Existing tests | All 292 pre-existing tests passed. No regression. |
| New tests | 97 added. 80 pass. The 17 that fail map to 8 product defects (D), each confirmed by investigation. |
| Smoke | 69/69 before the work; 73 tests are tagged `@smoke` now, and the 4 new ones pass. |
| Unit and integration | `pnpm test`, all passed: api 644 (2 skipped), web 88, domain 72, desktop 62, db 19, ui 11. |
| Typecheck | `pnpm typecheck` and `pnpm --filter @tallywork/e2e typecheck` pass. |
| Security (server side) | 15/15 new API checks pass: authentication, role and tenant isolation, IDOR, CSRF, media type, forged credentials, headers, cookie flags. |
| Verdict | **PASS WITH ISSUES** (see G) |

## B. Coverage matrix (new and existing E2E, executed counts)

| Area | Existing (passed) | New | New passed | New failed | Spec |
|---|---|---|---|---|---|
| Smoke (`@smoke`) | 69 | 4 | 4 | 0 | across files |
| Functional (web and desktop flows) | 292 overall | — | — | — | `tests/web`, `tests/desktop`, `tests/electron` |
| Auth: signed-out pages | 10 (auth.spec) | 8 | 6 | 2 | `qa/public-auth.spec.ts` |
| Authorization (server side) | covered in Vitest (644 API tests) | 15 | 15 | 0 | `qa/api-security.spec.ts` |
| Responsive: desktop/tablet/phone | 70 (page-health desktop and phone) | 35 tablet page-health + 15 | 25 + 15 | 10 + 0 | `qa/page-health.spec.ts`, `qa/responsive.spec.ts` |
| Accessibility: axe WCAG 2.2 A/AA | 0 | 13 web + 7 desktop | 11 + 6 | 2 + 1 | `qa/a11y.spec.ts`, `desktop/a11y.spec.ts` |
| Accessibility: keyboard | 0 | 4 | 2 | 2 | `qa/a11y.spec.ts` |
| Regression (full suite) | 292 | 97 | 80 | 17 | `pnpm test:e2e` |

Not covered: cross-browser (Firefox/WebKit are opt-in with `E2E_CROSS_BROWSER=1` and were not run), screen readers, performance and load, email delivery (no mail service in E2E), and the live site (`pnpm test:live`; not run, because it needs the dedicated account's credentials).

## C. Test inventory (new)

**`e2e/tests/web/qa/api-security.spec.ts` (15)**
- Signed out, every org endpoint answers 401 problem+json `@smoke`.
- Worker: admin-only data answers 403.
- Custom viewer role: its grant (budgets) works; money and people data answer 403.
- Lists are narrowed: a worker's people and project lists contain only what they may see.
- Pay stub by id: the owner reads it; anyone else gets 404, with no amount leaked.
- A desktop device token cannot read another worker's pay stub or call the admin API.
- A worker cannot create roles or API keys or promote themselves. The role is re-read to prove it did not change.
- Tenant isolation: another organization, and a made-up org id, both answer 403/404.
- CSRF: a cross-site Origin and a missing Origin are both blocked with 403.
- A `text/plain` body is refused with 400 `unsupported_media_type`.
- Login CSRF: a cross-site sign-in is blocked.
- Forged bearer tokens, device tokens, API keys and session cookies answer 401 with specific codes.
- Errors leak no stack, SQL or file paths.
- Hardening headers are present: nosniff, Referrer-Policy, HSTS, Permissions-Policy, CSP `frame-ancestors`; no `X-Powered-By`; no wildcard CORS.
- The session cookie is HttpOnly and SameSite, and not readable by script.

**`e2e/tests/web/qa/public-auth.spec.ts` (8)**
- Sign-up happy path `@smoke`.
- Empty form, then a short password: refused field by field.
- Errors are readable and tied to their field. **Fails: QA-01, QA-02.**
- An existing email does not open that account.
- Invalid email-confirmation link.
- Invalid invitation link.
- Malformed reset link shows a readable message. **Fails: QA-01.**
- Unknown reset link is refused.

**`e2e/tests/web/qa/a11y.spec.ts` (17)**
- axe on `/login`, `/signup`, `/forgot-password`, `/download`, and on 9 admin pages. **`/settings/roles` and `/timesheets/all` fail: QA-06.**
- Keyboard-only sign-in `@smoke`.
- Skip link.
- Dialog focus trap, Escape and focus return. **Fails: QA-03.**
- Phone drawer closes with Escape. **Fails: QA-04.**

**`e2e/tests/web/qa/responsive.spec.ts` (15)**
- 3 signed-out pages × 3 viewports: no sideways scroll, the action is on screen with a target of at least 24px, fields are not squeezed.
- `/download` × 3 viewports.
- Sidebar vs. menu button per viewport.
- Phone drawer navigation `@smoke`.
- Tapping the backdrop closes the drawer.

**`e2e/tests/desktop/a11y.spec.ts` (7)**
- axe on each primary screen of the worker desktop app. **Home fails: QA-07.**

**`e2e/tests/web/qa/page-health.spec.ts` (+35)**
- Tablet (768×1024) added to the existing desktop and phone route sweep. **10 routes fail: QA-05.**

## D. Defects

Severity: High (blocks a task or exposes data), Medium (a real barrier for some users, or a visible fault), Low (polish or partial barrier). No High or security defect was found.

| ID | Sev | Defect | Where | Evidence |
|---|---|---|---|---|
| QA-01 | Medium | Raw validator text is shown to users. An empty name on sign-up shows "Too small: expected string to have >=1 characters". A malformed reset link shows "token: Too small: expected string to have >=20 characters" instead of "This link is invalid or has expired". | Server zod messages (`packages/contracts/src/inputs.ts`, `nonEmpty`, token length) surfaced by the forms. | public-auth tests 3 and 8; MCP exploration |
| QA-02 | Medium (a11y) | A field's error is not tied to the field: no `aria-invalid` and no `aria-describedby`, so a screen reader does not announce which field is wrong when focused. Hints are not linked either. Every form uses this component. WCAG 1.3.1, 3.3.1. | `packages/ui/src/primitives.tsx`, `Field` | public-auth test 3 (soft assertions) |
| QA-03 | Medium (a11y) | Closing any dialog drops keyboard focus to `<body>` instead of the button that opened it. The cause is that the controlled Radix `Dialog` has no `Trigger` to return to. App-wide. WCAG 2.4.3. | `packages/ui/src/overlays.tsx:14` | a11y "dialog" test (focus reported on `<body>`) |
| QA-04 | Medium (a11y) | The phone navigation drawer does not close with Escape and is not a modal dialog (no `role="dialog"`, no focus containment). WCAG 2.1.1, 2.4.3. | `apps/web/components/shell/app-shell.tsx:52` | a11y "drawer" test |
| QA-05 | Medium | At tablet width (768px) the side navigation stays visible and wide tables push the whole page sideways (211–554px of horizontal scroll) instead of scrolling inside the table. Seen on 10 routes with realistic data: `/tracking/live`, `/clients`, `/projects`, `/tasks`, `/finance/billing`, `/finance/budgets`, `/finance/expenses`, `/finance/invoices/payments`, `/devices`, `/developer/webhooks`. On a fresh, almost empty database `/clients` passes, so the result depends on data (row content and column count). | Table containers in the app shell content area | page-health tablet; screenshot of `/clients` cut off at the PHONE column |
| QA-06 | Low (a11y) | The `secondary` badge has a contrast of 4.49:1 (`#6d4cf5` on `#efebff`, 11px), below the 4.5:1 minimum. Seen on Roles (22 badges) and Time entries. | `packages/ui/src/tokens.css:89-90` | axe `color-contrast` |
| QA-07 | Low (a11y) | Desktop Home: `<dt>`/`<dd>` pairs are nested in grid `<div>`s inside the `<dl>`, which is invalid, so labels and values are not associated for screen readers. | `apps/desktop/src/renderer/src/HomeCards.tsx` (`Mini`, `Total`, `Field`) | axe `definition-list`, `dlitem` |
| QA-08 | Low (UX) | An invalid or expired invitation link still shows the full sign-up form. The error appears only after the person has filled it in and submitted. | `apps/web/app/(auth)/invite/page.tsx` | MCP exploration; covered by the passing invite test |

Observation (not a defect): `GET /orgs/:id/roles` is readable by any member with `members:read` (own), so workers can see the role catalogue including grants. This is deliberate in the route (`requirePermission('members:read', 'roles:manage')`) and exposes no personal data. Recorded for the record.

### Test failures that were not product defects (fixed in test code)

These were investigated and fixed in the tests without weakening any assertion:
- Signup rate limit (429) from too many sign-up submissions. The validation tests now share submissions.
- The skip-link test was run on `/login`, which autofocuses the email field. It moved to the workspace.
- The responsive width check counted the "Remember me" checkbox as a text field.
- The drawer test clicked a link inside a collapsed group, and earlier one that does not exist.
- The keyboard sign-in test assumed which workspace a sign-in returns to. Other specs change the last workspace used.

## E. Artifacts

- HTML report: `e2e/playwright-report/index.html`. Open it with `pnpm --filter @tallywork/e2e report`.
- Failure traces, screenshots and videos: `e2e/test-results/<test>/` (`trace.zip`, `test-failed-1.png`, `error-context.md`).
- axe results per page: the `axe-results.json` attachment on each a11y test in the HTML report.
- Exploration snapshots from the MCP browser: `.playwright-mcp/` (git-ignored).

## F. Improvements

1. **Dependency added:** `@axe-core/playwright` 4.13.0, pinned, e2e devDependency only.
   - Nothing in the repo could audit WCAG rules.
   - 4.14.0 was skipped as under two weeks old.
2. **Decide how known defects live in CI** before merging these tests. Either fix QA-01 to QA-07 first (recommended; each is small and in a shared component), or mark the affected tests `test.fail()` with the defect id so they still run and alert when fixed. Do not skip them.
3. **Make the tablet check data-independent.** Seed one wide table row in `global-setup.ts`, so QA-05 does not depend on which specs ran first.
4. **Local reruns** against a reused server accumulate sign-up rate-limit hits (10 per hour). Restart the server between full runs, or let Playwright start it (`reuseExistingServer` is off in CI already).
5. **Wider coverage still to do:**
   - an axe scan on dialogs in their open state;
   - the cross-browser smoke (`E2E_CROSS_BROWSER=1`) in a nightly job;
   - a screen-reader pass (NVDA/VoiceOver) on sign-in, timesheets and the desktop Home.

## G. Verdict: PASS WITH ISSUES

- **Core functions pass:** sign-in, payroll, invoicing, time tracking and the desktop app.
- **Server-side security passes:** authentication, authorization and tenant isolation.
- **No regression:** all 292 existing tests pass.
- **Accessibility and tablet layout are below standard.** There are 8 confirmed defects, none High, and four are Medium:
  - QA-02, QA-03 and QA-04 are app-wide accessibility barriers;
  - QA-05 is a layout fault at tablet width.

## Follow-up: QA-03 to QA-07 fixed (30 Oct 2026)

| ID | Fix |
|---|---|
| QA-03 | `Dialog` and `Drawer` (`packages/ui/src/overlays.tsx`) remember what opened them and give focus back on close. The opener is read while rendering, before an autoFocus field takes focus. |
| QA-04 | The phone navigation drawer (`app-shell.tsx`, `MobileNav`) is a modal dialog: focus moves in and stays in, Escape closes it, and focus returns to the menu button. |
| QA-05 | The cause was screen-reader-only table headers ("Actions"). They were positioned against `<body>`, so they escaped the table's scroll box and widened the page. Table scroll wrappers are now `relative`: the shared table and 7 hand-built tables. A new tablet test seeds wide rows, so the check no longer depends on other tests. |
| QA-06 | `--tw-secondary` is now `#6845ee`, with a contrast of 4.9:1 on its badge background. |
| QA-07 | Desktop Home: each `<dl>` holds only term/value groups. The limit bar is a second `<dd>`. |

Full E2E run after these fixes: **408 tests, 406 passed.** The 2 failures were desktop navigation tests: the browser did not close in time under load. Run alone, that spec passed 48 of 48, three times each.

## CI/CD readiness

- The CI `E2E (Playwright)` job runs `--project=web --project=desktop`, so the new specs run there automatically. The e2e typecheck already runs in CI, and the lockfile is updated for `--frozen-lockfile`.
- **Not ready to merge as is:** with the defects open, the E2E job would fail on the 17 tests above. See F.2.
- The tablet failures depend on data, so with CI's one retry the result could vary until F.3 is done.
- No deployment workflow was changed.
