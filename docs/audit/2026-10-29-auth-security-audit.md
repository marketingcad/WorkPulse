# WorkPulse authentication and authorization audit, 29 Oct 2026

**Scope:** `main` plus PR #90 (branch `fix/ci-bundle-budget`). The audit was read-only: no project files were changed.

**Method:**
- three parallel code reviews, covering authentication, authorization and tenant isolation;
- probe tests run from the scratchpad (`probes/*.test.ts`) against the in-memory API harness;
- checks with Node's URL parser.

**Not done:** no production system was touched, and no browser was run.

## A. Executive summary

**Overall: FAIL.**

**What is sound:**
- Passwords are hashed with argon2id and compared in constant time.
- Sessions are random, stored hashed, and use an HttpOnly cookie. Absolute expiry is enforced.
- MFA has short-lived pending sessions and blocks code replay.
- Desktop tokens use PKCE with rotating, family-revoked refresh tokens.
- API keys are stored as HMACs.
- Tenant isolation in the database is strong: the app role has no RLS bypass, RLS is forced, and every system-mode path re-scopes to one organization.

**Why it fails:**
- **Cross-tenant write (AUTHZ-002, High):** any member with an approved desktop device can write into another organization's storage folder on the production backend (Supabase).
- **Narrow roles act org-wide (AUTHZ-001, High):** an "Assigned" scope on person-owned permissions turns into organization-wide access for every action on a single record. A probe erased a System Admin's data this way.
- **Credentials outlive recovery:** changing or resetting a password does not end other sessions (password change) or desktop tokens (password reset).
- **Login-page holes:** login CSRF and an open redirect.

**Production readiness:** fix AUTHZ-002 and AUTHZ-001 first. Neither needs a migration.

## C. Findings

**Status key:**
- **Confirmed** means reproduced by a probe test.
- **Confirmed-trace** means confirmed by reading the code; it could not be run in the harness.

**Severity:** a CVSS-style judgement. PR is the access level the attacker needs.

### AUTHZ-001: "Assigned" scope passes every per-record check on person-owned data
- **Severity:** High. PR is a custom role with an `assigned` grant; the impact is cross-user write and erasure.
- **Status:** Confirmed.
- **Evidence:**
  - `packages/domain/src/permissions.ts:248-250`: `case 'assigned': if (subject.projectId === undefined) return true;`.
  - Callers pass only `{ ownerMembershipId }`, so `projectId` is always undefined. About 30 call sites are affected, including `org.ts` (316, 365, 385), `privacy.ts` (53, 105), `timesheets.ts`, `activity.ts`, `finance.ts`, `operations.ts`, `platform.ts` and `timer.ts`.
  - List queries treat `assigned` as "own" (`visibleMembershipIds`, `permissions.ts:266`), so lists and per-record checks disagree.
- **Observed** with a role that has `members:manage`, `time:edit` and so on at `assigned`:
  - `POST /workers/{adminId}/anonymize` returned **200**, erasing a System Admin's monitoring data.
  - `PATCH /time-entries/{admin entry}` returned **200**.
  - The workers list showed 1 row (themselves). The rate and HR-details routes refused (403 and 404).
- **Recommendation:** in `can()`, treat `assigned` with a person subject as `own`, matching `visibleMembershipIds`. Also limit which scopes the role editor offers for each permission.
- **Verify:** a regression test that repeats the probe and expects 404.

### AUTHZ-002: Screenshot storage key path traversal, cross-tenant object write (production storage)
- **Severity:** High. PR is any member with an approved desktop device. Integrity is affected across tenants; reading across tenants also needs another tenant's object key.
- **Status:** Confirmed.
- **Evidence:**
  - `routes/agent.ts:100-104` (fallback `PUT /agent/screenshots/upload`) and `services/agent.ts:490-491` (`screenshot.captured`) check only `key.startsWith(org/O/screenshots/M/)`.
  - `SupabaseStorage.objectPath` (`lib/storage.ts:82-83`) leaves `..` as it is, and `fetch` normalizes the URL.
  - Production uses Supabase Storage (ADR-112; README:1150) with the service-role key, which ignores bucket policies.
- **Observed:**
  - The upload with `…/M/../B/…` returned 204, and the key was stored verbatim.
  - `org/A/screenshots/M/../../../../org/B/screenshots/X/…` passes the prefix check and reaches the wire as `/object/<bucket>/org/B/screenshots/X/…`.
- **Recommendation:** accept only keys of the form `${prefix}YYYY-MM-DD/<uuid>.<ext>(.thumb)?`. Reject `..`, `//` and `\`. Do this in the upload route, the `screenshot.captured` event, `/media`, and `storage.put/get` as defense in depth.
- **Verify:** an upload with `..` returns 403, and a unit test shows `SupabaseStorage` refuses dot segments.

### AUTH-001: Password change keeps other sessions and devices signed in (SEC-9)
- **Severity:** Medium.
- **Status:** Confirmed.
- **Evidence:** `routes/auth.ts:162-170` updates only `passwordHash`.
- **Observed:** after the change, a second session's `GET /me` returned **200**.
- **Also:** there is no rate limit on the route, and failed attempts are not counted toward lockout.
- **Recommendation:** revoke the user's other sessions and all device credentials, notify the user by email, add a rate limit, and count failed `current_password` attempts.
- **Verify:** the other session returns 401, and the refresh token is rejected.

### AUTH-002: Password reset does not revoke desktop refresh tokens
- **Severity:** Medium-High. Recovery fails to evict an attacker who holds a desktop token. That token reaches only the victim's own data.
- **Status:** Confirmed.
- **Evidence:** `services/identity.ts:244-249` revokes `userSessions` only.
- **Observed:** the web session returned 401, but `POST /agent/token` with the old refresh token returned **200**.
- **Recommendation:** revoke `deviceCredentials` for every membership of the user.
- **Verify:** the refresh returns 401 after a reset.

### AUTHZ-003: Invitations bypass team limits and scope (open item from phase 1)
- **Severity:** Medium-High. PR is `members:manage` at team scope.
- **Status:** Confirmed.
- **Evidence:**
  - `services/org.ts:447-456` checks that the grant exists. Team and project ids are checked only for existence, and `team_role: 'MANAGER'` is accepted.
  - Inviting a SUSPENDED member reactivates them (`identity.ts:291`).
  - `listInvitations` and `revokeInvitation` accept any scope.
- **Observed:**
  - A team-scope manager invited an account as MANAGER of a team it doesn't run: **201**.
  - That account then read a member of the team: **200**.
- **Recommendation:**
  - A narrow scope may add people only to teams it manages, and only as MEMBER.
  - Projects only where `canOnProject` allows.
  - Never reactivate a suspended member.
  - List and revoke only the invitations the actor sent.
- **Verify:** 403 for each case.

### AUTHZ-004: A scoped member manager can suspend, remove, re-role or erase a more privileged member
- **Severity:** Medium.
- **Status:** Confirmed.
- **Evidence:** `updateWorker` (`org.ts:313-338`), `removeWorker` (364) and `anonymizeMember` (`privacy.ts:101-106`) never compare the target's current role with the actor's grants.
- **Observed:** `PATCH /workers/{System Admin}` with `{status:'SUSPENDED'}` from a team-scope manager returned **200**.
- **Recommendation:** require `assertCanAssignRole(x, target.roleId)` before changing, removing or erasing a member.
- **Verify:** 403.

### AUTH-003: Open redirect after login through dot segments (SEC-4 bypass)
- **Severity:** Medium.
- **Status:** Confirmed for the sanitizer; the browser navigation is traced, not run.
- **Evidence:** `apps/web/lib/redirect.ts:6-15` returns `pathname` after `new URL()` collapses dot segments.
- **Observed:** `/.//evil.example`, `/a/..//evil.example` and `/%2e//evil.example` all become `//evil.example`, which points to the host `evil.example`. `login/page.tsx:38` then calls `router.replace` with it.
- **Recommendation:** reject a result that starts with `//` or `/\`.
- **Verify:** unit tests in `apps/web/test/redirect.test.ts`, plus an E2E test.

### AUTH-004: Login CSRF through cross-site text/plain POSTs (SEC-11)
- **Severity:** Medium.
- **Status:** Confirmed.
- **Evidence:**
  - The Origin check in `middleware/auth.ts:75` runs only when a session cookie is present.
  - `lib/http.ts` `body()` parses JSON whatever the Content-Type is.
- **Observed:** `POST /auth/login` with `content-type: text/plain` and `origin: https://evil.example` returned **200 with Set-Cookie**.
- **Recommendation:** require `application/json` on JSON bodies. Check Origin on every unauthenticated state-changing auth route: login, signup, invitation accept, password forgot/reset, verify-email resend, and portal accept.
- **Verify:** 403 or 415.

### AUTHZ-005: Task grants at team or own scope act org-wide
- **Severity:** Medium (custom roles only).
- **Status:** Confirmed for delete.
- **Evidence:** `services/work.ts:580-581, 636-637, 647` call `can(…, { projectId })` with team or own scope, which returns true. `canOnProject` exists for exactly this case.
- **Observed:** deleting a task on an unassigned project returned **204**. The edit returned 404.
- **Recommendation:** use `canOnProject` for task create, edit, delete and restore.
- **Verify:** 404.

### AUTH-005: Support console granted by email match, verification off by default (SEC-3)
- **Severity:** Medium (conditional).
- **Status:** Confirmed.
- **Evidence:**
  - `services/support.ts:35` checks the email only.
  - `config.ts:30` leaves email verification off by default, and `routes/auth.ts:79` marks new signups as verified.
- **Observed:** someone signing up with a staff address, then enrolling their own TOTP, reached `GET /support/orgs`: **200**.
- **Precondition:** the staff address is not yet registered.
- **Recommendation:** require a verified email for support staff (a real verification, not the auto-verify), or keep an allowlist of user ids.
- **Verify:** 404 until the address is verified.

### AUTH-006: "Require 2FA" and the IP allowlist do not apply to the desktop app
- **Severity:** Medium.
- **Status:** Confirmed.
- **Evidence:** the `enforceMfa` and `ipAllowlist` checks live only in `middleware/tenant.ts:167-171`. `services/agent.ts` `loginDevice` and `createDeviceAuthCode` do not check them.
- **Observed:** with the org set to "all", a member without 2FA got 403 on the web, but `/agent/login` returned 201 and `/agent/bootstrap` returned 200.
- **Recommendation:** for desktop sign-in, either require the member's 2FA when the org enforces it, or document this as intended. Apply the IP allowlist to agent routes.
- **Verify:** 403.

### AUTH-007: Emailed export links are bearer tokens for 7 days and survive the recipient's removal
- **Severity:** Medium (design).
- **Status:** Confirmed.
- **Evidence:**
  - `services/report-runs.ts:142` sets a 7-day expiry.
  - `app.ts:70-79` `/media/:token` checks only the signature and the org prefix.
- **Observed:** after the recipient was removed, the link returned **200** with no cookie.
- **Recommendation:** shorten the expiry to 24-48 h, or make emailed links open a sign-in page that checks membership before streaming.
- **Verify:** 401 or 404 after removal.

### AUTHZ-006: Device idle.resolved is not bound to the idle event's owner
- **Severity:** Low. The attacker needs the other member's idle id, a UUID generated on their device.
- **Status:** Confirmed.
- **Evidence:** `tracking.ts` `resolveIdle` loads the idle event by id only. `agent.ts:439` checks only the session.
- **Observed:** device A resolved member B's pending idle event; B had 0 pending afterwards.
- **Recommendation:** require `ev.sessionId === params.sessionId`.

### AUTHZ-007: API keys come back when their creator is re-invited
- **Severity:** Low.
- **Status:** Confirmed.
- **Observed:** the key returned 200, then 403 after removal, then **200** again after the person was re-invited as a Worker.
- **Recommendation:** revoke the member's keys on removal, and on loss of `api_keys:manage`.

### AUTHZ-008: roles:manage can edit roles held by more privileged members
- **Severity:** Low (tampering, not escalation).
- **Status:** Confirmed.
- **Observed:** an editor without payroll access stripped the payroll role: 200.
- **Recommendation:** allow editing only roles whose current grants the editor holds.

### AUTH-008: The rate-limit IP is the client-supplied leftmost X-Forwarded-For
- **Severity:** Low. It depends on the deployment; Vercel overwrites the header.
- **Status:** Confirmed in the harness.
- **Evidence:** `middleware/rate-limit.ts:17`.
- **Observed:** 0 of 25 rotated-IP logins were blocked, against 5 blocked from one IP.
- **Mitigation already present:** the per-account lockout still applies.
- **Recommendation:** reuse `clientIp()` from `lib/cidr.ts`.

### AUTH-009: Account lockout reveals that an account exists, and can lock out a known account
- **Severity:** Low.
- **Status:** Confirmed.
- **Observed:** a real email got 401 ×8 then 429. An unknown email got 401 every time.
- **Recommendation:** return the same response for unknown emails, or use a soft lockout (a growing delay or CAPTCHA) rather than a 429 that differs.

### AUTH-010: Reset and invite links are logged if production has no mail provider (SEC-8)
- **Severity:** Low (conditional on configuration).
- **Status:** Confirmed-trace.
- **Evidence:** `lib/mailer.ts:143` (`MemoryMailer(true)` outside tests) and `:83` (logs `msg.text`).
- **Recommendation:** in production, fail at startup when no mailer is configured, or log only the recipient and subject.

### TEN-001: A payment can store another organization's client id
- **Severity:** Low (integrity; nothing leaks).
- **Status:** Confirmed.
- **Observed:** 201. Reading that client still returned 404, and `client_name` was null.
- **Recommendation:** check `existsInOrg(client)` at every scope.

### Hardening (not vulnerabilities)
- No CSP on app pages (SEC-13).
- Race conditions on single-use tokens: email token, device code, refresh token, invitation accept.
- Older reset tokens are not invalidated when a new one is issued.
- No idle timeout on sessions.
- Turning on 2FA does not sign out other sessions.
- Recovery codes are stored as unsalted SHA-256.
- One `APP_SECRET` for everything, with no rotation path.
- The data-export run-time re-check accepts any `members:manage` scope.
- Former members get 403 rather than 404.

## F. Positive findings (verified)
- **Passwords:** argon2id (m=19456, t=2, p=1), a dummy hash for unknown emails, and constant-time comparisons (`lib/crypto.ts`).
- **Sessions:**
  - 32-byte tokens, stored as SHA-256.
  - The cookie is HttpOnly, SameSite=Lax, and Secure in production.
  - Absolute TTL; logout revokes on the server; reset revokes web sessions.
  - Disabling 2FA revokes other sessions.
- **MFA:**
  - A pending session lasts 10 minutes and reaches only two routes; a new session is issued after verification.
  - TOTP replay is blocked by a conditional update.
  - 10 failures per 15 minutes per account (SEC-10 fixed).
  - Disable and reset need the password plus a code.
- **Desktop:**
  - PKCE S256, with hashed codes that expire after 10 minutes.
  - HMAC access tokens last 10 minutes.
  - Refresh tokens rotate, and reuse revokes the whole family.
  - Device approval is enforced (SEC-2 fixed).
  - The device and membership are re-checked on every request.
- **API keys:**
  - Stored as HMACs, expiry and revocation checked.
  - Rights intersected with the creator's current grants.
  - A deny-by-default route allowlist.
- **Tenant isolation:**
  - The app role is `nosuperuser nobypassrls`.
  - RLS is FORCEd and fails closed when there is no org.
  - Every `withSystem` path re-enters `withTenant(org)`.
  - Non-members get 404; device tokens are refused on org APIs.
- **Other:**
  - The SEC-1 self-promotion is fixed.
  - Payroll is org-only, and bank details are self or `payroll:manage`.
  - SSRF protection: https only, private ranges blocked, connect-time re-resolution, no redirects.
  - No SQL injection found; no tokens in localStorage.
  - In production, errors are generic and logs record the route pattern only.

## Remediation status (29 Oct 2026, branch `fix/security-auth-audit`)

Every finding above is fixed except AUTH-006, which is kept by decision. Each fix has a regression test in `packages/api/test/security-auth.test.ts` (9 tests) or `security-authz.test.ts` (12 tests). All 21 fail on the code before the fixes.

| ID | Fix |
|---|---|
| AUTHZ-002 | Screenshot keys must match `<prefix>YYYY-MM-DD/<uuid>.<webp\|jpe?g\|png>` (with `.thumb` on uploads) in the upload route and the `screenshot.captured` event. Storage refuses keys with `.`/`..`/empty segments, backslashes or control characters on every backend (`isSafeKey`). `/media` refuses them too. |
| AUTHZ-001, AUTHZ-005 | In `can()`, a narrower scope never reaches a subject it doesn't cover. Someone else's data needs a `team` grant over people the actor manages. With `assigned` or `own`, a person's data means your own data only. A project needs an assigned project. |
| AUTH-002, AUTH-001 | `signOutEverywhere` revokes web sessions and every desktop refresh token. A password reset calls it. A password change also calls it, keeping only the current session. A password change is now rate-limited, and wrong current passwords count toward the lockout. |
| AUTHZ-003 | A narrower `members:manage` grant invites only into teams it manages, as a member, and only onto projects it is assigned to. It lists and revokes only the invitations it sent. Re-inviting a suspended member requires outranking them. |
| AUTHZ-004 | `assertOutranks` applies before changing a member's role or status, removing them, or erasing their data. "Outranks" is compared on power over others: team or org grants other than `org:read`, and non-read grants at assigned scope. |
| AUTH-004 | JSON bodies must be `application/json`. Signed-out writes to `/auth/*` and `/portal/*` must come from our own origin when the browser sends an Origin header. |
| AUTH-003 | `sameOriginPath` refuses a result that starts with `//` or `/\`. |
| AUTH-005 | The support console also requires a verification or password-reset link that this account opened. |
| AUTH-006 | **Kept by decision:** required two-factor applies to the web app only. The security settings page says so. |
| AUTH-007 | Emailed export links last 2 days instead of 7. |
| AUTHZ-006 | An idle answer must belong to the session that sends it. |
| AUTHZ-007 | A member's API keys are revoked when they are removed or suspended, or lose `api_keys:manage`. |
| AUTHZ-008 | Editing or deleting a role needs every grant it gives. |
| AUTH-008 | The rate-limit IP and the session IP come from `clientIp()`. |
| AUTH-009 | A locked account gets the same 401 and message as a wrong password, with a dummy hash check for timing. |
| AUTH-010 | With no mail provider in production, only the recipient and subject are logged. |
| TEN-001 | A payment's client must be in the organization at every scope. |
| Defense in depth | Single-use tokens are claimed with conditional updates: email tokens, device codes, refresh tokens and invitations. Issuing a new email link expires older ones. A Content Security Policy is set on every page (`apps/web/next.config.ts`). |

**Still open:**
- **Desktop and IP allowlist:** the desktop app is not subject to the IP allowlist. This needs a decision.
- **Hardening:** no idle session timeout, unsalted recovery codes, one shared `APP_SECRET` with no rotation, and turning on 2FA does not sign out other sessions.
- **Not verified:** whether Vercel Blob also normalizes `..`. The storage guard now covers every backend anyway.
- **Content Security Policy:** it allows inline scripts, because Next's bootstrap and the theme script are inline. A nonce-based policy would be stronger.
