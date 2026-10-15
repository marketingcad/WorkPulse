# WorkPulse public API

This page is for developers who connect other systems to WorkPulse: payroll, accounting or project tools, and data warehouses. It covers API keys, the endpoints each key can reach, errors and limits, and webhooks.

- **Base URL:** `https://<your-tallywork-host>/api/v1`
- **Format:** JSON in and out. Timestamps are ISO 8601 in UTC. Dates are `YYYY-MM-DD` in the organization's time zone. Durations are whole seconds. Money is an integer number of minor units (cents) plus an ISO currency code.
- **Organization scope:** every endpoint below lives under `/orgs/{orgId}`. A key only works for the organization it was created in. Other organizations return `404`.

## API keys

An admin creates keys in **Developer → API keys**. The full key looks like `tw_live_<prefix>_<secret>`. It is shown **once**, when it is created. WorkPulse stores only a hash of it.

Send the key as a bearer token:

```http
GET /api/v1/orgs/{orgId}/projects
Authorization: Bearer tw_live_ab12cd34_…
```

- **A key acts as the admin who created it, limited to its scopes.** If that admin later loses a permission, their role changes, or they leave the organization, the key loses it too, immediately. A key can never do more than its creator can do right now.
- **Revoking** a key stops it at once (`401`). Keys can also be given an expiry date.
- **Rate limit:** 600 requests per minute per key. Over the limit you get `429` with a `Retry-After` header.

### Scopes and the endpoints they open

A key can reach **only** the endpoints listed for its scopes. Everything else returns `403`, including your own notifications, dashboard, live stream and exports, and any action that tracks or submits time.

| Scope | Endpoints |
|---|---|
| (any key) | `GET /orgs/{orgId}` (organization details) |
| `read:workers` | `GET /workers`, `GET /workers/{id}` |
| `read:teams` | `GET /teams`, `GET /teams/{id}` |
| `read:clients` | `GET /clients`, `GET /clients/{id}` |
| `read:projects` | `GET /projects`, `GET /projects/{id}` |
| `read:tasks` | `GET /tasks`, `GET /tasks/{id}`, `GET /projects/{id}/tasks` |
| `read:timesheets` | `GET /timesheets?membership_id=&date=`, `GET /timesheets/{id}/history` |
| `read:time` | `GET /time-entries?from=&to=`, `GET /time-entries/{id}/revisions`, `GET /sessions`, `GET /sessions/{id}` |
| `read:activity` | `GET /activity/day`, `GET /screenshots`, `GET /apps`, `GET /urls` (and `/spans`), `GET /idle-events` |
| `read:reports` | `GET /reports`, `POST /reports/{key}/query` |
| `read:billing` | `GET /billing/amounts-owed?from=&to=`, `GET /rates`, `GET /budgets` |
| `read:invoices` | `GET /invoices`, `GET /invoices/{id}`, `GET /payments` |
| `write:projects` | `POST /projects`, `PATCH /projects/{id}`, `POST /projects/{id}/archive`, `POST /projects/{id}/restore` |
| `write:tasks` | `POST /projects/{id}/tasks`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}` |
| `write:clients` | `POST /clients`, `PATCH /clients/{id}`, `POST /clients/{id}/archive`, `POST /clients/{id}/restore` |

Data is also limited by what the creator can see. For example, a key made by a team manager returns only that manager's teams.

Date ranges are capped at 400 days.

## Paging long lists

These lists can be paged: `GET /invoices`, `GET /payments`, `GET /expenses`, `GET /time-entries`, `GET /sessions`, `GET /timesheets/approvals`, `GET /manual-time`, `GET /time-off/requests`, `GET /workers`, `GET /devices`, `GET /tasks` and `GET /attendance`. Send `page` (1-based) to get one page:

| Parameter | Meaning |
|---|---|
| `page` | Page number, from 1. Switches the response to the paged shape below. |
| `page_size` | Rows per page, 1–200 (default 50). |
| `q` | Case-insensitive search. Invoices: number or client name. Payments: client, reference, note or the number of an invoice it paid. Expenses: category, description, project, client or member name. Time entries: note, project, task, client or member. Sessions and the approval queue: member (sessions also project). Manual time: reason, note, project, task or member. Time off: member, policy or reason. Members: name, email or title (filter with `view=current|former`, `status`, `role_id`). Devices: device name, platform or member (filter with `membership_id`, `status`). Tasks: title, description or project. Attendance: member name (filter with `status`). |

```json
{ "data": [ … ], "total": 1050, "page": 1, "page_size": 50, "summary": { … } }
```

`total` counts every matching record. Invoices and expenses also return a `summary` over every match, not just the page:
- **Invoices:** `counts` per status, `open_count`, `overdue_count`, and `outstanding_minor`, `overdue_minor` and `collected_minor` in the organization's currency.
- **Expenses:** `counts` per status, and `total_minor` of the matches in the organization's currency.
- **Time entries:** `entries`, `seconds` and `billable_seconds` for the whole range, and `by_day` with the same per day. `order=asc` lists the oldest day first (default newest).
- **Sessions:** `worked_seconds` across every matching session.
- **Devices and tasks:** `counts` per status.
- **Attendance:** `counts` per status and `overtime_seconds` over every row; each row also has the member's `timezone`.

Without `page`, these endpoints return a plain array, as before, with `status` and `q` applied first. That array is capped: invoices, payments and expenses at 1000, time entries at 5000, sessions, approvals, manual time and time off at 500, and tasks at 2000. Members, devices and attendance return every match. Use `page` to reach everything. `GET /audit-logs` pages the same way.

`GET /workers/options` returns every member you may see as a light list for pickers, `[{ id, name, email, role_name, status, title, timezone, tracking_enabled, weekly_expected_seconds }]`, without rates or teams (`include_removed=true` adds former members).

`GET /time-entries/totals` (same filters as `GET /time-entries`) returns hours per member and day, `[{ membership_id, date, seconds, billable_seconds, manual_seconds }]`, summed by the server, so you don't need to load the entries.

## Errors

Errors use RFC 7807 problem JSON:

```json
{ "type": "https://docs.tallywork.app/errors/validation_error", "title": "from: Invalid date", "status": 400, "code": "validation_error", "request_id": "…", "errors": [{ "field": "from", "message": "Invalid date" }] }
```

| Status | Meaning |
|---|---|
| `400` | The input is invalid. `errors[]` names each field. |
| `401` | The key is missing, invalid, expired or revoked. |
| `403` | The key's scopes or its creator's permissions don't allow this. |
| `404` | Not found, or not visible to this key. |
| `409` | The request conflicts with the current state (for example, invoicing the same time twice). |
| `422` | A business rule refused the change. `code` says which rule, for example `timesheet_locked` or `rate_in_use`. |
| `429` | Rate limited. Wait for the number of seconds in `Retry-After`. |

Include `request_id` when you contact support.

## Sign-in endpoints

The web app and the desktop app sign people in with these. They are not under `/orgs/{orgId}` and API keys can't use them. They are listed here because their responses and error codes matter to anyone building a sign-in screen.

| Endpoint | Body | Response |
|---|---|---|
| `POST /auth/signup` | `name`, `email`, `password`, `organization_name?`, `timezone?` | `201` `{ user_id, organization_id }` and a session cookie. With email verification required: `{ …, verification_required: true }` and **no** session; the person must open the emailed link first. |
| `POST /auth/login` | `email`, `password` | The signed-in person, or `{ mfa_required: true }`. `401 invalid_credentials`; `403 email_not_verified` when verification is required and the email isn't confirmed (checked only after a correct password). |
| `POST /auth/verify-email` | `token` | `{ ok: true, signed_in }`. With verification required, opening the link signs the person in (`signed_in: true`), unless the account has 2FA. |
| `POST /auth/verify-email/resend` | `email` | Always `202`, so it doesn't reveal which emails have accounts. Sends a new link only to unverified accounts. 5 per hour. |
| `POST /auth/invitations/accept` | `token`, `name?`, `password?` | `{ organization_id, membership_id, role_key }`. An account created here is already verified. Workers (`role_key: "WORKER"`) are sent to `/download`, because they use the desktop app only. |
| `POST /agent/login` | `email`, `password`, `mfa_code?`, `organization_id?`, `device` | Desktop sign-in. `201` with `device_id`, `organization_id`, `status` and the device's `access_token` / `refresh_token`. `200` `{ organization_required: true, organizations: [{ id, name }] }` when the person is in several organizations: send again with `organization_id`. 20 per 15 minutes. |

`POST /agent/login` runs the same checks as `/auth/login` (lockout, email verification). Its errors:

| Status | `code` | Meaning |
|---|---|---|
| `401` | `invalid_credentials` | Wrong email or password. |
| `401` | `mfa_required` | The account has 2FA. Send again with `mfa_code` (an authenticator code or a recovery code). |
| `403` | `email_not_verified` | The email isn't confirmed yet. |
| `403` | `no_organization` | The account isn't an active member of any organization. |
| `429` | `account_locked` | Too many failed attempts. Try again in a few minutes. |

The password is sent once and never stored by the desktop app. It keeps only the refresh token, encrypted with the OS keychain. The older browser flow (`/device/authorize`, then `POST /agent/authorize` and `POST /agent/register` with PKCE) is still there, as **Sign in with browser instead**.

## Client portal

Read-only dashboards for an organization's clients. None of this is part of the API-key surface above: a client viewer is a `client_portal_access` row, never a membership or an API key, and the admin and worker endpoints below need permissions no key scope grants.

### Client (viewer) endpoints

Not under `/orgs/{orgId}`. A client reaches these after accepting an emailed invitation, identified by the `access_id` the accept response and the dashboard list return, never by organization membership.

| Endpoint | Notes |
|---|---|
| `POST /portal/invitations/accept` | Body `{ token, name?, password? }` → `{ access_id }`. Creates the client's account and signs it in on first acceptance; an already-signed-in client account can accept a further invitation with just the token. `400` invalid body; `422` `invalid_invitation` (unknown, expired, revoked or already-used token — including when the invitation is revoked, re-issued or accepted by someone else while this request runs; no account is left behind in that case), `invitation_email_mismatch` (signed in as a different email than the invitation), `login_required`, or `password_required`. Limited to **20 per hour**. |
| `GET /portal` | The signed-in client's dashboards: one entry per client they have accepted access to, across every organization. |
| `GET /portal/{accessId}/summary` | `?from=&to=`. Hours total, projects, people (with activity level if that section is on), tasks and hour budgets (if that section is on). Never money. `404` if `accessId` is malformed, unknown, revoked, or the client's portal is turned off. |
| `GET /portal/{accessId}/screenshots` | `?from=&to=`. `403` if the screenshots section isn't enabled for this client. Only screenshots captured during desktop-tracked time on the client's included projects, served through the signed media route (never a direct storage URL). |

`GET /portal` and the two `/portal/{accessId}/*` reads are limited to **120 per minute**.

### Admin endpoints (`/orgs/{orgId}`, requires `clients:manage`)

| Endpoint | Notes |
|---|---|
| `GET /clients/{id}/portal` | Current settings: `enabled`, `sections` (`hours`, `tasks`, `activity`, `screenshots`), included project ids (`null` = all, including future ones). |
| `PUT /clients/{id}/portal` | Update settings. Turning on `activity` or `screenshots` requires the admin's own grant for that resource to already be organization-wide; otherwise `403`. While either is on, widening the project scope (adding a project, or `project_ids: null`) needs the same org-wide grants, otherwise `403`; narrowing the scope or turning sections off is always allowed. |
| `POST /clients/{id}/portal/invitations` | Invite a client viewer by email. `201`. `403` while activity or screenshots are on and the admin lacks org-wide `activity:read` / `screenshots:read` for the sections that are on. `409` `portal_viewer_exists` if the email already has access or a pending, unexpired invitation; a revoked or expired one is re-issued (same access id, new token and 7-day link). |
| `DELETE /clients/{id}/portal/access/{accessId}` | Revoke a viewer's access. `204`. `422` `already_revoked` if it already was. Re-inviting the same email is how access is restored; there is no resend. |
| `GET /clients/{id}/portal/preview` | The dashboard exactly as the client would see it — same shape as `GET /portal/{accessId}/summary` — except that `activity` and `screenshots` are masked off unless the admin's own `activity:read` / `screenshots:read` is organization-wide. Writes no client audit row. |
| `GET /clients/{id}/portal/preview/screenshots` | Same, for screenshots. `403` when the section is off or masked for this admin. Audited as the admin (`client_portal.preview_screenshots_viewed`, with `count`, `from`, `to`). |

### Worker endpoint: who can see my data

| Endpoint | Notes |
|---|---|
| `GET /orgs/{orgId}/me/client-visibility` | Web. `{ clients: [{ client_name, activity, screenshots }] }` — every client whose portal can currently see this worker's data (through time on that client's included projects), and whether that includes activity level and/or screenshots. |
| `GET /agent/me/client-visibility` | Desktop, same response shape, for the signed-in worker's device. Used by desktop 0.1.4 and earlier; later versions no longer request it. |

Both apps show this as a notice on "What is monitored" whenever the list isn't empty.

## Webhooks

An admin adds endpoints in **Developer → Webhooks**. Each endpoint chooses which events it receives, or `*` for all of them.

### Events

`worker.created`, `worker.updated`, `project.created`, `project.updated`, `session.started`, `session.stopped`, `timesheet.submitted`, `timesheet.approved`, `timesheet.rejected`, `timesheet.late_time`, `time_off.requested`, `time_off.approved`, `invoice.created`, `invoice.sent`, `invoice.paid`, `payment.received`, `expense.submitted`, `budget.threshold_crossed`, `device.offline`, `device.revoked`. There is also `webhook.test`, sent by the **Send test** button.

### Request

```http
POST https://your-endpoint.example.com/tallywork
Content-Type: application/json
Tallywork-Event: timesheet.approved
Tallywork-Delivery: 01a0d8c6-…            (unique per delivery attempt series; use it to de-duplicate)
Tallywork-Signature: t=1790198400,v1=Qm9…  (see below)

{
  "event_id": "01a0d8c6-…",
  "event_type": "timesheet.approved",
  "organization_id": "…",
  "occurred_at": "2026-09-23T20:00:00.000Z",
  "data": { "timesheet_id": "…", "membership_id": "…", "period_start": "2026-09-14", "period_end": "2026-09-20", "comment": null }
}
```

Header names keep the product's original `Tallywork-` prefix, and requests come with `User-Agent: Tallywork-Webhooks/1.0`.

Reply with any `2xx` status within 10 seconds. WorkPulse never follows redirects.

### Verifying the signature

`Tallywork-Signature` is `t=<unix seconds>,v1=<signature>`. The signature is HMAC-SHA256 of the string `"<t>.<raw request body>"`, keyed with the endpoint's signing secret (`whsec_…`) and encoded as **base64url**.

To verify a request:

1. Compute the signature over the **raw** body, before any JSON parsing.
2. Compare it to `v1` in constant time.
3. Reject timestamps more than 5 minutes old, to block replays.

Node.js example:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTallyworkSignature(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

The API test suite runs this exact function against real deliveries (`packages/api/test/integrations.test.ts`).

**Rotating the secret:** `POST /orgs/{orgId}/webhooks/{id}/rotate-secret` returns a new secret, shown once. The old secret stops working immediately.

### Retries

A delivery that fails (a non-2xx reply, a timeout or a connection error) is retried this long after each failed attempt:

| After attempt | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Wait | 1 min | 5 min | 30 min | 2 h | 6 h | 12 h | 24 h |

After the 8th failed attempt the delivery is marked **dead**. An endpoint that fails 50 times in a row is disabled, and re-enabling it resets the count. Every attempt, with its status code and response time, is listed under the endpoint. **Replay** sends any past delivery again.

Deliveries are at-least-once and can arrive out of order. Use `event_id` to ignore duplicates, and `occurred_at` to order events.

### Allowed endpoint URLs

Endpoint URLs must use `https` and must be publicly reachable. WorkPulse refuses:

- `localhost`, `*.local` and `*.internal` names;
- private, loopback, link-local, CGNAT, multicast and cloud-metadata addresses, including IPv6 forms and IPv4-mapped IPv6;
- URLs with a username or password in them.

The address is checked when the endpoint is saved and **again each time WorkPulse connects**. A hostname that later resolves to a private address (DNS rebinding) is refused at connection time.

## Integrations

**Settings → Integrations** connects WorkPulse to external systems through providers. Connection credentials are encrypted and never returned by the API. Syncs run in the background, hourly or on request (`POST /orgs/{orgId}/integrations/{id}/sync`).

Each connection remembers which external record matches which WorkPulse record, so running a sync again updates records instead of creating duplicates. If a sync fails, the connection is marked `ERROR` and shows the reason.

API keys cannot manage integrations.
