# Tallywork — Greenfield Architecture & Product Plan

> **Status:** Phase 0/1 planning. No application code exists yet.
> **Working name:** "Tallywork" is a placeholder product name. Replace it globally before any branding work.
> **Date:** 2026-09-25

This plan answers the 20 required sections of the master brief. It is split by concern so each part can later become the living `/docs/*.md` file the brief asks for.

| # | Section | File |
|---|---------|------|
| 1 | Product Feature Map | [01-product.md](01-product.md#1-product-feature-map) |
| 2 | Feature Comparison Matrix | [01-product.md](01-product.md#2-feature-comparison-matrix) |
| 3 | Product Architecture | [02-architecture.md](02-architecture.md#3-product-architecture) |
| 4 | Technology Stack | [02-architecture.md](02-architecture.md#4-technology-stack) |
| 5 | Monorepo | [02-architecture.md](02-architecture.md#5-monorepo) |
| 6 | Database ERD | [03-data-model.md](03-data-model.md#6-database-erd) |
| 7 | Domain Model | [03-data-model.md](03-data-model.md#7-domain-model) |
| 8 | Tracking State Machine | [03-data-model.md](03-data-model.md#8-tracking-session-state-machine) |
| 9 | Electron Architecture | [04-desktop-agent.md](04-desktop-agent.md) |
| 10 | Event Architecture | [02-architecture.md](02-architecture.md#10-event-architecture) |
| 11 | Authorization Matrix | [05-security-api.md](05-security-api.md#11-authorization-matrix) |
| 12 | API Architecture | [05-security-api.md](05-security-api.md#12-api-architecture) |
| 13 | Design System | [06-design-ux.md](06-design-ux.md#13-design-system) |
| 14 | Parity UX Map | [01-product.md](01-product.md#14-parity-ux-map) |
| 15 | Dashboard Architecture | [06-design-ux.md](06-design-ux.md#15-dashboard-architecture) |
| 16 | Reporting Architecture | [02-architecture.md](02-architecture.md#16-reporting-architecture) |
| 17 | Security Architecture | [05-security-api.md](05-security-api.md#17-security-architecture) |
| 18 | Development Roadmap | [07-roadmap.md](07-roadmap.md) |
| 19 | Feature Gap Analysis | [01-product.md](01-product.md#19-feature-gap-analysis) |
| 20 | Architecture Decisions | [08-decisions.md](08-decisions.md) |

## Five decisions that shape everything else

1. **Modular monolith.** One NestJS API process, plus separately deployed *worker* processes built from the same codebase. Module boundaries are enforced by lint rules. Nothing is split into microservices until measurements show it is needed.
2. **The server owns time.** The desktop agent and web timer send *commands* and *observations*. The server decides session state, corrects for device clock skew, and derives time entries. Clients never write time entries directly.
3. **History is append-only.** Every change to tracked time is a new revision that points at the one it replaces. Idle adjustments, manual edits, and approvals are events. Nothing is silently rewritten.
4. **Tenant isolation is enforced twice.** `organization_id` is required in every service call, and PostgreSQL row-level security acts as a backstop. A missing `WHERE organization_id = …` returns zero rows, never another tenant's rows.
5. **Privacy is decided at the source.** The agent never collects what the policy forbids. Keystrokes are counted, never recorded. Screenshots are blurred *before* upload when blur is on. URLs are cut down to the domain on the device when the policy says domain-only.

## Master feature status matrix

Legend: `P` planned, `B` building, `✓` done, `—` not applicable. The phase column refers to [07-roadmap.md](07-roadmap.md).

| Feature | Arch | Backend | Web | Electron | DB | API | Phase | Status |
|---|---|---|---|---|---|---|---|---|
| Auth / orgs / roles | P | P | P | P | P | P | 2 | planned |
| Workers, teams, clients | P | P | P | — | P | P | 3 | planned |
| Projects, tasks | P | P | P | P | P | P | 3 | planned |
| Devices | P | P | P | P | P | P | 3/5 | planned |
| Time tracking (session engine) | P | P | P | P | P | P | 4 | planned |
| Web timer | P | P | P | — | P | P | 4 | planned |
| Desktop agent core + offline sync | P | P | — | P | P | P | 5 | planned |
| Activity % / idle | P | P | P | P | P | P | 6 | planned |
| Screenshots | P | P | P | P | P | P | 6 | planned |
| App tracking | P | P | P | P | P | P | 6 | planned |
| URL tracking (browser extension) | P | P | P | P | P | P | 6 / 12 | planned |
| Timesheets, manual time, approvals | P | P | P | — | P | P | 7 | planned |
| Attendance, schedules, limits | P | P | P | P | P | P | 8 | planned |
| Time off / PTO | P | P | P | — | P | P | 8 | planned |
| Rates, billable, budgets | P | P | P | — | P | P | 9 | planned |
| Expenses | P | P | P | — | P | P | 9 | planned |
| Invoices, payments | P | P | P | — | P | P | 9 | planned |
| Dashboards + widgets | P | P | P | — | P | P | 10 | planned |
| Reports engine + exports | P | P | P | — | P | P | 11 | planned |
| Payroll-ready export | P | P | P | — | P | P | 11 | planned |
| API keys, webhooks | P | P | P | — | P | P | 12 | planned |
| Audit, retention, security settings | P | P | P | — | P | P | 13 | planned |
| Location / GPS / geofences | P | Future | Future | — | P (schema) | Future | Future | architecture only |
| Mobile apps | P | — | — | — | — | — | Future | gap (see §19) |
| PM integrations (Jira etc.) | P | Future | Future | — | P | Future | Future | gap (see §19) |
