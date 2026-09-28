# Architecture: Platform, Stack, Monorepo, Events, Reporting

## 3. Product Architecture

```text
                          ┌──────────────────────────────┐
                          │          Clients             │
   ┌──────────────┐       │  ┌────────┐  ┌────────────┐  │     ┌──────────────┐
   │ Browser ext. │──NM──▶│  │Electron│  │ Next.js web│  │     │ 3rd-party via│
   │ (URL, opt.)  │       │  │ agent  │  │ (browser)  │  │     │ API key      │
   └──────────────┘       │  └───┬────┘  └─────┬──────┘  │     └──────┬───────┘
                          └──────┼─────────────┼─────────┘            │
                                 │ HTTPS       │ HTTPS (cookie)       │ HTTPS (Bearer key)
                                 ▼             ▼                      ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │  Edge: TLS, WAF, rate limits (per IP / key / device)     │
                     └──────────────────────────┬──────────────────────────────┘
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ apps/api  (NestJS modular monolith, stateless, horizontally scaled)                 │
│                                                                                     │
│  HTTP layer: /api/v1 controllers · auth guards · zod validation · idempotency       │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│  Domain modules (each: controller → service → repository; public interface only):   │
│   identity · orgs · members/workers · teams · clients · projects · tasks · devices  │
│   policies · tracking · activity · screenshots · apps-urls · timesheets · attendance │
│   schedules · time-off · rates · billing · budgets · expenses · invoices · payments │
│   reports · dashboards · notifications · api-keys · webhooks · audit · retention    │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│  Cross-cutting: TenantContext (AsyncLocalStorage) · PolicyEngine · Outbox writer     │
└──────────┬─────────────────────┬─────────────────────────┬─────────────────────────┘
           │ SQL (RLS)           │ enqueue / pub-sub        │ presign
           ▼                     ▼                          ▼
   ┌───────────────┐     ┌───────────────┐          ┌────────────────┐
   │ PostgreSQL 17 │     │    Redis 7    │          │ S3-compatible  │
   │  OLTP + roll- │◀───▶│ BullMQ queues │          │ screenshots,   │
   │  ups, outbox, │     │ rate limits,  │          │ receipts, PDFs,│
   │  partitions   │     │ SSE fan-out,  │          │ exports        │
   └───────┬───────┘     │ presence      │          └───────▲────────┘
           │             └──────┬────────┘                  │
           │                    ▼                           │
           │   ┌──────────────────────────────────────────┐ │
           └──▶│ apps/worker (same codebase, BullMQ procs)│─┘
               │  outbox relay · event projectors (rollups)│
               │  thumbnails/blur verify · report exports  │
               │  PDF (invoices) · email · webhooks deliv. │
               │  schedulers: stale sessions, attendance,  │
               │  shift alerts, retention cleanup, digests │
               └──────────────────────────────────────────┘
```

**Why this shape.** A single deployable is simpler to operate and reason about. Splitting **API** from **worker** processes lets bursty background work (screenshot processing, exports, webhooks) scale independently without harming API latency. Module boundaries (enforced by `eslint-plugin-boundaries` / dependency-cruiser) let high-volume ingestion (`tracking`/`activity`) be extracted into its own service later.

**Real-time.** Server-Sent Events via `GET /api/v1/stream`, fanned out through Redis pub/sub. They push timer state (web ↔ desktop sync), presence ("who's working"), and notifications. SSE is chosen over WebSockets because the traffic is one-way, and SSE works through proxies and HTTP/2.

**Who uses which client (as built, ADR-128).** Workers use the Electron app only; the web workspace (`/o/*`) is for admins and managers, and members with only own/assigned grants are sent to `/download`. Signed-out pages (login, signup, invitation, verify email, download) are public web pages.

**Presence.** The agent sends a heartbeat every 60s while a session is active. Redis holds `presence:{org}:{worker}` with a TTL, which gives the manager dashboard its live "working / idle / offline" state without querying the database.

## 4. Technology Stack

| Layer | Choice | Why | Notes |
|---|---|---|---|
| Language | **TypeScript (strict)** everywhere | One language across web, API, agent, and shared packages. Shared types and zod schemas give end-to-end type safety for the event contract. | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Web | **Next.js (App Router) + React** | Server components for data-heavy pages (reports, tables) cut client JS; built-in routing/layouts fit the app shell; mature ecosystem | The web app is a *client* of the API. No business logic in Next route handlers, except a thin BFF for cookie/session handling. |
| UI kit | Tailwind CSS + **Radix UI primitives** (own styled components in `packages/ui`), TanStack Table, TanStack Query, **visx** for charts | Radix gives accessible behaviour (focus, ARIA) with *no* imposed visual style, so the design stays original. visx gives precise, accessible, non-generic charts. | No off-the-shelf themed dashboard kit |
| API | **NestJS** | Opinionated modules, DI, and guards map directly onto a modular monolith with RBAC. Strong testing story. | Fastify adapter for throughput |
| ORM / SQL | **Drizzle ORM + drizzle-kit migrations** | SQL-first: easy use of RLS session variables, partitioned tables, `ON CONFLICT` upserts, and CTEs for reporting. Typed schema shared via `packages/database`. | Raw SQL migrations for partitions/RLS/policies |
| Database | **PostgreSQL 17** | Transactional integrity for time/money; RLS for tenant isolation; declarative partitioning for high-volume activity tables; JSONB for policy docs; materialized views | TimescaleDB is an optional future path for activity |
| Queue / cache | **Redis 7 + BullMQ** | Reliable jobs (retries, backoff, delayed/repeatable jobs) for projectors, exports, and webhooks. Also rate limiting, presence, and SSE fan-out. | The durable source for events is the Postgres **outbox**. Redis is transport, not truth. |
| Object storage | **S3-compatible** (AWS S3 / R2 / MinIO in dev) | Cheap, durable blobs; presigned direct uploads keep screenshots off the API; lifecycle rules help retention | SSE-S3/KMS encryption at rest |
| Desktop | **Electron + TypeScript** (electron-vite, electron-builder, electron-updater) | Required by the brief. Cross-platform, and shares React UI and TS packages with the web. | Native addons: `uiohook-napi` (input *counts*), `get-windows` (active window), `better-sqlite3-multiple-ciphers` (encrypted queue). As built: the queue is an AES-256-GCM encrypted file, and installers plus the update feed are published to GitHub Releases (`marketingcad/tallywork-desktop`) by the "Desktop release" workflow (ADR-131) |
| API style | **REST /api/v1** + OpenAPI 3.1 generated from zod | Predictable for public API consumers; generated typed client for web/agent | Cursor pagination |
| Email | `Mailer` provider abstraction (`packages/api/src/lib/mailer.ts`): **Resend** (`RESEND_API_KEY`) or **SMTP** via nodemailer (`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`, e.g. Gmail with an app password), otherwise a console mailer in dev and tests. Plain-text messages with optional HTML, sender `MAIL_FROM` (ADR-126) | Deliverability; one interface for every sender; templates in code | Postmark or SES can be added behind the same interface |
| PDF | `@react-pdf/renderer` in worker | Pure Node, no headless browser, deterministic invoice layout | Reports-as-PDF use the same engine |
| XLSX | `exceljs` streaming writer | Large exports without memory blowups | — |
| Observability | OpenTelemetry (traces/metrics) → OTLP; pino JSON logs; Sentry (web, API, Electron crash reports) | Vendor-neutral; correlation IDs flow across agent → API → worker | — |
| Monorepo | **pnpm workspaces + Turborepo** | Fast installs, strict dependency isolation, cached task graph | — |
| Testing | Vitest (unit), Supertest + Testcontainers (integration with real Postgres/Redis/MinIO), Playwright (web E2E + Electron E2E), axe-core (a11y) | Real infrastructure in integration tests catches RLS and SQL issues that mocks hide | — |
| Infra | Docker; Terraform; dev via `docker compose` (postgres, redis, minio, mailpit) | Reproducible environments | Deploy target: AWS ECS Fargate or Kubernetes (ADR-015) |

## 5. Monorepo

```text
tallywork/
├── apps/
│   ├── web/                        # Next.js App Router
│   │   ├── app/
│   │   │   ├── (auth)/             # login, signup, invite, reset, mfa
│   │   │   ├── (app)/[orgSlug]/    # authenticated shell
│   │   │   │   ├── overview/       # dashboards
│   │   │   │   ├── workspace/      # workers, teams, clients, projects, tasks
│   │   │   │   ├── tracking/       # sessions, activity (screenshots|apps|urls), devices, locations
│   │   │   │   ├── timesheets/     # view-edit, approvals, manual-time
│   │   │   │   ├── attendance/     # attendance, schedules, time-off
│   │   │   │   ├── finance/        # billing, expenses, invoices, payments, budgets
│   │   │   │   ├── reports/[reportKey]/
│   │   │   │   ├── developer/      # api-keys, webhooks, docs
│   │   │   │   └── settings/       # org, policies, roles, notifications, security, retention, integrations
│   │   │   └── api/session/        # thin BFF: cookie refresh only
│   │   ├── features/               # feature-sliced UI: <feature>/{components,hooks,queries}
│   │   └── lib/                    # api client wiring, auth, formatting
│   ├── api/                        # NestJS modular monolith (HTTP)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── common/             # guards, interceptors, filters, tenant context, idempotency
│   │       └── modules/
│   │           ├── identity/ orgs/ members/ teams/ clients/ projects/ tasks/ devices/ policies/
│   │           ├── tracking/ ingest/ activity/ screenshots/ apps-urls/ presence/
│   │           ├── timesheets/ manual-time/ approvals/
│   │           ├── attendance/ schedules/ time-off/
│   │           ├── rates/ billing/ budgets/ expenses/ invoices/ payments/
│   │           ├── dashboards/ reports/ notifications/ stream/
│   │           ├── api-keys/ webhooks/ integrations/
│   │           └── audit/ retention/ security-settings/
│   ├── worker/                     # BullMQ processors + schedulers (imports domain services from api via packages)
│   ├── desktop/                    # Electron agent
│   │   ├── src/main/               # services (see 04-desktop-agent.md)
│   │   ├── src/preload/            # contextBridge API
│   │   ├── src/renderer/           # React UI (uses packages/ui)
│   │   ├── native/                 # platform helpers (macOS permissions, Win UIA fallback)
│   │   └── electron-builder.yml
│   └── browser-extension/          # MV3 extension (URL reporting via Native Messaging)
│
├── packages/
│   ├── domain/                     # PURE business logic: state machine, time math, activity calc,
│   │                               #   idle rules, billing calc, budget projection, accruals, overtime
│   ├── ui/                         # design system components + tokens (web + desktop renderer)
│   ├── database/                   # drizzle schema, migrations (sql), RLS policies, seed
│   ├── types/                      # shared TS types (IDs as branded types, enums)
│   ├── validation/                 # zod schemas: API DTOs, IPC payloads, event payloads
│   ├── events/                     # event catalog: names, versions, payload schemas, upcasters
│   ├── permissions/                # permission catalog, role presets, policy evaluator (scope logic)
│   ├── auth/                       # token formats, hashing helpers, device-auth protocol
│   ├── api-client/                 # generated OpenAPI client (web, desktop, tests)
│   ├── storage/                    # S3 abstraction: keys, presign, lifecycle helpers
│   ├── billing/                    # money type, rate resolution, invoice totals, payment provider iface
│   ├── reporting/                  # report definitions (filters, groupings, columns), query builders
│   ├── logging/                    # pino config, redaction list, OTel setup
│   ├── config/                     # typed env loading (zod), feature flags
│   └── tsconfig/ eslint-config/    # shared tooling config
│
├── infrastructure/
│   ├── docker/                     # compose for dev: postgres, redis, minio, mailpit, otel-collector
│   ├── terraform/                  # cloud resources
│   └── k8s|ecs/                    # deploy manifests
├── docs/                           # living docs (architecture.md, database.md, ... per brief §77)
│   └── plan/                       # this plan
├── .github/workflows/              # CI: lint, typecheck, test, build, e2e, electron matrix build
├── turbo.json  pnpm-workspace.yaml  package.json
```

**Deviations from the brief's suggested tree, and why:**
- **Added `packages/domain`**. This enforces rule §78 (core logic outside React/controllers). It has zero framework dependencies and is shared by API, worker, and agent (the agent reuses the activity/idle math).
- **Added `apps/worker`**. Background processing gets its own scaling unit.
- **Added `apps/browser-extension`**. This closes gap G5 (reliable URL tracking).
- **Added `packages/api-client`**. It is generated, so it never drifts from the API.

## 10. Event Architecture

### Flow

```text
Electron agent                    Web timer
  │ commands + observations         │ commands
  │ (batched, idempotent, signed)   │
  ▼                                 ▼
POST /api/v1/ingest/batch      POST /api/v1/tracking/*
  │                                 │
  ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ Ingest / Tracking service  (synchronous, in one DB tx)        │
│ 1. authenticate device/user, resolve org+worker               │
│ 2. validate against packages/events schema+version            │
│ 3. dedupe: INSERT ingest_receipts(device_id, client_event_id) │
│      ON CONFLICT DO NOTHING → duplicate = ack w/o reprocess   │
│ 4. clock correction: occurred_at = device_ts + skew_offset    │
│ 5. apply command via state machine (sessions) OR              │
│    persist raw observation (activity minute, app span, ...)   │
│ 6. write domain event(s) to OUTBOX (same tx)                  │
│ 7. return per-event ack {id, status: accepted|duplicate|      │
│    rejected(reason)} + server_time + current session state    │
└──────────────────────────────┬───────────────────────────────┘
                               │  outbox rows
                               ▼
                    Outbox relay (worker, polls with
                    FOR UPDATE SKIP LOCKED / LISTEN-NOTIFY)
                               │ publish
                               ▼
                    Redis / BullMQ topic queues
       ┌───────────────┬────────┼─────────┬───────────────┬─────────────┐
       ▼               ▼        ▼         ▼               ▼             ▼
  Rollup          Time-entry  Notif-   Webhook        Presence/SSE   Audit
  projector       deriver     ications dispatcher     broadcaster    projector
  (daily/hourly   (segments → (in-app/ (signed, retry,
  totals, app/url  time entries email)  backoff, logs)
  aggregates,     + revisions)
  budget burn)
       │               │
       ▼               ▼
  Postgres rollup  Postgres OLTP ───▶ Reports / Dashboards read rollups
  tables / MVs
```

Screenshots take a side path: the agent asks for `POST /screenshots/upload-intent` and gets a presigned PUT plus a `screenshot_id`. It uploads directly to S3, then sends a `screenshot.captured` observation with the checksum. A worker verifies the object and generates thumbnails; failures go to a dead-letter queue (DLQ) for review.

### Commands (client → server; may be rejected)

`START_TRACKING`, `STOP_TRACKING`, `PAUSE_TRACKING`, `RESUME_TRACKING`, `SWITCH_TASK`, `SUBMIT_ACTIVITY` (batch of minute buckets), `SUBMIT_APP_USAGE`, `SUBMIT_URL_USAGE`, `REPORT_IDLE` (idle started/ended + user resolution), `UPLOAD_SCREENSHOT` (intent + confirm), `HEARTBEAT`, `REQUEST_MANUAL_TIME`.

### Domain events (server-emitted facts, immutable)

```text
session.started  session.paused  session.resumed  session.stopped  session.interrupted
session.task_switched  session.superseded
activity.window.created            (10-min block finalized)
idle.started  idle.ended  idle.resolved (kept|discarded|reassigned)
screenshot.captured  screenshot.deleted
application.started  application.ended    (materialized as spans)
website.started  website.ended
time_entry.created  time_entry.revised  time_entry.deleted
manual_time.requested  manual_time.approved  manual_time.rejected
timesheet.submitted  timesheet.approved  timesheet.rejected  timesheet.reopened
attendance.late  attendance.absent  attendance.overtime
time_off.requested  time_off.approved  time_off.rejected
budget.threshold_crossed  (warning|exceeded)
expense.submitted  expense.approved
invoice.created  invoice.sent  invoice.paid  invoice.overdue
payment.received
device.registered  device.offline  device.revoked
policy.changed
worker.created  worker.updated  project.created  project.updated
```

### Envelope (all events)

```ts
interface EventEnvelope<T> {
  event_id: string;          // UUIDv7 (time-ordered); client-generated for agent events
  event_type: string;        // e.g. "session.started"
  event_version: number;     // schema version; upcasters migrate old versions
  organization_id: string;
  worker_id: string | null;  // null for org-level events
  device_id?: string;
  session_id?: string;
  occurred_at: string;       // RFC3339 UTC, clock-corrected
  device_occurred_at?: string;
  received_at: string;       // server
  correlation_id: string;    // traces a chain of events
  causation_id?: string;     // event that caused this
  actor: { type: 'user'|'agent'|'system'|'api_key'; id: string };
  payload: T;
}
```

### Guarantees
- **Exactly-once effect** comes from at-least-once delivery combined with idempotent handlers. Every projector upserts, keyed by natural keys or `event_id`, and records processed IDs where upsert alone is not enough.
- **Ordering.** Per-session ordering uses `(session_id, seq)`. The agent assigns a monotonic `seq` per session, and the server rejects or holds out-of-order state commands. Observations are commutative, so their order does not matter.
- **Schema evolution.** Events are versioned; upcasters in `packages/events` handle old versions. Old agents keep working until their minimum-supported version is retired.

## 16. Reporting Architecture

### Principle
Transactional tables stay normalized and are written by the domain. Reports and dashboards read **rollups** that projectors maintain incrementally, plus a **nightly reconciliation** that recomputes the last N days from source. This covers late or offline events and edits.

### Layers

```text
L0  Raw observations (partitioned monthly by occurred_at):
    activity_minutes, app_spans, url_spans, screenshots, idle_events
L1  Canonical facts: time_entries (+revisions), timesheets, attendance_days,
    expenses, invoices, payments, time_off_requests
L2  Rollups (projector-maintained, UPSERT):
    rollup_worker_day        (org, worker, local_date, project, task, billable,
                              source, tracked_s, active_s, idle_s, manual_s,
                              keyboard_events, mouse_events, cost_minor, bill_minor)
    rollup_worker_hour       (for timelines/heat)
    rollup_activity_block    (10-min blocks: activity %, kb/mouse split, screenshot count)
    rollup_app_day / rollup_url_day (org, worker, local_date, project, app|domain, seconds)
    rollup_project_budget    (spent hours/money to date, projected end)
L3  Materialized views for heavy org-wide aggregates (refreshed CONCURRENTLY on schedule)
```

**Local date.** Rollups key on the worker's **local date** (the timezone captured on the time entry). "Monday" then means Monday for that worker, which matches timesheets and attendance.

### Report engine
- Each report is a **declarative definition** in `packages/reporting`: `{ key, title, question, requiredPermission, source (rollup table), filters[], groupings[], measures[], defaultChart, columns[] }`.
- A query builder compiles the definition plus user filters into parameterized SQL. The org predicate is always injected and RLS still applies. The builder enforces the date-range cap and the maximum number of group-bys.
- **Scope injection.** The builder adds a filter `worker_id IN (team scope)` for managers and `worker_id = me` for workers. The permission evaluator produces this filter (see §11).
- **Sync vs async.** If the estimated row count stays under a threshold, the report renders inline with cursor pagination. Exports and big ranges create a `report_runs` job. The worker streams the output to S3 as CSV, XLSX, or PDF, and the user gets a notification with a signed download link (24h TTL).
- **Saved reports** store a definition key, filters, groupings, and columns. **Scheduled reports** add a cron expression, timezone, and recipients (internal users only; no external emails by default).
- **Payroll export** is a report definition over approved timesheets, pay rates, overtime rules, and time off. It is also exposed as `GET /reports/payroll` for integrations.

### Performance plan
- Start with L0–L2 and indexes, and measure. Introduce L3 matviews only for queries that exceed their p95 budget (dashboard < 300ms, inline report < 1.5s).
- Partition pruning comes from always filtering by time range. BRIN indexes on `occurred_at` in the L0 partitions.
