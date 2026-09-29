# Authorization, API, Security

## 11. Authorization Matrix

### Model
- **Permission** = `resource:action` (for example `timesheet:approve`, `screenshot:view`, `screenshot:delete`).
- **Grant** = permission + **scope**: `own` (self), `team` (workers in teams I manage), `assigned` (projects I'm a member of), `org` (everything in the org).
- **Role** = named set of grants. The four built-in roles are presets stored as data (`roles`, `role_permissions`), so **custom roles are an admin UI away**, not a refactor.
- **Evaluation** (in `packages/permissions`): `can(principal, action, resource)` → `{allowed, filter}`. For list endpoints the evaluator returns a **query filter** (e.g. `membership_id = ANY(:teamWorkerIds)`), and repositories apply it. This way the same rule governs single reads, lists, reports, and exports.
- **Defence in depth:** HTTP guard (coarse: is the permission present at all) → service (resource-level check with scope) → DB RLS (tenant only).

### Matrix

Legend: **O** = org-wide, **T** = team-scoped, **A** = assigned projects only, **S** = self only, **P** = policy-dependent (the org can enable/disable), **—** = no access.
Actions: R read, C create, U update, D delete/archive, X special action (named).

| Resource | System Admin | Team Manager | Worker | Agent (device principal) | Client viewer |
|---|---|---|---|---|---|
| Organization settings | R U | R (basic) | R (basic) | — | — |
| Billing plan / subscription | R U (owner only for plan changes) | — | — | — | — |
| Roles & permissions | R C U D | R | — | — | — |
| Members / workers | R C U D (invite, suspend) | R T; U T (limited: schedule, limits if allowed) | R S (+ directory names) | — | — |
| Worker pay rate | R U | R T **P** | R S **P** | — | — |
| Teams | R C U D | R T; U T (membership) **P** | R S | — | — |
| Clients | R C U D | R A | R A (name only) | — | — |
| Projects | R C U D | R T/A; C U **P** | R A | R A (own assignments list) | R (included) |
| Tasks | R C U D | R C U D A | R A; C **P**; U (status of own) | R A (own assignments) | R (if tasks) |
| Tracking policies | R C U D | R T | R S (effective policy) | R S (effective policy) | — |
| Devices | R U (revoke, force re-auth) | R T | R S; X revoke own | R/U self (heartbeat, capabilities) | — |
| Tracking sessions | R O; X force-stop | R T; X force-stop **P** | R S; X start/stop/pause own | C/U S (commands for its bound worker only) | — |
| Activity (minutes/windows) | R O | R T | R S | C S (write-only) | R (if enabled) |
| Idle events | R O; X resolve **P** | R T; X resolve **P** | R S; X resolve own | C S | — |
| Screenshots | R O; D **P** | R T; D **P** | R S **P**; D S **P** | C S (upload intent/confirm only) | R (if enabled) |
| App / URL usage | R O | R T | R S **P** | C S | — |
| Time entries | R U D O | R T; U T **P** | R S; U S **P** (unlocked only) | — (derived server-side) | R (if hours) |
| Manual time | R O; X approve | R T; X approve T | C S; R S | C S (request) | — |
| Timesheets | R O; X approve/reject/reopen | R T; X approve/reject T | R S; X submit own | — | — |
| Attendance | R O | R T | R S | — | — |
| Schedules / shifts | R C U D | R C U D T | R S | R S (today's shift for reminders) | — |
| Time-off policies | R C U D | R | R (applicable) | — | — |
| Time-off requests | R O; X approve | R T; X approve T | C S; R S; X cancel own | — | — |
| Billing rates | R C U D | R T **P** | R S **P** (pay) | — | — |
| Billing entries / amounts owed | R O | R T **P** | R S **P** | — | — |
| Budgets | R C U D | R A/T | — | — | — |
| Expenses | R O; X approve, reimburse | R T; X approve T | C S; R S | — | — |
| Invoices | R C U D; X send/void | — (R A **P**) | — | — | — |
| Payments | R C U | — | R S (own payouts, future) | — | — |
| Reports | R O (all) | R T (scope-filtered; no finance reports unless **P**) | R S (my time, my activity) | — | — |
| Saved/scheduled reports | C U D (own + shared) | C U D own | C U D own | — | — |
| Dashboards | R U own layout; widgets scope O | own layout; widgets scope T | own layout; widgets scope S | — | — |
| Notifications | R U own | R U own | R U own | — | — |
| API keys | R C D | — | — | — | — |
| Webhooks | R C U D | — | — | — | — |
| Audit log | R O | R T (actions on their team) **P** | R S (access log of own screenshots) | — | — |
| Retention / security settings | R U | — | — | — | — |

> **Amended by ADR-121 ([08-decisions.md](08-decisions.md)):** a device may also read back its bound worker's *own* data through `/api/v1/agent/me/*`, with grants narrowed to `own` scope, never screenshots and never other people. The only writes allowed are submitting a timesheet and requesting time off.
>
> **Amended by ADR-128:** Workers reach their "S" rows through the desktop app, not the web. A member whose grants are all own/assigned scope is redirected from the web workspace to `/download`. This is a UX rule; the server still enforces the matrix for every call.
>
> **Amended by ADR-133:** a **Client viewer** is a `client_portal_access` row, never a membership. It sees only the client's own included projects, and only the sections the admin turned on (activity and screenshots require the admin's own grant to already be org-wide). It never sees money, other clients, or anything not listed above. Every read is audited with `actor_type = 'client'`, and workers whose data is shared this way are told, on the web and in the desktop app.

**AGENT constraints (non-negotiable):** the credential is bound to `(organization_id, membership_id, device_id)`. It can read only the bound worker's effective policy and assignments, and it can write only tracking commands and observations for that worker. It has no list endpoints for other workers and cannot read activity back. Revoking the device kills all of its tokens immediately (per-request `devices.status` check, cached 30s in Redis).

## 12. API Architecture

### Conventions
- Base `https://api.<domain>/api/v1`. JSON, `snake_case` fields, RFC3339 UTC timestamps, IDs as UUIDs.
- **Auth:**
  - Web: httpOnly `SameSite=Lax` secure cookie session with CSRF header check.
  - Agent: Bearer device access token plus an Ed25519 request signature header (`X-Device-Signature` over method, path, body hash, and timestamp).
  - Integrations: `Authorization: Bearer tw_live_<prefix>_<secret>`.
- **Tenant:** org resolved from the path `/orgs/{org_id}/…` for user/API-key calls, and from the credential for the agent. It is always cross-checked against the principal's memberships.
- **Pagination:** cursor-based, `?limit=50&cursor=…` → `{ data: [], next_cursor, has_more }`. Max limit 200.
- **Filtering / sorting:** `?filter[status]=active&filter[project_id]=…&sort=-started_at`. The allowed fields are whitelisted per endpoint.
- **Idempotency:** `Idempotency-Key` header on all POSTs that create things. Responses are stored 24h, keyed by (principal, key, body hash).
- **Errors:** RFC 9457 problem details: `{ type, title, status, code, detail, request_id, errors?: [{field, message}] }`.

| Status | When |
|---|---|
| 400 | validation |
| 401 | no or invalid auth |
| 403 | authenticated but not permitted |
| 404 | not found **or not visible** (never reveal cross-tenant existence) |
| 409 | state conflict (live session exists, stale version) |
| 422 | business rule (over limit, locked entry, budget hard cap) |
| 429 | rate limited (with `Retry-After`) |
| 500 | internal (generic message plus `request_id`) |

- **Concurrency:** `ETag`/`If-Match` on mutable resources (timesheets, invoices, policies).
- **Rate limits:** token bucket in Redis per principal and per IP. Defaults: user 600/min, API key 300/min, agent ingest 120 batches/min.

### Initial endpoints (abridged; `{o}` = `/orgs/{org_id}`)

```text
AUTH / IDENTITY
POST   /auth/signup                     POST /auth/login          POST /auth/logout
POST   /auth/refresh                    POST /auth/password/forgot POST /auth/password/reset
POST   /auth/verify-email               POST /auth/verify-email/resend  (always 202; 5/hour)
POST   /auth/mfa/totp/enroll|verify     GET  /me                  GET  /me/organizations
POST   /auth/device/authorize (PKCE start)  POST /auth/device/token
POST   /agent/login  {email, password, mfa_code?, organization_id?, device}  (desktop in-app sign-in)

ORGANIZATIONS & PEOPLE
POST   /orgs                            GET|PATCH {o}
GET|POST {o}/invitations                POST /invitations/{token}/accept
GET|POST {o}/workers                    GET|PATCH|DELETE {o}/workers/{id}
GET    {o}/workers/{id}/effective-policy
GET|POST {o}/teams                      GET|PATCH|DELETE {o}/teams/{id}
PUT|DELETE {o}/teams/{id}/members/{membership_id}
GET|POST {o}/roles                      GET|PATCH|DELETE {o}/roles/{id}   GET /permissions

WORK STRUCTURE
GET|POST {o}/clients        GET|PATCH|DELETE {o}/clients/{id}
GET|POST {o}/projects       GET|PATCH|DELETE {o}/projects/{id}   POST {o}/projects/{id}/archive
PUT|DELETE {o}/projects/{id}/members/{membership_id}
GET|POST {o}/projects/{id}/tasks        GET|PATCH|DELETE {o}/tasks/{id}
GET    {o}/me/assignments               (projects+tasks I can track to)

DEVICES & POLICIES
POST   /agent/register                  (device principal bootstrap)
GET    /agent/bootstrap                 (policy, assignments, server time, min version)
GET    {o}/devices   GET {o}/devices/{id}   POST {o}/devices/{id}/revoke   POST {o}/devices/{id}/reauth
GET|POST {o}/policies  GET|PUT {o}/policies/{scope_type}/{scope_id}
POST   {o}/policies/ack

TRACKING (commands)
POST   {o}/tracking/start   {project_id, task_id?, source, note?}
POST   {o}/tracking/stop    POST {o}/tracking/pause   POST {o}/tracking/resume
POST   {o}/tracking/switch  {task_id}
GET    {o}/tracking/current                       (my live session)
GET    {o}/tracking/live                          (who is working — scoped)
GET    {o}/sessions   GET {o}/sessions/{id}   POST {o}/sessions/{id}/force-stop

INGEST (agent only)
POST   /agent/ingest/batch                        (commands + observations, per-event acks)
POST   /agent/heartbeat
POST   /agent/screenshots/upload-intent  →  { screenshot_id, put_url, headers, expires_at }
POST   /agent/screenshots/{id}/confirm   { sha256, bytes }

ACTIVITY
GET    {o}/activity/blocks?worker_id&date      (10-min blocks + screenshots + flags)
GET    {o}/activity/summary?...                GET {o}/idle-events   POST {o}/idle-events/{id}/resolve
GET    {o}/screenshots?...   GET {o}/screenshots/{id}  (returns signed URL, 5 min TTL)
DELETE {o}/screenshots/{id}?remove_time=true
GET    {o}/apps?group_by=app|worker|project   GET {o}/urls?group_by=domain|worker|project

TIME & TIMESHEETS
GET    {o}/time-entries?worker_id&from&to      PATCH {o}/time-entries/{id}  (reason required)
POST   {o}/time-entries/{id}/split   DELETE {o}/time-entries/{id}
GET    {o}/time-entries/{id}/revisions
GET|POST {o}/manual-time              POST {o}/manual-time/{id}/approve|reject
GET    {o}/timesheets?period&status   GET {o}/timesheets/{id}
POST   {o}/timesheets/{id}/submit|approve|reject|reopen|request-changes
POST   {o}/timesheets/bulk-approve

OPERATIONS
GET    {o}/attendance?date|from&to    GET {o}/attendance/{membership_id}
GET|POST {o}/schedules   GET|PATCH|DELETE {o}/schedules/{id}   GET {o}/shifts?from&to
GET|POST {o}/time-off/policies   GET {o}/time-off/balances?membership_id
GET|POST {o}/time-off/requests   POST {o}/time-off/requests/{id}/approve|reject|cancel
GET|POST {o}/holidays

FINANCE
GET|POST {o}/rates    PATCH|DELETE {o}/rates/{id}
GET    {o}/billing/entries?...   GET {o}/billing/amounts-owed?period
GET|POST {o}/budgets  GET|PATCH|DELETE {o}/budgets/{id}
GET|POST {o}/expenses  POST {o}/expenses/{id}/approve|reject|reimburse
POST   {o}/files/upload-intent  (receipts)
GET|POST {o}/invoices  GET|PATCH {o}/invoices/{id}  POST {o}/invoices/{id}/send|void|pdf
POST   {o}/invoices/preview  (from client+period+filters)
GET|POST {o}/payments  POST {o}/payments/{id}/allocate

INSIGHT
GET    {o}/dashboards/me   PUT {o}/dashboards/me   GET {o}/widgets/{key}?scope&range
GET    {o}/reports                          (catalog, filtered by permission)
POST   {o}/reports/{key}/query              (inline, paginated)
POST   {o}/reports/{key}/export {format}    → report_run
GET    {o}/report-runs/{id}                 GET|POST {o}/saved-reports  … /schedules
GET    {o}/notifications   POST {o}/notifications/read   GET|PUT {o}/notification-preferences
GET    /stream  (SSE: timer, presence, notifications)

PLATFORM
GET|POST {o}/api-keys   DELETE {o}/api-keys/{id}          (secret shown once on POST)
GET|POST {o}/webhooks   PATCH|DELETE {o}/webhooks/{id}   GET {o}/webhooks/{id}/deliveries
POST   {o}/webhooks/{id}/deliveries/{delivery_id}/replay  POST {o}/webhooks/{id}/test
GET    {o}/audit-logs?actor&action&target&from&to
GET|PUT {o}/retention-policies    GET|PUT {o}/security-settings
```

OpenAPI 3.1 is generated from the zod DTOs, the docs are served at `/api/v1/docs`, and `packages/api-client` is generated from them.

## 17. Security Architecture

### Authentication
- Passwords are hashed with **argon2id** (m=64MB, t=3, p=1, tunable) after a breached-password check (k-anonymity HIBP range API, optional per deployment). Minimum length 10, no composition rules.
- **Web sessions:** an opaque session ID (256-bit) in an httpOnly Secure cookie. The server-side session lives in PG with a Redis cache, with idle timeout and absolute lifetime set by org security settings. The session is rotated on login and on privilege change. The user can list and revoke sessions.
- **MFA:** TOTP now (secret encrypted with an app-level KMS data key); recovery codes hashed. WebAuthn later. Orgs can *enforce* MFA for admins or everyone.
- **Brute force:** progressive delay plus lockout per account and per IP. Login responses are generic.
- **Email verification** (as built, ADR-127) is switched on per deployment with `REQUIRE_EMAIL_VERIFICATION=true`. Signup then creates the account and its org but starts no session ("Check your email"). The emailed link (3-day expiry) verifies the address and signs the person in, unless 2FA needs its own step. Login refuses unverified accounts with 403 `email_not_verified`, checked only after a correct password so the response does not reveal which emails exist. `POST /auth/verify-email/resend` always returns 202 and is limited to 5 per hour. Accepting an invitation verifies the new account. Invitation tokens are single-use and hashed, with a 7-day expiry.
- **Email delivery:** Resend or SMTP behind one `Mailer` interface, console in dev (ADR-126).
- SSO (OIDC/SAML) is designed as a pluggable `IdentityProvider` interface (Future).

### Device authentication

> **As built (ADR-129):** the primary sign-in is **email + password in the desktop app** (`POST /agent/login`). The server runs the same checks as web login (lockout, email verification), asks for the 2FA code when the account has one (`mfa_required`), returns the list of organizations when the person must choose (`organization_required`), and then creates the device and issues its tokens. The password is sent once over TLS and **never stored** on the device; the app keeps only the device tokens, with the refresh token encrypted by the OS keychain. The browser PKCE flow below remains as "Sign in with browser instead". This supersedes the original browser-only design, in which the password was only ever typed into the web page.

1. *(Browser alternative)* The agent opens the system browser to `/auth/device/authorize` (PKCE, loopback redirect `http://127.0.0.1:<random>/cb`).
2. The user logs in (MFA applies) and picks the org. The server issues a one-time code.
3. The agent exchanges the code, generates an **Ed25519 keypair** (private key wrapped by safeStorage), and calls `/agent/register` with its public key, platform, and capabilities. The device becomes ACTIVE (or PENDING if the org requires admin approval of new devices).
4. The server issues a short-lived **device access token** (JWT, 10 min, claims: org, membership, device, `aud=agent`, scopes) and a **rotating refresh token**. Refresh tokens belong to a family, and reuse of an old token revokes the whole family and flags the device.
5. Each ingest request is signed with the device key, which blocks replay of stolen bearer tokens from another machine. The timestamp is within ±5 min (after skew correction) and a nonce cache holds 10 min.

### Tenant isolation
- **API:** org in the path is matched against the principal's memberships. API keys and device tokens embed the org.
- **Service:** `TenantContext` (AsyncLocalStorage) is required by every repository method. A lint rule forbids repository calls without context.
- **Database:** every tenant table has RLS `USING (organization_id = current_setting('app.org_id')::uuid)`. The app connects as a non-owner role without `BYPASSRLS`, and each request transaction runs `SET LOCAL app.org_id = …`. Migrations and system jobs use a separate role, and cross-org jobs iterate orgs explicitly.
- **Composite FKs** `(organization_id, id)` prevent cross-tenant references even from buggy code.
- **Object storage** keys are prefixed `org/{org_id}/…`. Presigned URLs are generated only after an authorization check, with short TTLs (PUT 10 min, GET 5 min).
- **Tests:** a generated suite enumerates every endpoint × role × {same org, other org}. The other-org case must always return 404/403, and it runs in CI (see roadmap).

### Authorization
See §11. All checks are server-side. The UI hides what you can't do, but the server never relies on that.

### Electron security
See [04-desktop-agent.md](04-desktop-agent.md#electron-security-checklist).

### API keys
- The format is `tw_live_<8-char prefix>_<32-byte base62 secret>`. Only the prefix plus an **HMAC-SHA256(secret, server pepper)** are stored. The full key is displayed once.
- Keys have mandatory scopes (`read:workers`, `read:projects`, `read:timesheets`, `read:reports`, `read:billing`, `write:projects`, `write:tasks`, …). There is **no wildcard by default**. Scopes are then intersected with the creating admin's own permissions at call time, so a key never exceeds its creator's rights.
- Keys have optional expiry and IP allowlist, record `last_used_at`, get their own per-key rate limits, and can be revoked instantly.

### Webhooks
- Each endpoint has a signing secret (encrypted at rest). Header names keep the technical name Tallywork (`Tallywork-Event`, `Tallywork-Delivery`, ADR-125). Header `Tallywork-Signature: t=<ts>,v1=<HMAC-SHA256(ts.body)>`, with a documented 5-minute tolerance.
- Only HTTPS is allowed. **SSRF protection:** DNS is resolved and private, loopback, link-local, and metadata IP ranges are rejected, both at registration *and* at each delivery (re-resolve). No redirects are followed.
- Retries use exponential backoff with jitter (e.g. 1m, 5m, 30m, 2h, 6h, 12h, 24h). The endpoint is auto-disabled after sustained failure, and the admin is notified. There are delivery logs (status, latency, truncated response), manual replay, and a test ping.
- Payloads carry IDs plus a minimal snapshot, never sensitive media URLs.

### Audit
- `audit_logs` is append-only (the app DB role has only INSERT/SELECT) and partitioned monthly. It records: auth events, role/permission changes, policy changes, time edits, approvals, rate changes, invoice/payment changes, device revocations, API key and webhook lifecycle, retention changes, exports, and **views of screenshots / activity detail** (access logging for monitoring data).
- Each entry records actor, action, target, a redacted before/after diff, IP, user agent, request ID, and correlation ID.

### Retention
- A `retention_policies` row exists per org and data class (screenshots, activity, apps, urls, sessions, timesheets, invoices, audit, location). The org's plan sets the defaults, and **no values are hard-coded in business logic**. Legal minimums (e.g. invoices kept 7 years) are enforced as *lower bounds* in config.
- A nightly job per org and data class deletes in batches (partition drops where the whole partition is expired). S3 objects are deleted via batch delete, and S3 lifecycle rules act as a backstop. The job writes an audit summary.
- Deleting activity data never deletes time entries or approved timesheets. Those have their own class.

### Other controls
- **Secrets** live in a cloud secret manager and are never in the repo. The pino redaction list covers `password`, `token`, `authorization`, `cookie`, `secret`, `api_key`, and `private_key`.
- **Headers:** HSTS, CSP (nonce-based for Next), X-Content-Type-Options, Referrer-Policy, frame-ancestors none.
- **Encryption:** TLS 1.2+ everywhere. At rest: RDS/PG encryption, S3 SSE-KMS, and field-level encryption for TOTP secrets and webhook secrets.
- **Input validation:** zod at every boundary (HTTP, IPC, events, jobs). Output encoding is handled by React. File uploads are content-type sniffed, size-limited, and never served from the app origin.
- **Supply chain:** lockfile, Renovate, `pnpm audit`, SBOM per release, signed containers.
