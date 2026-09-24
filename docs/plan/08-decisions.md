# 20. Architecture Decisions

Each ADR records **Decision · Reason · Alternatives · Trade-offs**. Status: *Proposed* until you approve the plan.

| # | Decision | Reason | Alternatives considered | Trade-offs |
|---|---|---|---|---|
| ADR-001 | **Modular monolith** (NestJS) + separate **worker** processes from the same codebase | Fastest path to a coherent product; one transaction boundary for time and money; easy refactors while the domain is still being learned | Microservices from day one; serverless functions | Needs boundary discipline (lint-enforced). Extracting ingestion later is a planned, not a free, effort. |
| ADR-002 | **pnpm + Turborepo monorepo** | Shared types/schemas across web, API, agent, and extension; atomic changes to contracts | Nx; separate repos | Turborepo is lighter than Nx but has fewer generators. One repo means CI must be cached well. |
| ADR-003 | **Next.js App Router** for web, as an API *client* (no domain logic in Next) | Server components for data-dense pages; a mature routing/layout model | Vite SPA (React Router); Remix | Server components add mental overhead. Keeping logic in the API avoids a second backend. |
| ADR-004 | **NestJS on the Fastify adapter** | DI, modules, and guards map onto RBAC and modules; throughput from Fastify | Express; Hono; tRPC-only | Nest's decorators are verbose. Fastify has some plugin-ecosystem differences. |
| ADR-005 | **PostgreSQL 17 as the single transactional source of truth** | ACID for time/money; RLS; partitioning; JSONB; rich SQL for reporting | MySQL; MongoDB; a separate time-series DB for activity | Activity volume needs partitioning discipline. Timescale remains an option. |
| ADR-006 | **Drizzle ORM** with SQL migrations | SQL-first control for RLS `SET LOCAL`, partitions, exclusion constraints, `ON CONFLICT`; types shared with other packages | Prisma; Kysely; TypeORM | Smaller ecosystem than Prisma. Complex migrations are hand-written SQL, which is a deliberate choice. |
| ADR-007 | **Tenant isolation = app-level scoping + PostgreSQL RLS + composite FKs** | Defence in depth: one missed filter cannot leak data | Schema-per-tenant; DB-per-tenant; app-only filtering | RLS adds per-transaction `SET LOCAL` and pooler constraints (transaction mode). Schema-per-tenant was rejected because of migration cost at thousands of orgs. |
| ADR-008 | **Transactional outbox → BullMQ (Redis)** for async processing | Events are never lost when Redis blips; handlers are idempotent | Kafka/Redpanda; RabbitMQ; PG-only queue (pg-boss) | Redis is not the durable log. Replaying from the outbox is possible. Kafka is overkill at launch; the move is documented if throughput demands it. |
| ADR-009 | **Server-authoritative session state machine**; clients send commands and observations | Prevents client tampering and clock skew from corrupting time; one source of truth | Client-authoritative timers that sync totals | Needs careful offline reconciliation logic (seq, skew, bounded offline window). |
| ADR-010 | **Append-only time revisions + approval snapshots** | Auditability; "never silently rewrite history"; billing reproducibility | Mutable rows plus an audit table only | More storage and query complexity. Views expose the "current" revision. |
| ADR-011 | **Screenshots direct-to-S3 via presigned PUT**, metadata in PG | Keeps large binaries off the API and the DB; scales cheaply | Upload through the API; store in PG bytea | Needs a confirm step plus orphan cleanup (lifecycle rule on an unconfirmed prefix). |
| ADR-012 | **Privacy at source**: count-only input capture, blur before upload, domain truncation on device | Data that is never collected cannot leak; builds worker trust; eases compliance | Collect everything, filter server-side | Blurred screenshots can't be "un-blurred" for an investigation, which is intentional. |
| ADR-013 | **Electron** (required) with sandboxed renderer, typed zod-validated IPC, Fuses, signed updates | Brief requirement; shared TS/React; mature updater | Tauri (excluded by the brief); native per OS | Larger binary and memory footprint (~150MB RAM). Mitigated by lean renderer and lazy windows. |
| ADR-014 | **Browser extension + Native Messaging** for URL tracking | The only reliable cross-browser, cross-OS way to get the active tab URL/domain | Window-title parsing; OS accessibility APIs | Extension install friction (managed install via policy for orgs). Fallback heuristics remain. |
| ADR-015 | **Containers on AWS (ECS Fargate) + RDS PostgreSQL + ElastiCache + S3**, Terraform | Managed services cut operational load; S3-compatible storage keeps portability | Kubernetes (EKS); PaaS (Render/Fly); Vercel for web + separate API host | ECS is less portable than k8s. The web app may still go on Vercel (decide in Phase 2). |
| ADR-016 | **REST + OpenAPI generated from zod**; cursor pagination; RFC 9457 errors | Predictable public API; one schema source for validation, docs, and clients | GraphQL; tRPC | Less flexible querying than GraphQL. The report engine covers ad-hoc analytics. |
| ADR-017 | **Rollup tables maintained by projectors + nightly reconciliation**; matviews only where measured | Fast dashboards without an OLAP stack; correct under late/offline events | On-the-fly aggregation; ClickHouse/warehouse | Two representations must agree, so a drift metric and reconciliation job are required. Add a warehouse later if analytical load grows. |
| ADR-018 | **Money as integer minor units + ISO currency**; effective-dated rates; price snapshot at approval | Avoids float errors; reproducible invoices | Decimal numerics everywhere | Needs conversion helpers. Multi-currency FX is out of scope for v1 (one currency per invoice). |
| ADR-019 | **Roles as data (permission grants with scopes)**; the four built-in roles are presets | Custom roles later without a refactor; one evaluator serves reads, lists, reports, and widgets | Hard-coded role checks; external policy engine (OPA/Cedar) | We maintain our own evaluator. It can be swapped for Cedar later if rules grow complex. |
| ADR-020 | **SSE** for real-time (timer sync, presence, notifications) via Redis pub/sub | One-way push is all that's needed; works over HTTP/2 and proxies | WebSockets; polling | Separate endpoints are needed if bidirectional features arrive later. |
| ADR-021 | **Radix primitives + own styled components + visx charts** | Accessibility without importing someone else's visual identity; original design | shadcn/ui as-is; MUI; Ant Design; Recharts | More styling work up front, in exchange for a distinct, non-template look. |
| ADR-022 | **UUIDv7 IDs** (client-generated for agent events) | Time-ordered (index-friendly), globally unique offline, safe to expose | bigserial; UUIDv4; ULID | 16-byte keys. Acceptable. |

## Revision 1 — Vercel-only hosting (2026-09-25, approved by product owner)

Hosting is **Vercel only**. The ADRs below supersede the ones listed. Everything else stands.

| # | Supersedes | Decision | Reason | Trade-offs |
|---|---|---|---|---|
| ADR-101 | 001, 004 | The backend is a framework-agnostic **Hono** app (`packages/api`) mounted inside the Next.js app at `/api/v1/*`, running on Vercel Functions (Fluid Compute, Node 24). Domain modules keep their boundaries as folders under `packages/api/src/modules`. | One deployment and one origin (no CORS, simple cookies). Hono is tiny and cold-starts fast, and `@hono/zod-openapi` generates the OpenAPI doc. Nest's DI bootstrap is heavier on serverless. | The API is tied to the web deployment. It can be extracted into its own Vercel project later without code changes, because Hono is portable. |
| ADR-102 | 003 | `apps/web` = Next.js 16 UI **and** API host. UI pages call `/api/v1` through TanStack Query. No business logic lives in React. | Same as ADR-003, plus the single deployment | — |
| ADR-103 | 005, 015 | **Neon Postgres via Vercel Marketplace**, connected with `pg` Pool + `attachDatabasePool` (Fluid). Tests and zero-setup local dev use **PGlite** (real Postgres in WASM). | Vercel-managed provisioning and env vars. PGlite gives real-Postgres tests without Docker. | Two drivers behind one Drizzle `PgDatabase` type. Both are covered by the same migration set. |
| ADR-104 | 007 | RLS uses **FORCE ROW LEVEL SECURITY** with policy `organization_id = current_setting('app.org_id')`. System jobs set `app.bypass_rls='on'`, only via `systemTx()`. | On Neon the app role owns the tables, so FORCE is needed for RLS to apply. RLS is a backstop against missing filters. | It is not a defence against SQL injection by the owner role (parameterized queries cover that). |
| ADR-105 | 008 | **Outbox + `after()` dispatch + Vercel Cron backstop** (every minute) replaces BullMQ. Long jobs (exports, PDFs) run in cron-driven batches, with **Vercel Queues** / Workflow as the upgrade path. | No always-on worker exists on Vercel. `after()` gives near-real-time processing, and cron guarantees progress. | Throughput is bounded per cron tick. Measure in Phase 14. |
| ADR-106 | 011 | **Vercel Blob (private)** for screenshots, receipts, exports. The agent uploads with short-lived client tokens scoped to a single pathname. Reads are streamed through an authorized API route (the "signed URL" is our route plus a short-lived HMAC token). | First-party storage and private access | Egress passes through functions for private reads. Thumbnails keep this small. |
| ADR-107 | 020 | Real-time v1 = **short polling** (5–15s, TanStack Query). SSE/WebSockets come later (Vercel Functions support both). | Simplest correct behaviour. Presence data is small. | Up to 15s latency for "who's working" in v1 |
| ADR-108 | Redis usage | **Upstash Redis (Marketplace)** is optional: rate limiting and presence cache. The in-memory/DB fallback keeps dev and tests dependency-free. | — | — |
| ADR-109 | 022 | IDs are UUIDv7 generated in app code (`uuidv7` lib), so offline agent IDs and server IDs share one format | — | — |

## Open questions

These have sensible defaults, listed here, and I'll proceed with the defaults unless told otherwise.

1. **Product name / brand.** Default: working name "Tallywork" until you choose one.
2. **Hosting target.** ✅ Resolved: Vercel only (see Revision 1).
3. **Deployment model.** Default: multi-tenant SaaS only. Is self-hosting or on-prem ever required? (It would affect licensing, updater, and storage choices.)
4. **Primary market / compliance.** Default: US + EU. GDPR controls are in scope; SOC 2 readiness is targeted for Phase 14. HIPAA is out of scope.
5. **Worker payouts.** Default: Future (payroll-ready export only in v1).
6. **Linux Wayland.** Default: supported in degraded mode (timer and idle only) with clear capability flags.
7. **Customer subscription billing (G1).** Default: Stripe Billing, Phase 12.
