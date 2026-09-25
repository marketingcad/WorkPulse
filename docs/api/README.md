# Tallywork public API

This page is for developers who connect other systems to Tallywork: payroll, accounting or project tools, and data warehouses. It covers API keys, the endpoints each key can reach, errors and limits, and webhooks.

- **Base URL:** `https://<your-tallywork-host>/api/v1`
- **Format:** JSON in and out. Timestamps are ISO 8601 in UTC. Dates are `YYYY-MM-DD` in the organization's time zone. Durations are whole seconds. Money is an integer number of minor units (cents) plus an ISO currency code.
- **Organization scope:** every endpoint below lives under `/orgs/{orgId}`. A key only works for the organization it was created in. Other organizations return `404`.

## API keys

An admin creates keys in **Developer → API keys**. The full key looks like `tw_live_<prefix>_<secret>`. It is shown **once**, when it is created. Tallywork stores only a hash of it.

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

Reply with any `2xx` status within 10 seconds. Tallywork never follows redirects.

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

Endpoint URLs must use `https` and must be publicly reachable. Tallywork refuses:

- `localhost`, `*.local` and `*.internal` names;
- private, loopback, link-local, CGNAT, multicast and cloud-metadata addresses, including IPv6 forms and IPv4-mapped IPv6;
- URLs with a username or password in them.

The address is checked when the endpoint is saved and **again each time Tallywork connects**. A hostname that later resolves to a private address (DNS rebinding) is refused at connection time.

## Integrations

**Settings → Integrations** connects Tallywork to external systems through providers. Connection credentials are encrypted and never returned by the API. Syncs run in the background, hourly or on request (`POST /orgs/{orgId}/integrations/{id}/sync`).

Each connection remembers which external record matches which Tallywork record, so running a sync again updates records instead of creating duplicates. If a sync fails, the connection is marked `ERROR` and shows the reason.

API keys cannot manage integrations.
