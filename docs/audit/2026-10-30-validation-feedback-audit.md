# Input validation and user feedback audit — 30 Oct 2026

Branch `test/qa-automation-suite`. Read-only for application code: no app file, schema or migration was changed. New test code only (see E).

Scope: every form and input flow in the web app (`apps/web`), the client portal, the desktop app (`apps/desktop`), the API (`packages/api`, schemas in `packages/contracts`) and the database (`packages/db`).

How the evidence was gathered:
- Code read of every route, schema, form and feedback component.
- About 120 direct API probes against the isolated test server (in-memory database, port 3100): boundaries, malformed bodies, concurrency, mass assignment.
- 17 new Playwright tests (16 web, 1 Electron).

Status words:
- **Confirmed** means reproduced live or by test.
- **Confirmed (code)** means read in the code but not reproduced.
- **Suspected** means reported by a code sweep and not re-verified.

---

## A. Executive summary — **PASS WITH FINDINGS**

| Area | Assessment |
|---|---|
| Backend validation | **Strong.** Every JSON body goes through one zod parser. Unknown keys are dropped, so mass assignment did not work in any probe. Trimming, lengths, enums, ids, dates, time zones and money integers are all enforced. Cross-field rules hold for projects, manual time, time off, schedules, invoice periods and payment allocations. The gaps are narrow (VF-02 to VF-08). |
| Frontend validation | **Adequate, by design thin.** Forms rely on the server, with disabled-until-valid buttons and some custom checks. Nothing could be bypassed: everything the UI skips, the server enforces. |
| Data integrity | Concurrency invariants held under parallel submits: overlapping time, duplicate client names, invitations. Weak spots: a pay-group rename via `PATCH` drops all members and their bank details (VF-04); invoice lines can overflow the database (VF-03); the finance tables have no CHECK constraints and few foreign keys (VF-18). |
| Feedback quality | **The weakest area.** Validator wording reaches people ("Too small: expected string to have >=1 characters", VF-01). A lost connection reads "Failed to fetch" (VF-09). An expired session redirects with no explanation (VF-11). There are no app error pages (VF-12). Forgot-password says "a reset link is on its way" when the request failed (VF-14). Some field errors are shown nowhere (VF-21). Desktop sign-in fails silently on a mistyped email (VF-13). |
| Accessibility | Error toasts are polite, last 4 s and cannot be dismissed (VF-10). Field errors are not tied to inputs (QA-02, open from the earlier report). Desktop error messages mostly have no live region. |
| Security | No injection, XSS, open redirect, CSRF or tenant leak was found. Lower risks: no request-size limit (VF-08); an unbounded report range ends in a 500 after 3.7 s (VF-06); bulk endpoints can echo raw driver messages (VF-16); upload types come from the client header (VF-17). |

**Limitations:**
- Screen readers were not used.
- The live site was not tested.
- Email delivery is off in the test environment.
- The desktop renderer was tested with the real Electron app only for sign-in.
- Code-only findings are marked as such.

---

## B. Form coverage matrix

96 input flows were found: 88 web/portal (W-01…W-88) and 8 desktop (D-01…D-08).

**Columns:**
- **FE** is client validation: `btn` (submit disabled until valid), `cust` (custom checks), `html` (HTML attributes only) or `—`.
- **BE** is server validation: `zod+svc` means a schema plus service rules.
- **Feedback** is success / error: `T` toast, `F` field, `A` form alert.
- **Test**: `E2E` (existing E2E), `NEW` (this audit), `API` (probed), `code` (code review only).
- **Gaps** lists remaining gaps.

**Defaults when a row says nothing:**
- the submit button shows a spinner and blocks double submit;
- input is kept after a failure;
- a toast on success, then the dialog closes;
- server errors map to fields where a matching field exists.

| ID | Form | FE | BE | Feedback | Test | Gaps |
|---|---|---|---|---|---|---|
| W-01/02 | Sign in, 2FA step | html (noValidate) | zod+svc, rate limit | redirect / A | E2E, NEW (keyboard) | — |
| W-03 | Resend verification | — | zod, rate limit | inline / A | code | VF-20 |
| W-04 | Sign up | html | zod+svc | redirect / F+A | E2E, NEW | VF-01, VF-21, QA-02 |
| W-05 | Forgot password | html | zod, rate limit | inline / **always "sent"** | NEW | VF-14 |
| W-06 | Reset password | html | zod | inline / F | NEW | VF-01 |
| W-07 | Verify email | — | zod | inline | E2E | — |
| W-08/09 | Accept invitation (member, portal) | — | zod+svc | redirect / A | E2E | QA-08, VF-21 (portal) |
| W-10/11 | Create organization | btn | zod | redirect / F+A | E2E | — |
| W-12 | Desktop device authorize | btn, redirect checks | zod | redirect / A | E2E | — |
| W-13–15 | Support search, portal range, portal sign-out | btn / min-max | zod | table | E2E | — |
| W-16 | Timer start/stop/pause/switch | cust | zod+svc | T | E2E | VF-30 |
| W-17/18 | Notifications read, tour | — | zod | — | code | VF-31 |
| W-19 | Dashboard layout | — | zod | T | E2E | no pending state |
| W-20/21 | Client dialog, logo | btn, cust | zod+svc (unique) | T / F+T | E2E, NEW, API | — (reference implementation) |
| W-22 | Archive/restore client | — | svc | confirm + undo | E2E | — |
| W-23–26 | Project dialog, settings, access, archive | btn, cust | zod+svc | T / F+T | E2E, API | — |
| W-27 | Project documents | 25 MB check | svc, type from header | T | E2E, API | VF-17, VF-05 |
| W-28–30 | Task dialog, status, archive | btn, cust | zod+svc | T / F+T | E2E, API | — |
| W-31–33 | Teams, team members, archive | btn | zod+svc | T | E2E, API | VF-26 (remove member, no confirm), VF-27 |
| W-34/35 | Invite member, revoke | btn | zod+svc | result / F+T | E2E, API | — |
| W-36–41 | Member profile, suspend/remove, personal info, erase, 2FA reset, data export | cust / type-to-confirm | zod+svc | T / F+T | E2E | VF-21 (2FA reset) |
| W-42 | Schedule editor | btn | zod+svc | T / F+T | E2E, API | — |
| W-43–47 | Time off (request, decide, policies, adjust, holidays) | btn | zod+svc | T / F+T | E2E, API | VF-26 (bulk approve) |
| W-48–52 | Time entry edit, split, delete, manual time, comment dialogs | cust | zod+svc, revision check | T / F+A | E2E, API | — |
| W-53–55 | Submit/approve timesheets, bulk approve, manual-time approve | — | svc | confirm on submit | E2E | VF-26, VF-16 |
| W-56 | CSV import | 512 KB, row cap | per-row zod | inline per row | E2E | — |
| W-57/58 | Time entries bulk edit, save as report | btn | zod+svc | T | E2E | VF-16 |
| W-59/60 | Delete screenshot, force stop | — | svc | confirm | E2E | — |
| W-61 | Read-only filters (8 pages) | min/max | zod query | — | E2E | VF-06 (reports) |
| W-62/63 | Organization settings, time & pay | btn, cust | zod+svc | F+A (no toast) | E2E, API | VF-21 |
| W-64–66 | Overtime, time types, break types | cust / btn | zod | T / F+A | E2E, API | — |
| W-67/68 | Security settings, data retention | cust | zod+svc (lockout guard) | T / A | E2E, API | — |
| W-69 | Screenshot retention | cust | zod+svc | confirms | E2E | — |
| W-70 | Tracking policies | range hint | zod+svc | T / A (raw field pairs) | E2E | VF-22, VF-23, VF-01 |
| W-71 | Roles | btn | zod (strict grants) | T / F | E2E, API | VF-27 (duplicate names) |
| W-72/73 | API keys, webhooks | btn, https regex | zod+svc (SSRF guard) | key shown once / F | E2E, API | VF-07 |
| W-74/75 | Devices, support access | — / btn | svc | confirms | E2E | — |
| W-76 | Client portal settings, invite | html | zod+svc | A only | E2E | toggles give no success feedback |
| W-77/78 | Own 2FA, profile (time zone, locale, password, devices, notifications) | btn, cust | zod+svc | T / F+A | E2E, API | — |
| W-79 | Budget | cust | zod+svc | T / F+A | E2E, API | VF-03 (no maximum) |
| W-80 | Record payment | cust (over-allocation) | zod+svc (atomic) | T / F+A | E2E, API | VF-07 (padded reference) |
| W-81 | Expense + receipt | cust | zod+svc | T / F+A | E2E, API | VF-17, VF-26 (reject, no confirm) |
| W-82 | Rates | cust | zod+svc | T / F | E2E, API | — |
| W-83/84 | New invoice, invoice detail | step gating | zod+svc | T / A (no field mapping) | E2E, API | **VF-02, VF-03** |
| W-85/86 | Pay groups, bank details, payroll run, adjustments, finalize | btn, cust | zod+svc | T | E2E, API | **VF-04** |
| W-87/88 | Save report, run/export report | btn, ≤400 days in UI | zod (no range check) | T | E2E, API | **VF-06** |
| D-01 | Desktop sign-in | button disabled until filled | IPC zod, then API | `role=alert` / **nothing on IPC rejection** | NEW (Electron) | **VF-13** |
| D-02 | Clock-out end-of-day report | required, max 5000 | IPC zod+API | `<p>` without role | E2E | VF-24 |
| D-03/04 | Idle and recovery choice | — | IPC+API | — | E2E | — |
| D-05 | Manual time request | button disabled until project + duration | IPC zod+API | `<p>` without role | E2E | VF-24 |
| D-06 | Time-off request | end ≥ start | IPC zod+API | inline | E2E | VF-24 |
| D-07 | Timesheet submit | — | API | inline, no confirm | E2E | VF-26 |
| D-08 | Work note | — | IPC zod | **none** | code | VF-24 |

---

## C. Feedback consistency report

**Mechanisms in use:**
- **Toast** (`packages/ui/src/overlays.tsx:231-274`): one system, with success, error and info.
- **Inline alerts:** about 45 hand-written `<p role="alert">` banners.
- **Field errors:** the `Field` component.
- **Shared `ConfirmDialog`** (`overlays.tsx:67`).
- **`ErrorState` / `EmptyState` / `PermissionState`** (`display.tsx:234-264`).
- **Notifications bell**, polled every 30 s.
- **Desktop:** OS notifications and inline `<p>` messages. Desktop has no toasts.

| Topic | Finding |
|---|---|
| Wording from the validator | API `title` = `"field: zod message"` (`packages/api/src/lib/http.ts:60-63`), shown as-is by `errorMessage()` (`apps/web/lib/api.ts:103`). See VF-01. |
| Duplicated messages | Client and other dialogs show the same failure as a field error and a toast, which is acceptable. The policies page lists raw `field message` pairs under its alert. |
| Missing messages | Field errors with no matching input (VF-21); desktop work note; notifications "Mark all read"; portal toggles. |
| Misleading messages | Forgot password "on its way" after a failure (VF-14). Resend-verification failure says "Could not sign in" (VF-20). Info toasts use the green success icon. Webhook "unknown event" comes back as 403 *forbidden*. |
| Success after failure | Not found in the web dialogs checked: success shows only after the server confirms. Two optimistic exceptions: the forgot-password page (VF-14) and the timer project picker (VF-30, suspected). |
| Warnings | There is no warning toast or banner component. Warning banners mix `role="status"` and `role="alert"`. There is no unsaved-changes guard, except on the policies page (VF-25). |
| Confirmations | 40 destructive actions use `ConfirmDialog` with a pending state. Five have none (VF-26). Two confirms have no `loading` (dashboard reset, policy discard). Finalize payroll ("This cannot be undone") is not styled as danger. |
| Greetings | The web dashboard greets by browser time, not the person's profile time zone, and without a name. The desktop greets "Good morning, {first name}" with no fallback for an empty name. "Welcome Back" uses title case while the rest of the app uses sentence case (VF-27). |
| Empty and loading | `EmptyState` has no heading or role. `SkeletonRows` sets `aria-label="Loading…"` on a div with no role, and `Spinner` has no role. |
| Session, network, rate limit | 401 redirects silently (VF-11). Network failure shows "Failed to fetch" (VF-09). 429 shows "Too many requests. Please slow down." but ignores `Retry-After`. 503 says "The service is busy…", which is good. |
| Error pages | No `error.tsx`, `not-found.tsx` or `global-error.tsx` (VF-12). |
| Terminology | "WorkPulse" and "Tallywork" are both visible to users (install texts, user agent). Save confirmations vary: "X saved", "X updated", "Changes saved". The device confirm says "Revoke device" but the toast says "Device signed out". The web says Start/Stop while the desktop says Clock in/Clock out. Only 20 of 132 web files use the message catalog, and the desktop uses none. |

---

## D. Validation discrepancy report (frontend vs backend vs database)

| Field / rule | Frontend | Backend | Database | Gap owner |
|---|---|---|---|---|
| Invoice `due_date ≥ issue_date` | detail page: `min=issue` | **create: none**; PATCH checks it (`services/finance.ts:1100`) | text, no check | Backend (VF-02) |
| Invoice line `quantity`, `unit_price_minor` | no max | no max, float quantity | `numeric(12,4)` holds at most 99,999,999.9999; `bigint` amounts | Backend vs DB (VF-03) |
| Budget amount, payment amount | no max | `int().min(1)`, no max (safe-int only) | bigint | Backend (consistency: expenses and rates cap at 100,000,000) |
| Pay group members on PATCH | always sends the full list | full schema, `member_ids` defaults to `[]` | — | Backend (VF-04) |
| Report `from ≤ to`, span | UI limits to ≤400 days | **none** | — | Backend (VF-06) |
| API key `expires_at` | date picker, min tomorrow | any datetime, past allowed | — | Backend (VF-07) |
| Payment `provider_ref` | — | not trimmed | unique on raw value | Backend (VF-07) |
| Webhook events | checkbox list | unknown names dropped, then **403** if none remain | — | Backend status code (VF-07) |
| Policy number fields | shows a range hint but keeps the last valid value and leaves Save enabled | zod ranges | jsonb | Frontend (VF-22) |
| Desktop sign-in email / server URL | `noValidate`, trims email | IPC zod throws, uncaught | — | Desktop renderer (VF-13) |
| Desktop manual-time reason | label shows "required", not enforced | IPC: no `min(1)`; API refuses | — | Desktop (VF-24, server is authoritative) |
| Email case | — | lowercased in services | `lower(email)` unique | OK |
| Whitespace-only text | button disabled (most forms) | `nonEmpty` trims | — | OK, except `sessionNoteInput.note`, payment `provider`/`provider_ref` and agent `device.name` (not trimmed) |
| Overlapping time, duplicate client, invitations | — | locks / unique checks | unique indexes where present | OK under 5× concurrent submits |
| Money and date sanity in the database | — | zod | **no CHECK constraints; dates stored as text; finance tables lack most foreign keys** | DB (VF-18, defence in depth) |
| Upload content type | `accept` list | trusts the client `Content-Type`; size checked after buffering | — | Backend (VF-17) |

---

## Findings

| ID | Sev | Category | Status | Finding (evidence) | Recommended correction | Regression test |
|---|---|---|---|---|---|---|
| VF-04 | Medium | Data integrity | Confirmed | `PATCH /payroll/profiles/:id` parses the full create schema. `member_ids` defaults to `[]`, so a rename-only PATCH removes every member and deletes their stored bank details (`routes/ops-finance.ts:209`, `services/payroll.ts:95-99`). Not reachable with API keys, and the UI sends the full list, so the risk is latent. | Use `payrollProfileInput.partial()` for PATCH and leave members untouched when `member_ids` is absent. Same for `PATCH /time-types/:id`. | VF-04 |
| VF-02 | Medium | Validation | Confirmed | `POST /invoices` accepts a due date before the issue date (201). Only the draft PATCH checks it. | Add the same check to `createInvoice` (`services/finance.ts`) with a `due_date` field error. | VF-02 |
| VF-03 | Medium | Validation / error handling | Confirmed | Invoice line `quantity × price` is unbounded. `1e9 × 1e9` returns **500** (numeric overflow, 22003). `1e12` returns **404 "resource not found"**. The preview returns a total of `1e+24`. No partial invoice is left. | Cap `quantity` (≤ 99,999,999.9999, 4 decimals) and `unit_price_minor` / amounts at 100,000,000 like rates. Map 22003/23514/23503/23502 to 400/409/422 in `fromDatabaseError`. | VF-03 |
| VF-06 | Medium | Validation / resource use | Confirmed | `POST /reports/:key/query` has no `from ≤ to` and no span limit. Reversed ranges return 200. `0001…9999` ran for 3.7 s and then returned 500. Reachable with a `read:reports` API key. | Reuse `dateRangeQuery` (≤ 400 days) in `reportQueryInput`. | VF-06 |
| VF-08 | Medium | Security (resource exhaustion) | Confirmed | No request-size limit: 6 MB and 40 MB JSON bodies were read in full before validation. There is also no JSON depth limit (a 5,000-level nested body was accepted). | Hono `bodyLimit` (for example 1 MB for JSON, matched to upload routes' own limits) in `app.ts`. | VF-08 |
| VF-01 | Medium | UX feedback | Confirmed | Validator wording reaches people: "name: Too small: expected string to have >=1 characters", "Invalid option: expected one of \"LOW\"…", "must match pattern /^#[0-9a-fA-F]{6}$/". The title copies the first issue (`lib/http.ts:62`). Extends QA-01. | One zod error map in `packages/contracts` (plain sentences per issue type), and a neutral title ("Check the highlighted fields"). Forms already read `errors[]`. | VF-01, public-auth tests |
| VF-09 | Medium | Error handling | Confirmed | A lost connection shows the toast "Failed to fetch". There is no offline detection (`lib/api.ts`). | Catch `TypeError` in `api()` and throw an `ApiError` with "We couldn't reach WorkPulse. Check your connection and try again." | VF-09 |
| VF-11 | Medium | UX feedback | Confirmed | On a 401 mid-session, `api()` redirects to `/login?next=` with no reason, then still throws, so an error toast can flash first (`lib/api.ts:32-35`). | Add `&reason=expired` to the redirect, show "Your session has ended. Sign in again to continue." on the login page, and do not throw after redirecting. | VF-11 |
| VF-14 | Medium | UX feedback (misleading) | Confirmed | Forgot password shows "If an account exists for …, a reset link is on its way" even when the request failed (500, 429) (`(auth)/forgot-password/page.tsx:32`). | Keep the neutral message for success. Show an error on failure, for example on a 429: "Too many requests. Wait a few minutes and try again." | VF-14 |
| VF-13 | Medium | Error handling (desktop) | Confirmed | A malformed email (for example `worker@`) or server URL makes the main-process IPC schema throw. The renderer `submit()` has no catch, so nothing is shown (`apps/desktop/src/renderer/src/App.tsx:249-258`, `shared/ipc.ts:15-21`). | try/catch in `submit()` and set a plain message ("Enter a valid email address"); validate the email before sending. | VF-13 (Electron) |
| VF-10 | Medium | Accessibility | Confirmed | Error toasts use `aria-live="polite"`. They disappear after 4 s with no pause on hover or focus and have no close button (`overlays.tsx:240-262`). There is no warning style, and info uses the success icon. WCAG 2.2.1, 4.1.3. | Errors: `role="alert"` and no auto-hide (or pause on hover/focus). Add a labelled close button and an info icon. | VF-10 |
| VF-21 | Medium | UX feedback | Confirmed (code) | Forms show their alert only when `errors[]` is empty. A server error on a field the form does not render is then shown nowhere: sign-up `organization_name`/`timezone`, org settings `week_start`/`settings.durationFormat`, portal invite `name`, 2FA reset. | In `ApiError`, add `unmatched(fields)` and show those messages in the form alert. | to add with the fix |
| VF-22 | Medium | Validation (frontend) | Confirmed (code) | Tracking policy number fields: an out-of-range value shows a red hint, but Save stays enabled and silently saves the last valid value (`settings/policies/page.tsx:285-300`). | Track invalid fields and disable Save, or block the save with a message. | to add with the fix |
| VF-12 | Low | Error handling | Confirmed | There is no `not-found.tsx`, `error.tsx` or `global-error.tsx`. Unknown URLs show Next's bare "404 / This page could not be found." with no way back, and a render crash shows Next's default error screen. | Add the three files with a link home and the request id. | VF-12 |
| VF-05 | Low | Error handling | Confirmed | Malformed requests return 500 instead of 400: unknown policy scope (`org.ts:249`), unknown dashboard scope (`insight-platform.ts:57-59`), receipt/document upload sent as JSON (`org.ts:199`, `insight-platform.ts:204`). Also `support.ts:18,22`. | Use `parse()` (which maps to 400), and check the multipart content type first. | VF-05 |
| VF-07 | Low | Validation | Confirmed | An API key can be created already expired. An unknown webhook event returns 403 *forbidden*. A payment reference with a leading space bypasses the duplicate check. | `expires_at` in the future; `validation()` instead of `forbidden()` (`services/platform.ts:242`); trim `provider`/`provider_ref`. | VF-07 |
| VF-16 | Low | Security (information exposure) | Confirmed (code) | Bulk time-entry and bulk-approve results return `e.message` for any error, including database driver text (`services/timesheets.ts:459, 932`). | Return `DomainError.message` only; otherwise "Could not update this entry" and log the cause. | to add with the fix |
| VF-17 | Low | Security (uploads) | Confirmed | Upload type is taken from the client header: HTML bytes labelled `image/png` were stored as a receipt. Impact is limited (served with the stored type and `nosniff`), but the bytes are never checked. The whole body is buffered before the size check. | Check magic bytes for PDF/PNG/JPEG/WebP; enforce the size before buffering. | — |
| VF-18 | Low | Data integrity | Confirmed (code) | There are no CHECK constraints on money or date order. Dates are stored as text. `invoices.client_id`, `payments.client_id`, `expenses.*` and `budgets.subject_id` have no foreign keys. App code enforces all of it today. | Add CHECKs (`amount_minor > 0`, `ended_at > started_at`, `paid_minor ≤ total_minor`) and FKs in a migration, after checking existing data. | `packages/db/test` |
| VF-20 | Low | UX feedback | Confirmed (code) | When resending the verification email fails, it says "Could not sign in" (`components/check-email.tsx:32`). | Use its own message: "We couldn't resend the email. Try again in a few minutes." | — |
| VF-26 | Low | UX (confirmations) | Confirmed (code) | No confirmation for: expense reject; timesheet and time-off bulk approve; removing a member from a team (single icon click); desktop timesheet submit; desktop sign-out while the timer runs (it stops the timer without the end-of-day report). | Confirm the desktop sign-out-while-tracking and the team member removal. Take a reason on expense reject. Bulk approve is acceptable without a confirm if failures are listed. | — |
| VF-19 | Low | Security (enumeration) | Confirmed | Sign-up answers 409 "An account with this email already exists", while login and forgot-password do not reveal accounts. It is rate-limited to 10 per hour. | Accept the trade-off, or answer neutrally and email the existing owner. | — |
| VF-24 | Low | UX / a11y (desktop) | Suspected | Desktop errors are `<p>` elements without `role="alert"`, except on sign-in. Work-note save failures are dropped. Manual time has no busy state, and its "reason required" label is not enforced before sending. | `role="alert"` on error lines; show save failures; a busy state. | — |
| VF-23 | Low | UX | Suspected | Policies: switching the member or team selector discards unsaved edits without asking. Only the scope switch asks. | Reuse the existing "Discard unsaved policy changes?" confirm. | — |
| VF-25 | Low | UX | Confirmed (code) | There is no unsaved-changes warning on long forms (new invoice, time entry dialogs, desktop manual time). | `beforeunload` and dialog-close guard when dirty, for the invoice builder first. | — |
| VF-27 | Low | UX | Confirmed (code) | The greeting uses browser time, not the profile time zone. The desktop greeting has no empty-name fallback. Duplicate team names, role names and holidays on the same date are allowed. | Use the member's time zone; fall back to a greeting without a name; warn on duplicate role names. | — |
| VF-30 | Low | UX | Suspected | The timer picker updates before the switch succeeds (`components/shell/timer-bar.tsx:69`). | Update after success, or roll back on error. | — |
| VF-31 | Info | UX | Suspected | Notifications "Mark all read" has no error handling (`app-shell.tsx:259`). | Add an error toast on failure. | — |

The earlier report's QA-01 (raw messages) and QA-02 (`Field` without `aria-invalid`/`aria-describedby`) remain open and overlap VF-01.

**Checked and found sound:**
- Mass assignment: ids, `organization_id` and `created_by` in bodies are ignored.
- SQL injection: the queries are parameterized. The few `sql.raw` uses are allow-list sanitized.
- XSS: React escapes output; emails escape values; the only `dangerouslySetInnerHTML` is a static script.
- Open redirects: `next` and the desktop `redirect_uri` are validated.
- SSRF: webhooks refuse private addresses.
- CSRF: same-origin plus a JSON content type.
- Concurrency: overlaps, unique client names and invitations held under 5 parallel submits.
- Tenant isolation.
- Login messages do not reveal accounts.
- CSV export guards against formula injection.
- Double submit in dialogs: the client and task dialogs use a synchronous guard.

---

## E. Automated test results

**New tests:**
- `e2e/tests/web/qa/validation-feedback.spec.ts`: 16 tests.
- `e2e/tests/electron/sign-in-feedback.spec.ts`: 1 test.

| Test | Result | Defect |
|---|---|---|
| Server rules that hold (13 rules, overlap under 5× concurrency, duplicate-name race, mass assignment) | **pass** | — |
| Blank name blocked; duplicate explained on the field; input kept | **pass** | — |
| Server error keeps the dialog and input; no false success | **pass** | — |
| VF-01 human-readable validation messages | fail | VF-01 |
| VF-02 invoice due before issue | fail (201) | VF-02 |
| VF-03 oversized invoice line | fail (500, 404) | VF-03 |
| VF-04 pay group rename keeps members | fail (members emptied) | VF-04 |
| VF-05 malformed requests answer 400 | fail (four 500s) | VF-05 |
| VF-06 report range | fail (200, 500) | VF-06 |
| VF-07 expired key, unknown event, padded reference | fail (201, 403, 201) | VF-07 |
| VF-08 oversized body refused (413) | fail (400 after reading 5 MB) | VF-08 |
| VF-09 lost connection explained | fail ("Failed to fetch") | VF-09 |
| VF-10 error toast assertive and dismissible | fail | VF-10 |
| VF-11 session expiry explained | fail | VF-11 |
| VF-12 404 page with a way back | fail | VF-12 |
| VF-14 no "on its way" after a failure | fail | VF-14 |
| VF-13 desktop sign-in with a mistyped email (Electron) | fail (no message) | VF-13 |

New tests: 17 run, **3 pass and 14 fail, each on a confirmed defect**. None were skipped. Three test faults found during the runs were fixed without weakening any assertion:
- a request context closed after `beforeAll`;
- an invoice body's `status` field overwrote the HTTP status;
- the pay-group members field name.

**Full regression** (`pnpm test:e2e`, web + desktop + electron, 6.1 min): **406 tests, 375 passed, 31 failed.**
- The 31 failures are all known-defect tests: 17 from the earlier QA report (QA-01 to QA-07) and the 14 above.
- Every test that existed before these two QA passes passed, so existing workflows show no regression.

API probe scripts (outside the repo, isolated server only): `validation-probe.mjs`, `validation-probe2.mjs`, `validation-probe3.mjs` and `validation-probe4.mjs` in the session scratchpad.

**Artifacts:**
- HTML report: `e2e/playwright-report/index.html` (`pnpm --filter @tallywork/e2e report`).
- Traces, screenshots and videos for each failure: `e2e/test-results/`.

---

## F. Prioritized remediation plan (awaiting approval; no app code changed)

| # | Fix | Files | Change | Tests that turn green |
|---|---|---|---|---|
| 1 | Pay group PATCH | `packages/api/src/routes/ops-finance.ts:209`, `services/payroll.ts:85-105`; also `routes/org.ts:110` (time types) | Partial schema for PATCH; only touch members when `member_ids` is sent | VF-04, plus a Vitest in `packages/api/test` |
| 2 | Invoice create rules and limits | `packages/contracts/src/inputs.ts` (`invoiceCreateInput`, `budgetInput`, `paymentInput`), `services/finance.ts` (create) | due ≥ issue; quantity ≤ 99,999,999.9999 with 4 decimals; amounts ≤ 100,000,000 | VF-02, VF-03 |
| 3 | Database errors that are the caller's doing | `packages/api/src/lib/http.ts:21-28` | Map 22003 to 400, 23503 to 422, 23514 to 400, 23502 to 400, with plain messages | VF-03 |
| 4 | Report range | `inputs.ts` (`reportQueryInput`) | `from ≤ to`, ≤ 400 days | VF-06 |
| 5 | Body limit | `packages/api/src/app.ts` | `bodyLimit` for JSON (1 MB); the upload routes keep their own caps | VF-08 |
| 6 | Readable messages | new `packages/contracts/src/messages.ts` (zod error map), `lib/http.ts:60-63` | Plain sentences per issue type; title "Check the highlighted fields" | VF-01, QA-01 tests |
| 7 | Client error handling | `apps/web/lib/api.ts` | Network `TypeError` becomes a readable `ApiError`; 401 adds `reason=expired` and stops; `unmatched()` helper | VF-09, VF-11, VF-21 |
| 8 | Login and forgot-password messages | `(auth)/login/page.tsx`, `(auth)/forgot-password/page.tsx`, `components/check-email.tsx`, `messages/en.ts` | "Session ended" notice; error on a failed forgot request; correct resend failure text | VF-11, VF-14, VF-20 |
| 9 | Toasts | `packages/ui/src/overlays.tsx` | Errors use `role="alert"` and stay until dismissed or pause on hover/focus; close button; info icon | VF-10 |
| 10 | Error pages | `apps/web/app/not-found.tsx`, `error.tsx`, `global-error.tsx` | Branded pages with a link home and the request id | VF-12 |
| 11 | Malformed requests | `routes/org.ts:249`, `insight-platform.ts:57-59,204`, `support.ts:18,22` | `parse()` and a content-type check | VF-05 |
| 12 | Small validation slips | `inputs.ts` (`apiKeyInput`, `paymentInput`), `services/platform.ts:242` | Future expiry; trim the reference; validation instead of forbidden | VF-07 |
| 13 | Desktop sign-in | `apps/desktop/src/renderer/src/App.tsx:249` | try/catch and a plain message | VF-13 |
| 14 | Policies number fields | `settings/policies/page.tsx` | Block Save while a value is out of range | new test |
| 15 | Bulk error text | `services/timesheets.ts:459,932` | Domain messages only | new API test |
| 16 | Field accessibility (QA-02) | `packages/ui/src/primitives.tsx` `Field` | ids plus `aria-describedby`/`aria-invalid`/`aria-required` via context | public-auth test |
| Later | Upload magic bytes (VF-17), DB CHECK constraints and FKs (VF-18, needs a migration), confirmations (VF-26), unsaved-changes guard (VF-25), desktop live regions (VF-24), i18n and brand wording | — | — | — |

---

## H. Remediation (approved and applied, 30 Oct 2026)

Fixes 1–16 from F were applied. The "Later" row was not: magic bytes, database constraints, confirmations, unsaved-changes guards, desktop live regions and wording.

| Fix | Finding | What changed |
|---|---|---|
| 1 | VF-04 | `payrollProfilePatchInput` and `timeTypePatchInput`. The PATCH services merge with the stored row, so leaving out `member_ids` keeps members and bank details. |
| 2 | VF-02, VF-03 | `buildInvoiceDraft` checks that due ≥ issue (create and preview), with a `due_date` field error. Invoice line quantity ≤ 100,000 (still rounded to 4 decimals, F10). Unit price ≤ 100,000,000. Budget and payment amounts ≤ 10¹². |
| 3 | VF-03 | `fromDatabaseError` maps 22003/22001/23502/23514 to 400 and 23503 to 409. These are logged as warnings, so validation gaps stay visible. |
| 4 | VF-06 | Report query and export: from ≤ to, at most 400 days (the same rule as the report screen). |
| 5 | VF-08 | JSON bodies are limited to 1 MB (4 MB for the desktop ingest batch), with a 413 `payload_too_large` problem. Uploads keep their own limits. |
| 6 | VF-01, QA-01 | `packages/contracts/src/messages.ts`: plain-language messages for every zod issue type, used by `parse()`. Titles read "Name: This field is required". Malformed email-link tokens read "This link is invalid or has expired". Field paths in `errors[]` are unchanged. |
| 7 | VF-09, VF-11, VF-21 | `api()`: a lost connection becomes "We couldn't reach WorkPulse. Check your connection and try again." A 401 after the app had been working redirects with `reason=expired` and shows no error on the way. `ApiError.general(shown)` puts field errors that a form has no place for into its alert. |
| 8 | VF-11, VF-14, VF-20 | The sign-in page says "Your session has ended. Sign in again to continue." Forgot password shows an error when the request fails. The resend-verification failure has its own message. |
| 9 | VF-10 | Toasts: errors go in an assertive live region and other kinds in a polite one. Every toast has a Dismiss button, pauses while hovered or focused, and errors stay 8 s. There is a new `warning` kind, and info has its own icon. |
| 10 | VF-12 | `app/not-found.tsx`, `app/error.tsx` (Next 16 `retry`) and `app/global-error.tsx`, each with a way back to the workspace. |
| 11 | VF-05 | Path and query values go through `parse()`. A `formFile()` helper answers 400 for non-multipart uploads. A receipt with no file is a 400 instead of a 404. A wrong receipt type or size is a 400 instead of a 403. |
| 12 | VF-07 | An API key cannot expire in the past. Unknown webhook events are a 400 with an `events` field error. Payment `provider` is trimmed and lowercased; `provider_ref` is trimmed, and a blank one is treated as none. |
| 13 | VF-13 | Desktop sign-in checks the email and server address first and catches anything the main process refuses, showing a plain message. |
| 14 | VF-22 | Tracking policies: Save is disabled while a number is out of range, with a notice. The error alert uses field labels, not raw keys. |
| 15 | VF-16 | Bulk time-entry and bulk-approve results return only rule messages. Other errors are logged and answered with a neutral message. |
| 16 | QA-02 | `Field` gives its control `aria-describedby` (error or hint), `aria-invalid` and `aria-required` through context (`useFieldAria`). `AuthInput` uses it too. |

**Tests added or updated:**
- `packages/api/test/validation-feedback.test.ts`: 17 tests.
- `packages/ui/test/field-aria.test.ts`: 5 tests.
- `apps/web/test/api-errors.test.ts`: 6 tests.
- The E2E specs in E now pass.

**Existing tests changed because the approved behaviour changed:**
- `packages/api/test/flow.test.ts` queried reports over 2000–2100. It now uses a 350-day window around its data. Its worker-gets-403 check still runs, because the request is valid.
- `e2e/tests/web/qa/public-auth.spec.ts` expected zod's "Invalid email address". It now expects "This field is required" for an empty field and "Enter a valid email address, like name@example.com" for a malformed one.

**Results after the fixes:**
- **Vitest:** all pass. api 661 (2 skipped), web 94, desktop 62, domain 72, db 19, ui 16.
- **Typecheck:** `pnpm typecheck` passes in 8 of 8 workspaces.
- **E2E, all projects, fresh build:** 406 tests, 389 passed, 17 failed.
  - 15 of the 17 are the open findings from the QA automation report, which these fixes did not cover: QA-03 dialog focus return, QA-04 phone drawer, QA-05 tablet layout (10 routes), QA-06 badge contrast (2 pages) and QA-07 desktop Home.
  - The other 2 (calculator position, the "My timesheet" smoke) timed out under full-suite load. Both specs passed 48 of 48 when re-run alone, twice each.
- **This audit's tests:** all 16 VF tests (web and Electron) and the QA-01/QA-02 sign-up tests now pass.

**Considered and not changed:** rejecting quantities with more than 4 decimals. The existing F10 rule rounds them on purpose, and `money-phase3.test.ts` covers it.

## G. Readiness verdict

- **Validation:** ready, with fixes 1–5 recommended before the next release. Server-side validation is consistent and could not be bypassed. The confirmed gaps are narrow: invoice dates and limits, report ranges, a pay-group PATCH, body size.
- **Data integrity:** ready for current UI use. VF-04 is a latent data-loss trap for anyone calling the API directly. The database has no defence-in-depth constraints.
- **User feedback:** **not yet at standard.** Validator wording, "Failed to fetch", a silent session expiry, a false "reset link sent", fields whose errors appear nowhere, and silent desktop sign-in failures are all confirmed.
- **Accessibility:** not at standard: error toasts, field associations (QA-02) and desktop live regions.

| | Count | Items |
|---|---|---|
| Confirmed issues | 24 | VF-01 to VF-14, VF-16 to VF-22, VF-25 to VF-27 (VF-15 was folded into VF-03). 16 were reproduced live or by test; the rest were confirmed in code. |
| Suspected | 4 | VF-23, VF-24, VF-30, VF-31 |

**Not tested:** screen readers, the live site, email content, and cross-browser behaviour.
