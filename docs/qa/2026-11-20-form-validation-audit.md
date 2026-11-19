# Form and input validation audit, 20 November 2026

A project-wide audit of every form, input and upload in WorkPulse (web app, desktop app, browser
extension and the API that backs them), with the fixes made and the tests that check them. Branch
`qa/full-pass-2026-11`.

## How the audit was done

1. **Inventory.** Every file with an input was read in full: 101 web files, the desktop renderer and its
   IPC handlers, the extension, and every Zod schema in `packages/contracts`. Each field was traced to the
   endpoint and schema that receive it.
2. **Server first.** Every API route already parses its body with a Zod schema (`lib/http.ts` `body()`),
   refuses non-JSON bodies (no cross-site form posts), caps JSON size, and strips unknown keys (no mass
   assignment). Queries use Drizzle with bound parameters (no SQL built from strings). The gaps were in
   what individual schemas allowed, and in uploads.
3. **Fixes in batches**, each followed by its tests: server and contracts, then auth forms, phone numbers,
   then the remaining web and desktop forms.

## Summary

| | Count |
|---|---|
| Forms and dialogs inspected (including filter bars and the desktop app) | about 95 |
| Input fields inspected | about 330 |
| Validation issues found with evidence | 52 |
| Fixed | 43 |
| Left open (product decision or low impact, listed below) | 9 |

## Building blocks added

| What | Where | Used by |
|---|---|---|
| `email`: trimmed, then a real address (domain with a dot and a 2+ letter ending) | `packages/contracts/src/common.ts` | every email in the API |
| `personName` / `optionalPersonName`: any script, spaces, `' ’ - . , ( )`, digits, at least one letter | same | sign-up, invitations, profile name, staff details, client contact, portal viewers |
| `optionalPhone`: checked per country with Google's numbering data, stored in E.164 | same, rules in `src/phone.ts` (`@tallywork/contracts/phone`, no zod) | organization, staff (2 fields), client |
| `contentMatchesType`: the upload's first bytes must match its declared type | `packages/api/src/lib/file-sniff.ts` | project documents, receipts, screenshot fallback |
| `PhoneInput`: searchable country list (common countries first), number formatted per country | `apps/web/components/phone-input.tsx`, `lib/phone.ts` | the 4 phone fields |
| Browser copies of the server rules (names, password confirmation, receipts, time ranges) | `apps/web/lib/form-checks.ts`, `lib/personal-info.ts` | the forms below; `test/form-checks.test.ts` holds them to the server's schemas |
| `isSecureServerUrl` | `apps/desktop/src/shared/server-url.ts` | desktop sign-in |

Phone library: `libphonenumber-js` 1.13.15 (pinned, MIT), with its "min" data set (about 25 KB
gzipped, only on pages with a phone field). It checks each country's lengths and leading digits; strict
per-digit patterns would need the "max" set (+65 KB). Server and browser use the same set, so they agree.

## Issues found and fixed

| # | Module / page | Field | Problem | Impact | Fix |
|---|---|---|---|---|---|
| 1 | Projects › Documents; Expenses › Receipt | file | Type taken from the file name; content never checked | A program or web page renamed `.pdf` was stored and served as a PDF | Content must match the type (magic bytes); refused with `file_content` |
| 2 | Expenses | receipt | Empty file accepted | Expense with an unreadable receipt | Refused, message on the file field |
| 3 | Desktop screenshot upload (dev fallback) | body | Content not checked | Same as 1 | Same check |
| 4 | Projects › Documents | .zip from Windows | `application/x-zip-compressed` refused though `.zip` was offered | Upload failed on Windows | Accepted (content checked) |
| 5 | API, all email fields (12) | email | Not trimmed | API clients sending `" a@b.co"` got an error | Trimmed before the check |
| 6 | Sign-up, invitations, profile, staff details, client contact, portal | names | `12345` and `<script>` accepted | Junk names in lists, emails and PDFs | Name rule on server and in the forms |
| 7 | Staff › Personal info | birth date | Future dates accepted | Wrong HR data | Must be in the past and from 1900 (server; `min`/`max` and check in the form) |
| 8 | Projects, Workers (API) | end date sent alone | Compared only when both dates were in the request | End before start saved through the API | Compared with the saved date |
| 9 | Timesheets › Manual time (API) | reject comment | Required only in the browser | Rejection without a reason | Required by the API (`comment`) |
| 10 | Performance › Goals | target | 0.4 tasks accepted and stored as 0 | Goal that can never be measured | Whole number of at least 1 (server and form); step follows the metric |
| 11 | Settings › Organization; Staff › Personal info (×2); Clients | phone | Any text up to 50 characters | Unusable numbers | Country picker, per-country check, E.164 storage, sent only when changed (older free text does not block other edits) |
| 12 | Invoices and pay stubs (PDF) | company phone | Would print raw E.164 | Hard to read | Printed in international format |
| 13 | Sign-up, reset password, invitation, portal invitation | new password | Typed once | A typo locks the person out | "Confirm password" field and check |
| 14 | Portal invitation | password, name | No checks before sending; no length limit | Errors only after a round trip | Server rules in the form, `maxLength` |
| 15 | Reset password | errors | "Link invalid or expired" shown under the password field | Misleading | Link errors above the button; password errors under the field |
| 16 | Profile › Password | new password | No 200-character limit; empty form did nothing | Silent failure | Rule and "required" messages; `maxLength` |
| 17 | Login, sign-up, forgot and reset password, invitation, holidays, portal email, time-off hours per day | required fields | No required marker | Unclear what is required | `*` markers |
| 18 | Developer › API keys | expiry date | Server error never shown | Key creation failed silently | Past date checked in the form; server error under the field |
| 19 | Expenses | receipt | Errors only in a toast; no check before upload; retry uploaded twice | Confusing, orphan files | Checked when picked, error under the field, upload reused on retry |
| 20 | Timesheets › Manual time and Edit entry | start / end | End before start not checked in the form ("At most the time logged" shown instead); server errors had no field | Misleading message | Checked in the form; server errors now on `ended_at`; required reason checked |
| 21 | Timesheets › Edit entry | all | Each error shown twice | Noise | Banner only for errors without a field |
| 22 | Invoices › Record payment | allocations, amount | Unreadable amounts silently dropped; overpaying refused only by the server | Payment applied differently than typed | Each amount checked against its invoice's balance |
| 23 | Performance › New achievement | levels | Decimals passed the form; server error never shown | Silent failure | Whole numbers; server error shown |
| 24 | Performance › Goal, Recognize, Revoke | start date, achievement, reason | Server errors had no place to show | Toast only | Shown beside the field |
| 25 | Projects › Client folder | client | Enter created a folder with no client, and could save twice | Error or duplicate | Guarded |
| 26 | People › Schedule | shift times | An emptied start time passed the check | Server error not shown | Empty times are invalid |
| 27 | Settings › Screenshot retention | custom days | Error not linked to the input | Screen readers missed it | `aria-invalid` / `aria-describedby` |
| 28 | Settings › Security › Data retention | days | Always said "Minimum X days" | Wrong message for decimals or too many days | Message names the actual problem |
| 29 | People › Invite member | name, email | No name rule, no length limits, Enter could send twice | Junk data, duplicate invites | Rule, `maxLength`, guard |
| 30 | Settings › Tracking policies | excluded domains | Any text accepted | Entries that could never match | Host name rule (server and form), Save blocked with a message |
| 31 | Settings › Organization | email, late grace, budget % | Save disabled with no message | Unclear why Save is off | Messages beside the fields |
| 32 | Invoices › New › custom lines | quantity, price | `0x10`, `1e3` accepted; no maxima in the form | Surprise amounts | Plain decimals; 100,000 and 1,000,000.00 limits |
| 33 | Finance › Budget | hours | `0x10`, `1e3` accepted | Surprise budget | Plain decimals |
| 34 | People › Time-off policy | hours, accrual, max balance, carry over | Empty and negative values sent; no maxima | Server error after sending | Ranges checked, `max` attributes |
| 35 | Desktop › Sign in | server address | `http://` accepted for remote servers | Password sent unencrypted | https, or http only on this computer (form and IPC schema) |
| 36 | Desktop › Sign in with browser | server address | Sent unchecked and untrimmed | Silent failure | Same check, with a message |
| 37 | Desktop › Manual time | date / times | A cleared field crashed submit (`RangeError`) | Developer error shown | Checked; also not in the future |
| 38 | Projects › Settings tab | estimate | `step=1` made the browser refuse 2.5 h and saved decimals | Could not save | Any decimal for hours |
| 39 | Developer › Webhooks; client, invite and portal emails | URL, emails | No `maxLength` matching the server | Long input refused late | `maxLength` |
| 40 | Members, Attendance, Time off requests | search | No `maxLength`; the server refuses searches over 100 characters | Error on a long paste | `maxLength={100}` |
| 41 | Reports › Save report | recipients | A schedule could be saved with nobody to send to | Server error after sending | Save needs at least one recipient |
| 42 | Timesheets › Import CSV | file | Type not checked (the picker filter can be switched off) | Confusing parse errors | Must be a .csv file |
| 43 | Assistant | rename | A failed rename was an unhandled error | Nothing shown | Error shown |

## Open issues (not changed)

| Module | Field | Why not changed | Suggestion |
|---|---|---|---|
| Expenses, Record payment | date spent / received | Whether a future date is ever valid is a business rule. The QA pass (same branch, separate change) is adding a server rule refusing future expense dates | Payments: decide; then add `max` and a server check |
| Payroll › Bank details | IBAN, SWIFT, routing | Formats vary by country and payment method | Validate IBAN checksum and SWIFT shape when `type = bank` |
| Payroll › Adjustments | deductions | Deductions above gross pay (negative net) may be intended | Decide; warn or refuse |
| API, multipart uploads | body size | The whole form is read before the 10 / 25 MB check; JSON has a body limit, multipart does not | Add a `bodyLimit` to upload routes |
| Phones | digit patterns | "min" data checks lengths and leading digits, not every pattern | Switch both sides to "max" data (+65 KB) if needed |
| Phones saved before this change | stored text | Left as they were (no data rewritten); shown as typed until edited | Optional one-off normalization |
| Security › Session lifetime | hours | Decimals are rounded silently | Low impact |
| Desktop | work note, idle reassign | Save failure silent; reassigning without a project accepted by IPC | Show the error; require the project |
| Profile › Avatar editor | save | A fast double click can upload twice | Guard before rendering |

## Test results (20 Nov 2026)

**Unit and integration (Vitest), all passing:**

| Suite | Result |
|---|---|
| `packages/api` | 1240 passed, 2 skipped (skips predate this work) |
| `apps/web` | 335 passed |
| `apps/desktop` | 148 passed |
| `packages/domain` | 207 passed |
| `packages/db` | 48 passed, 1 skipped |
| `packages/contracts` | 44 passed |
| `packages/ui` | 44 passed |
| `pnpm typecheck` | 8 of 8 workspaces |
| `pnpm test:gates` | every test file in exactly one gate |

New tests: `api/test/upload-content`, `api/test/input-validation`, `contracts/test/phone`, `web/test/phone-input`, `desktop/test/server-url`, additions to `web/test/form-checks`, `web/test/invoice-extra-lines` and `ui/test/field-aria`, and the Playwright spec `e2e/tests/web/form-validation.spec.ts`.

**End to end (Playwright):**

- Full regression (`pnpm test:e2e`, 1049 tests): 1043 passed, 6 failed.
  - `finance-figures`: the spec selected `getByLabel('Client *')`, and the required mark is no longer part of the label. Spec updated; rerun passed.
  - `invitations:31` and `offline-sync`: a timeout and a wrong duration while the computer was asleep (`ERR_NETWORK_IO_SUSPENDED` in the same run). Reruns passed.
  - `mobile-sweep` (2 pages): `ERR_NETWORK_IO_SUSPENDED` (computer asleep). Two reruns were voided: another test run started at the same time and deleted `e2e/test-results`, so they crashed while saving recordings.
  - `electron/timesheet-submit`: "There is no free 60-minute slot on 2026-11-20". The test adds an hour to the current day; run at 03:20–03:30 there is no free earlier hour. It depends on the time of day; the slot logic is unchanged here.
- Targeted reruns after the fixes:
  - Sign-in, sign-up, two-factor, keyboard-only sign-in, organizations and the new spec: 53 of 53.
  - Invitations, portal, portal insights, AI forecast portal, time entries, avatar, profiles, responsive, settings and integrations, CSV import, API keys and invoices: 108 passed.

The first full run found two problems caused by this work; both are fixed:

1. Marking the sign-in fields required put "*" inside their labels, so they were named "Password *" and tests looking for "Password" failed. The mark now sits beside the label, and `aria-required` tells assistive technology.
2. Specs that accept invitations did not fill the new "Confirm password".

- `mobile-sweep` run alone on a quiet machine: 132 of 132.

**Still to verify:** `electron/timesheet-submit` during the day (time-of-day dependent, see above).
