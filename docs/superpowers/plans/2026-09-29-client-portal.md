# Client Portal (Client Dashboards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organization give each of its clients a read-only, signed-in dashboard that shows the workers assigned to that client's projects, the hours they worked per task, task progress and (only when the organization turns it on for that client) activity levels and screenshots.

**Architecture:** A client viewer is a normal `users` account linked to one client through a new `client_portal_access` row, never a `memberships` row, so they never appear as a worker, never get grants and never pass the `/orgs/:orgId` tenant middleware. A new `/api/v1/portal/*` route group resolves the viewer's access with `withSystem`, then reads that one organization's data with `withTenant` (RLS), limited to the client's selected projects and the sections enabled in `client_portal_settings`. The web app gets a `/portal` area outside `/o/[orgId]`, an invitation page, an admin settings page with "Preview as client", and workers see which clients can view their data.

**Tech Stack:** Hono API (`packages/api`), Drizzle + Postgres RLS (`packages/db`), zod contracts (`packages/contracts`), Next.js 16 App Router + React Query (`apps/web`), Electron renderer (`apps/desktop`), Vitest with the PGlite harness (`packages/api/test/harness.ts`).

**Spec:** This plan carries its own spec, the "Decisions" section below, agreed with the product owner on 2026-09-29. Background: `docs/plan/05-security-api.md` (visibility matrix), `docs/plan/03-data-model.md`, and ADR-111 (RLS) and ADR-125 to ADR-132 in `docs/plan/08-decisions.md`.

## Decisions (the spec)

1. **Access = invited client accounts.** An admin invites a client contact by email. The contact sets a name and password, or signs in with an existing account, and gets a read-only portal. Access is per person, revocable, and every view is audited. No anonymous share links.
2. **Sections a client can see**, each switchable **per client**:
   - `hours`: who is assigned, and hours per worker, per task and per day, with billable and non-billable split. **Default on.**
   - `tasks`: task status, priority, due date, tracked vs estimate, assignees, and the project's **hour** budget used. **Default on.**
   - `activity`: each worker's activity % on the client's projects. **Default off.**
   - `screenshots`: screenshots taken while the worker tracked time on the client's projects. **Default off.**
3. **No money.** Never show rates, amounts, invoices, payments, pay or money budgets. Only `HOURS` budgets are shown.
4. **Per-client control.** Settings per client: portal on/off, sections, and which of the client's projects are included (`null` = all). "Preview as client" shows admins exactly what the client sees.
5. **Worker transparency.** When `activity` or `screenshots` is on for a client, every worker with time on that client's included projects can see it, on the web "What is monitored" page and in the desktop app's monitoring screen.

## Global Constraints

- User-facing product name: **WorkPulse**. Technical identifiers keep `tallywork` / `Tallywork` (ADR-125).
- A portal viewer must never be added to `memberships`. Portal code must never call `requirePermission` or the org tenant middleware on the viewer's behalf.
- Every portal response is limited to one organization, one client and that client's included projects. A project that is later moved to another client stops showing immediately.
- Money fields never appear in any `/portal` response: no `amount`, `rate`, `invoice`, `bill_*`, `pay_*` keys. A test asserts this.
- `activity` and `screenshots` can only be enabled by someone whose own grants include `activity:read` or `screenshots:read` at `org` scope (so nobody can expose data they cannot see themselves).
- Screenshots: exclude `deleted_at` rows, respect `blurred`, and serve them only through the existing signed `/media/:token` URLs (`mediaUrl` in `packages/api/src/services/activity.ts`). Log every screenshot list the portal returns.
- Audit: portal views are written to `audit_logs` with `actor_type = 'client'` and `actor_id = client_portal_access.id`.
- Portal invitations expire after 7 days. The invite token is stored only as a sha256 hash.
- Rate limits: `/portal/*` 120 per minute per IP; invite accept 20 per hour.
- Tests use the PGlite harness: `createHarness`, `signup`, `addMember`, `Client`, and `t.flush()` to run rollups.
- Run from repo root: `pnpm --filter @tallywork/api test`, `pnpm -r --filter "./packages/*" --filter @tallywork/web typecheck`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema/portal.ts` (new) | `client_portal_settings`, `client_portal_access` tables |
| `packages/db/src/schema/index.ts` | export the new schema file |
| `packages/db/src/schema/platform.ts` | allow `'client'` as an audit `actorType` |
| `packages/db/migrations/0011_client_portal.sql` (generated) | the migration |
| `packages/contracts/src/inputs.ts` | `clientPortalSettingsInput`, `clientPortalInviteInput`, `clientPortalAcceptInput`, `portalRangeInput` |
| `packages/contracts/src/dto.ts` | portal DTOs, and `MeDto.client_portals` |
| `packages/api/src/services/portal-admin.ts` (new) | admin side: settings, invitations, revoke, the preview access object |
| `packages/api/src/services/portal.ts` (new) | viewer side: resolve access, summary, screenshots, audit |
| `packages/api/src/routes/portal.ts` (new) | `/portal/*` routes (viewer and invitation accept) |
| `packages/api/src/routes/org.ts` | admin routes under `/orgs/:orgId/clients/:id/portal*` |
| `packages/api/src/app.ts` | mount `/portal` |
| `packages/api/src/services/identity.ts` | `getMe` returns `client_portals` |
| `packages/api/src/services/agent-me.ts`, `routes/agent.ts` | `client-visibility` for the desktop |
| `packages/api/test/portal.test.ts` (new) | all API behaviour and isolation tests |
| `apps/web/app/portal/page.tsx` (new) | list of the viewer's portals |
| `apps/web/app/portal/[accessId]/page.tsx` (new) | the client dashboard |
| `apps/web/app/portal-invite/page.tsx` (new) | accept a portal invitation |
| `apps/web/components/portal/portal-dashboard.tsx` (new) | dashboard UI (shared by the viewer page and the admin preview) |
| `apps/web/app/o/[orgId]/clients/[id]/portal/page.tsx` (new) | admin settings, invitations, preview |
| `apps/web/app/o/[orgId]/clients/page.tsx` | "Client portal" link per client |
| `apps/web/app/page.tsx`, `apps/web/app/(auth)/login/page.tsx` | send portal-only users to `/portal` |
| `apps/web/app/o/[orgId]/me/monitoring/page.tsx` | "Clients who can see your data" |
| `apps/desktop/src/shared/ipc.ts`, `src/renderer/src/App.tsx` | the same notice in the desktop app |
| `apps/web/messages/en.ts` | copy |
| `docs/plan/08-decisions.md`, `docs/api/README.md`, `README.md` | ADR-133 and endpoint docs |

---

### Task 1: Database schema and migration

**Files:**
- Create: `packages/db/src/schema/portal.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/schema/platform.ts:136`
- Generated: `packages/db/migrations/0011_client_portal.sql` (+ `meta/`)
- Test: `packages/db/test/rls.test.ts` (extend)

**Interfaces:**
- Produces: `clientPortalSettings`, `clientPortalAccess` Drizzle tables; type `ClientPortalSections = { hours: boolean; tasks: boolean; activity: boolean; screenshots: boolean }`; `DEFAULT_PORTAL_SECTIONS`.

- [ ] **Step 1: Write the failing RLS test** (append to `packages/db/test/rls.test.ts`, following the file's existing pattern for tenant isolation)

```ts
it('client portal tables are tenant-isolated', async () => {
  const tables = await h.db.execute(sql`select tablename from pg_policies where policyname = 'tenant_isolation' and tablename in ('client_portal_settings', 'client_portal_access')`);
  expect((tables as unknown as { rows: Array<{ tablename: string }> }).rows.map((r) => r.tablename).sort()).toEqual(['client_portal_access', 'client_portal_settings']);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @tallywork/db test`
Expected: FAIL (the tables do not exist).

- [ ] **Step 3: Create `packages/db/src/schema/portal.ts`**

```ts
import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orgId, pk, tstz } from './_helpers';
import { users } from './identity';
import { clients } from './workforce';

/** Which parts of the client dashboard a client may see (per client; monitoring sections start off). */
export interface ClientPortalSections {
  hours: boolean;
  tasks: boolean;
  activity: boolean;
  screenshots: boolean;
}
export const DEFAULT_PORTAL_SECTIONS: ClientPortalSections = { hours: true, tasks: true, activity: false, screenshots: false };

export const clientPortalSettings = pgTable(
  'client_portal_settings',
  {
    organizationId: orgId(),
    clientId: uuid().notNull(),
    enabled: boolean().notNull().default(false),
    sections: jsonb().$type<ClientPortalSections>().notNull().default(DEFAULT_PORTAL_SECTIONS),
    /** null = every project of the client (including ones added later) */
    projectIds: jsonb().$type<string[] | null>(),
    updatedBy: uuid(),
    updatedAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.clientId] }),
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
  ],
);

/** One client viewer (a user account) with read-only access to one client's portal. Never a membership. */
export const clientPortalAccess = pgTable(
  'client_portal_access',
  {
    id: pk(),
    organizationId: orgId(),
    clientId: uuid().notNull(),
    email: text().notNull(),
    name: text(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    status: text().$type<'INVITED' | 'ACTIVE' | 'REVOKED'>().notNull().default('INVITED'),
    inviteTokenHash: text(),
    inviteExpiresAt: tstz(),
    /** membership id of the admin who invited */
    invitedBy: uuid(),
    acceptedAt: tstz(),
    revokedAt: tstz(),
    lastViewedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }).onDelete('cascade'),
    uniqueIndex('client_portal_access_email_uq').on(t.organizationId, t.clientId, t.email),
    uniqueIndex('client_portal_access_token_uq').on(t.inviteTokenHash),
    index().on(t.userId),
  ],
);
```

- [ ] **Step 4: Export it and allow the `client` audit actor**

`packages/db/src/schema/index.ts`, add a line:

```ts
export * from './portal';
```

`packages/db/src/schema/platform.ts:136`, change the union:

```ts
    actorType: text().$type<'user' | 'agent' | 'system' | 'api_key' | 'support' | 'client'>().notNull(),
```

- [ ] **Step 5: Generate the migration and check it**

Run: `pnpm db:generate`
Expected: a new `packages/db/migrations/0011_*.sql` creating both tables. Rename it to `0011_client_portal.sql` and update `meta/_journal.json`'s `tag` to match. RLS policies are added automatically by `applyRls()` for tables with `organization_id`, so the SQL has no policy statements.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @tallywork/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/portal.ts packages/db/src/schema/index.ts packages/db/src/schema/platform.ts packages/db/migrations packages/db/test/rls.test.ts
git commit -m "feat(db): client portal settings and access tables"
```

---

### Task 2: Contracts (inputs and DTOs)

**Files:**
- Modify: `packages/contracts/src/inputs.ts` (after `taskInput`), `packages/contracts/src/dto.ts` (`MeDto` and end of file)

**Interfaces:**
- Produces:
  - Inputs: `clientPortalSettingsInput`, `clientPortalInviteInput`, `clientPortalAcceptInput`, `portalRangeInput`.
  - DTOs: `PortalSectionsDto`, `ClientPortalSettingsDto`, `PortalListItemDto`, `PortalSummaryDto`, `PortalScreenshotDto`, `ClientVisibilityDto`.
  - `MeDto.client_portals`.

- [ ] **Step 1: Add the inputs** (`packages/contracts/src/inputs.ts`)

```ts
// ─── Client portal ───────────────────────────────────────────────────────────
export const portalSectionsInput = z.object({ hours: z.boolean(), tasks: z.boolean(), activity: z.boolean(), screenshots: z.boolean() });

export const clientPortalSettingsInput = z.object({
  enabled: z.boolean().optional(),
  sections: portalSectionsInput.partial().optional(),
  /** null = all of the client's projects */
  project_ids: z.array(id).max(500).nullable().optional(),
});

export const clientPortalInviteInput = z.object({ email: z.email().max(254), name: optionalText(100) });

export const clientPortalAcceptInput = z.object({
  token: z.string().min(20).max(200),
  name: optionalText(100),
  password: password.optional(),
});

/** Dashboard range; at most 93 days. */
export const portalRangeInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 93, { message: 'Choose a range of up to 93 days' });
```

- [ ] **Step 2: Add the DTOs** (append to `packages/contracts/src/dto.ts`)

```ts
// ─── Client portal ───────────────────────────────────────────────────────────
export interface PortalSectionsDto {
  hours: boolean;
  tasks: boolean;
  activity: boolean;
  screenshots: boolean;
}

export interface ClientPortalSettingsDto {
  client_id: string;
  enabled: boolean;
  sections: PortalSectionsDto;
  project_ids: string[] | null;
  projects: Array<{ id: string; name: string }>;
  access: Array<{ id: string; email: string; name: string | null; status: 'INVITED' | 'ACTIVE' | 'REVOKED'; accepted_at: string | null; last_viewed_at: string | null }>;
  /** what the current admin may switch on */
  can_enable: { activity: boolean; screenshots: boolean };
}

export interface PortalListItemDto {
  access_id: string;
  organization_name: string;
  client_name: string;
}

export interface PortalSummaryDto {
  access_id: string | null; // null in the admin preview
  organization: { id: string; name: string };
  client: { id: string; name: string };
  sections: PortalSectionsDto;
  range: { from: string; to: string };
  totals: { tracked_seconds: number; manual_seconds: number; billable_seconds: number };
  projects: Array<{ id: string; name: string; color: string; status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'; tracked_seconds: number; budget: { amount_seconds: number; used_seconds: number; pct_used: number } | null }>;
  /** present when sections.hours */
  workers: Array<{ membership_id: string; name: string; title: string | null; tracked_seconds: number; manual_seconds: number; activity_pct: number | null; tasks: Array<{ task_id: string | null; title: string; seconds: number }> }> | null;
  /** present when sections.hours */
  days: Array<{ date: string; seconds: number }> | null;
  /** present when sections.tasks */
  tasks: Array<{ id: string; project_id: string; title: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE'; priority: string; due_date: string | null; estimate_seconds: number | null; tracked_seconds: number; assignees: string[] }> | null;
}

export interface PortalScreenshotDto {
  id: string;
  captured_at: string;
  worker_name: string;
  project_id: string;
  blurred: boolean;
  thumb_url: string;
  full_url: string;
}

/** Shown to a worker: clients that can see their monitoring data. */
export interface ClientVisibilityDto {
  clients: Array<{ client_name: string; activity: boolean; screenshots: boolean }>;
}
```

In `MeDto`, add a field after `organizations`:

```ts
  /** client portals this person can open (they are a client viewer, not a member) */
  client_portals: Array<{ access_id: string; organization_name: string; client_name: string }>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @tallywork/contracts --filter @tallywork/api typecheck`
Expected: `packages/api` fails in `getMe` (missing `client_portals`). That is fixed in Task 5, so this failure is expected at this point.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): client portal inputs and DTOs"
```

---

### Task 3: Admin API: settings, invitations, revoke

**Files:**
- Create: `packages/api/src/services/portal-admin.ts`
- Modify: `packages/api/src/routes/org.ts` (after the `/clients` routes)
- Test: `packages/api/test/portal.test.ts` (new)

**Interfaces:**
- Consumes: `clientPortalSettings`, `clientPortalAccess`, `DEFAULT_PORTAL_SECTIONS` (Task 1); inputs and DTOs (Task 2).
- Produces:
  - `getPortalSettings(x: Ctx, clientId: string): Promise<ClientPortalSettingsDto>`
  - `updatePortalSettings(x: Ctx, clientId: string, input): Promise<ClientPortalSettingsDto>`
  - `invitePortalViewer(x: Ctx, clientId: string, input): Promise<{ id: string; invite_url: string }>`
  - `revokePortalViewer(x: Ctx, clientId: string, accessId: string): Promise<void>`
  - Routes: `GET|PUT /orgs/:orgId/clients/:id/portal`, `POST /orgs/:orgId/clients/:id/portal/invitations`, `DELETE /orgs/:orgId/clients/:id/portal/access/:accessId`.

- [ ] **Step 1: Write the failing tests** (`packages/api/test/portal.test.ts`)

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

let t: Harness;
let admin: Client;
let manager: Client;
let orgId: string;
let clientId: string;
let otherClientId: string;
let siteId: string;
let appId: string;
let otherProjectId: string;
let walt: { client: Client; membershipId: string };
let bea: { client: Client; membershipId: string };
const o = (p: string) => `/orgs/${orgId}${p}`;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@portal.test'));
  walt = await addMember(t, admin, orgId, 'Walt', 'walt@portal.test');
  bea = await addMember(t, admin, orgId, 'Bea', 'bea@portal.test');
  ({ client: manager } = await addMember(t, admin, orgId, 'Mia', 'mia@portal.test', 'TEAM_MANAGER'));
  clientId = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
  otherClientId = (await admin.post(o('/clients'), { name: 'Globex' })).body.id;
  siteId = (await admin.post(o('/projects'), { name: 'Website', client_id: clientId, member_ids: [walt.membershipId, bea.membershipId] })).body.id;
  appId = (await admin.post(o('/projects'), { name: 'Mobile app', client_id: clientId, member_ids: [walt.membershipId] })).body.id;
  otherProjectId = (await admin.post(o('/projects'), { name: 'Globex site', client_id: otherClientId, member_ids: [bea.membershipId] })).body.id;
});
afterAll(() => t.close());

describe('portal admin', () => {
  it('starts disabled, with hours and tasks on and monitoring off', async () => {
    const r = await admin.get(o(`/clients/${clientId}/portal`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: false, sections: { hours: true, tasks: true, activity: false, screenshots: false }, project_ids: null, access: [] });
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
  });

  it('only people with org-wide monitoring access can switch activity or screenshots on', async () => {
    expect((await manager.put(o(`/clients/${clientId}/portal`), { enabled: true })).status).toBe(403);
    const r = await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true } });
    expect(r.status).toBe(200);
    expect(r.body.sections).toEqual({ hours: true, tasks: true, activity: true, screenshots: false });
  });

  it('rejects projects that belong to another client', async () => {
    const r = await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [siteId, otherProjectId] });
    expect(r.status).toBe(422);
  });

  it('invites a viewer by email with a 7-day link, and revokes them', async () => {
    const r = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'carla@acme.test', name: 'Carla' });
    expect(r.status).toBe(201);
    expect(r.body.invite_url).toMatch(/\/portal-invite\?token=/);
    const mail = t.mailer.sent.at(-1)!;
    expect(mail.to).toBe('carla@acme.test');
    expect(mail.subject).toBe("Acme’s WorkPulse dashboard from Ada's Org");
    const again = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'CARLA@acme.test' });
    expect(again.status).toBe(409);
    const tmp = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'temp@acme.test' });
    expect((await admin.del(o(`/clients/${clientId}/portal/access/${tmp.body.id}`))).status).toBe(204);
    const list = (await admin.get(o(`/clients/${clientId}/portal`))).body.access;
    expect(list.find((a: { email: string }) => a.email === 'temp@acme.test').status).toBe('REVOKED');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts`
Expected: FAIL (404 on the new routes).

- [ ] **Step 3: Implement `packages/api/src/services/portal-admin.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { clientPortalAccess, clientPortalSettings, clients, DEFAULT_PORTAL_SECTIONS, projects, type ClientPortalSections } from '@tallywork/db';
import { businessRule, conflict, forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { ClientPortalSettingsDto, clientPortalInviteInput, clientPortalSettingsInput } from '@tallywork/contracts';
import type { z } from 'zod';
import { randomToken, sha256 } from '../lib/crypto';
import type { Ctx } from './ctx';
import { audit } from './events';

const INVITE_DAYS = 7;

function assertManager(x: Ctx) {
  if (x.actor.grants['clients:manage'] !== 'org') throw forbidden('Only organization admins can manage client portals');
}

async function loadClient(x: Ctx, clientId: string) {
  const [c] = await x.tx.select().from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('client');
  return c;
}

async function settingsRow(x: Ctx, clientId: string) {
  const [s] = await x.tx.select().from(clientPortalSettings).where(eq(clientPortalSettings.clientId, clientId));
  return s ?? { enabled: false, sections: DEFAULT_PORTAL_SECTIONS, projectIds: null as string[] | null };
}

export async function getPortalSettings(x: Ctx, clientId: string): Promise<ClientPortalSettingsDto> {
  assertManager(x);
  await loadClient(x, clientId);
  const s = await settingsRow(x, clientId);
  const ps = await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.clientId, clientId)).orderBy(projects.name);
  const access = await x.tx.select().from(clientPortalAccess).where(eq(clientPortalAccess.clientId, clientId)).orderBy(clientPortalAccess.createdAt);
  return {
    client_id: clientId,
    enabled: s.enabled,
    sections: { ...DEFAULT_PORTAL_SECTIONS, ...s.sections },
    project_ids: s.projectIds,
    projects: ps,
    access: access.map((a) => ({ id: a.id, email: a.email, name: a.name, status: a.status, accepted_at: a.acceptedAt?.toISOString() ?? null, last_viewed_at: a.lastViewedAt?.toISOString() ?? null })),
    can_enable: { activity: x.actor.grants['activity:read'] === 'org', screenshots: x.actor.grants['screenshots:read'] === 'org' },
  };
}

export async function updatePortalSettings(x: Ctx, clientId: string, input: z.infer<typeof clientPortalSettingsInput>): Promise<ClientPortalSettingsDto> {
  assertManager(x);
  await loadClient(x, clientId);
  const before = await settingsRow(x, clientId);
  const sections: ClientPortalSections = { ...DEFAULT_PORTAL_SECTIONS, ...before.sections, ...input.sections };
  // Nobody can expose monitoring data they could not see themselves.
  if (sections.activity && !before.sections.activity && x.actor.grants['activity:read'] !== 'org') throw forbidden('You need organization-wide access to activity to share it');
  if (sections.screenshots && !before.sections.screenshots && x.actor.grants['screenshots:read'] !== 'org') throw forbidden('You need organization-wide access to screenshots to share them');
  let projectIds = input.project_ids === undefined ? before.projectIds : input.project_ids;
  if (projectIds) {
    const own = new Set((await x.tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))).map((p) => p.id));
    if (projectIds.some((id) => !own.has(id))) throw validation('Choose only this client’s projects', { errors: [{ field: 'project_ids', message: 'Includes a project of another client' }] });
    projectIds = [...new Set(projectIds)];
  }
  const enabled = input.enabled ?? before.enabled;
  await x.tx
    .insert(clientPortalSettings)
    .values({ organizationId: x.org.id, clientId, enabled, sections, projectIds, updatedBy: x.actor.membershipId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [clientPortalSettings.organizationId, clientPortalSettings.clientId], set: { enabled, sections, projectIds, updatedBy: x.actor.membershipId, updatedAt: new Date() } });
  await audit(x, { action: 'client_portal.settings_updated', targetType: 'client', targetId: clientId, before, after: { enabled, sections, projectIds } });
  return getPortalSettings(x, clientId);
}

export async function invitePortalViewer(x: Ctx, clientId: string, input: z.infer<typeof clientPortalInviteInput>): Promise<{ id: string; invite_url: string }> {
  assertManager(x);
  const client = await loadClient(x, clientId);
  const email = input.email.toLowerCase();
  const [existing] = await x.tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.clientId, clientId), eq(clientPortalAccess.email, email)));
  if (existing && existing.status !== 'REVOKED') throw conflict('portal_viewer_exists', 'This person already has access or a pending invitation');
  const token = randomToken(32);
  const id = existing?.id ?? newId();
  const values = { status: 'INVITED' as const, name: input.name ?? null, inviteTokenHash: sha256(token), inviteExpiresAt: new Date(x.deps.now().getTime() + INVITE_DAYS * 86_400_000), invitedBy: x.actor.membershipId, revokedAt: null, acceptedAt: null, userId: null };
  if (existing) await x.tx.update(clientPortalAccess).set(values).where(eq(clientPortalAccess.id, id));
  else await x.tx.insert(clientPortalAccess).values({ id, organizationId: x.org.id, clientId, email, ...values });
  const inviteUrl = `${x.deps.config.appUrl}/portal-invite?token=${token}`;
  await x.deps.mailer.send({
    to: email,
    subject: `${client.name}’s WorkPulse dashboard from ${x.org.name}`,
    text: `${x.org.name} invited you to follow the work on ${client.name}'s projects in WorkPulse: who is working on them, hours per task and task progress.\n\nOpen your dashboard (link valid for ${INVITE_DAYS} days): ${inviteUrl}\n`,
  });
  await audit(x, { action: 'client_portal.viewer_invited', targetType: 'client', targetId: clientId, after: { email } });
  return { id, invite_url: inviteUrl };
}

export async function revokePortalViewer(x: Ctx, clientId: string, accessId: string): Promise<void> {
  assertManager(x);
  const [a] = await x.tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.id, accessId), eq(clientPortalAccess.clientId, clientId)));
  if (!a) throw notFound('portal access');
  if (a.status === 'REVOKED') throw businessRule('already_revoked', 'Access is already revoked');
  await x.tx.update(clientPortalAccess).set({ status: 'REVOKED', revokedAt: new Date(), inviteTokenHash: null }).where(eq(clientPortalAccess.id, accessId));
  await audit(x, { action: 'client_portal.viewer_revoked', targetType: 'client', targetId: clientId, before: { email: a.email, status: a.status } });
}
```

If `conflict` is not exported from `@tallywork/domain` under that name, use the same helper `createUser` uses in `services/identity.ts` (`conflict('email_taken', …)`); it is imported there from `@tallywork/domain`.

- [ ] **Step 4: Add the routes** (`packages/api/src/routes/org.ts`, after the existing `/clients` routes; import the inputs from `@tallywork/contracts` and the four functions from `../services/portal-admin`)

```ts
  // Client portal (admins): settings, viewers, invitations
  .get('/clients/:id/portal', requirePermission('clients:manage'), async (c) => c.json(await getPortalSettings(ctx(c), c.req.param('id'))))
  .put('/clients/:id/portal', requirePermission('clients:manage'), async (c) => c.json(await updatePortalSettings(ctx(c), c.req.param('id'), await body(c, clientPortalSettingsInput))))
  .post('/clients/:id/portal/invitations', requirePermission('clients:manage'), async (c) => c.json(await invitePortalViewer(ctx(c), c.req.param('id'), await body(c, clientPortalInviteInput)), 201))
  .delete('/clients/:id/portal/access/:accessId', requirePermission('clients:manage'), async (c) => {
    await revokePortalViewer(ctx(c), c.req.param('id'), c.req.param('accessId'));
    return c.body(null, 204);
  })
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts`
Expected: the four `portal admin` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/portal-admin.ts packages/api/src/routes/org.ts packages/api/test/portal.test.ts
git commit -m "feat(api): client portal settings and viewer invitations"
```

---

### Task 4: Accept a portal invitation

**Files:**
- Create: `packages/api/src/routes/portal.ts`
- Modify: `packages/api/src/services/portal.ts` (create), `packages/api/src/app.ts:90` (mount)
- Test: `packages/api/test/portal.test.ts` (extend)

**Interfaces:**
- Consumes: `createUser`, `findUserByEmail`, `createSession` from `services/identity.ts`; the `startSession` pattern from `routes/auth.ts`.
- Produces:
  - `acceptPortalInvitation(deps: Deps, input, currentUserId: string | null): Promise<{ accessId: string; userId: string; created: boolean }>`
  - Route `POST /api/v1/portal/invitations/accept` → `{ access_id }`, which signs the person in when they weren't signed in.

- [ ] **Step 1: Write the failing tests** (append to `packages/api/test/portal.test.ts`)

```ts
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
let dora: Client;
let doraAccessId: string;

describe('accepting a portal invitation', () => {
  it('creates a verified account that is not a member of the organization', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'dora@acme.test', name: 'Dora' });
    dora = new Client(t);
    const r = await dora.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url), name: 'Dora', password: PASSWORD });
    expect(r.status).toBe(200);
    doraAccessId = r.body.access_id;
    const me = await dora.get('/me');
    expect(me.body.organizations).toEqual([]);
    expect(me.body.user.email_verified).toBe(true);
    expect(me.body.client_portals).toEqual([{ access_id: doraAccessId, organization_name: "Ada's Org", client_name: 'Acme' }]);
    // Not a member: every org route is closed to them.
    expect((await dora.get(o('/workers'))).status).toBe(404);
  });

  it('rejects a reused or unknown token', async () => {
    expect((await new Client(t).post('/portal/invitations/accept', { token: 'x'.repeat(43), password: PASSWORD })).status).toBe(422);
  });

  it('asks an existing account to sign in first, then links it', async () => {
    const inv = await admin.post(o(`/clients/${clientId}/portal/invitations`), { email: 'walt@portal.test' });
    const r = await new Client(t).post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('login_required');
    const ok = await walt.client.post('/portal/invitations/accept', { token: tokenOf(inv.body.invite_url) });
    expect(ok.status).toBe(200);
  });
});
```

`signup()` in the harness names the organization `${name}'s Org`, so it is "Ada's Org" here.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts -t "accepting"`
Expected: FAIL (404).

- [ ] **Step 3: Create `packages/api/src/services/portal.ts` with the accept function**

```ts
import { and, eq, gt } from 'drizzle-orm';
import { clientPortalAccess, users, withSystem } from '@tallywork/db';
import { businessRule } from '@tallywork/domain';
import type { clientPortalAcceptInput } from '@tallywork/contracts';
import type { z } from 'zod';
import type { Deps } from '../context';
import { sha256 } from '../lib/crypto';
import { createUser, findUserByEmail } from './identity';

export async function acceptPortalInvitation(deps: Deps, input: z.infer<typeof clientPortalAcceptInput>, currentUserId: string | null) {
  const invalid = businessRule('invalid_invitation', 'This invitation is invalid or has expired');
  const inv = await withSystem(deps.db, async (tx) => {
    const [a] = await tx
      .select()
      .from(clientPortalAccess)
      .where(and(eq(clientPortalAccess.inviteTokenHash, sha256(input.token)), eq(clientPortalAccess.status, 'INVITED'), gt(clientPortalAccess.inviteExpiresAt, deps.now())))
      .limit(1);
    return a ?? null;
  });
  if (!inv) throw invalid;

  let userId = currentUserId;
  let created = false;
  if (userId) {
    const [me] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me || me.email.toLowerCase() !== inv.email) throw businessRule('invitation_email_mismatch', `This invitation was sent to ${inv.email}`);
  } else if (await findUserByEmail(deps.db, inv.email)) {
    throw businessRule('login_required', 'Sign in with your existing account to open this dashboard');
  } else {
    if (!input.password) throw businessRule('password_required', 'Choose a password to create your account');
    // The emailed link proves the address, so the account starts verified.
    userId = await createUser(deps.db, { name: input.name ?? inv.name ?? inv.email.split('@')[0]!, email: inv.email, password: input.password, verified: true });
    created = true;
  }
  await withSystem(deps.db, (tx) =>
    tx.update(clientPortalAccess).set({ status: 'ACTIVE', userId, acceptedAt: deps.now(), inviteTokenHash: null, inviteExpiresAt: null }).where(eq(clientPortalAccess.id, inv.id)),
  );
  return { accessId: inv.id, userId: userId!, created };
}
```

- [ ] **Step 4: Create `packages/api/src/routes/portal.ts`**

```ts
import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { clientPortalAcceptInput } from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body } from '../lib/http';
import { rateLimit } from '../middleware/rate-limit';
import { SESSION_COOKIE } from '../middleware/auth';
import { createSession } from '../services/identity';
import { acceptPortalInvitation } from '../services/portal';

async function startSession(c: Context<AppEnv>, uid: string) {
  const { token, expiresAt } = await createSession(c.var.deps, uid, { ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: c.req.header('user-agent') ?? null }, { mfaPending: false });
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: c.var.deps.config.env === 'production', sameSite: 'Lax', path: '/', expires: expiresAt });
}

/** Client portal: read-only dashboards for an organization's clients (never members; see services/portal.ts). */
export const portalRoutes = new Hono<AppEnv>()
  .post('/invitations/accept', rateLimit('portal-accept', 20, 3600), async (c) => {
    const p = c.var.principal;
    const r = await acceptPortalInvitation(c.var.deps, await body(c, clientPortalAcceptInput), p?.type === 'user' ? p.userId : null);
    if (r.created) await startSession(c, r.userId);
    return c.json({ access_id: r.accessId });
  });
```

`startSession` repeats the helper in `routes/auth.ts`. If you prefer no duplication, export that helper from `routes/auth.ts` (rename it to `startUserSession`) and import it here.

- [ ] **Step 5: Mount it** (`packages/api/src/app.ts`, next to `app.route('/support', supportRoutes)`)

```ts
  app.route('/portal', portalRoutes);
```

- [ ] **Step 6: Make `/me` return `client_portals`** (`packages/api/src/services/identity.ts`, `getMe`, before the `return`)

```ts
  const portals = await withSystem(db, (tx) =>
    tx
      .select({ accessId: clientPortalAccess.id, organizationName: organizations.name, clientName: clients.name })
      .from(clientPortalAccess)
      .innerJoin(organizations, eq(organizations.id, clientPortalAccess.organizationId))
      .innerJoin(clients, eq(clients.id, clientPortalAccess.clientId))
      .innerJoin(clientPortalSettings, and(eq(clientPortalSettings.organizationId, clientPortalAccess.organizationId), eq(clientPortalSettings.clientId, clientPortalAccess.clientId)))
      .where(and(eq(clientPortalAccess.userId, userIdValue), eq(clientPortalAccess.status, 'ACTIVE'), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt)))
      .orderBy(organizations.name, clients.name),
  );
```

In the returned object, add `client_portals: portals.map((p) => ({ access_id: p.accessId, organization_name: p.organizationName, client_name: p.clientName }))`. Import `clientPortalAccess`, `clientPortalSettings` and `clients` from `@tallywork/db`, and `isNull` from `drizzle-orm`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts`
Expected: PASS. Also run `pnpm --filter @tallywork/api typecheck` (the Task 2 `getMe` error is now fixed).

- [ ] **Step 8: Commit**

```bash
git add packages/api/src packages/api/test/portal.test.ts
git commit -m "feat(api): accept client portal invitations; /me lists client portals"
```

---

### Task 5: Portal dashboard API (hours, workers, tasks, budgets) and admin preview

**Files:**
- Modify: `packages/api/src/services/portal.ts`, `packages/api/src/routes/portal.ts`, `packages/api/src/routes/org.ts`
- Test: `packages/api/test/portal.test.ts` (extend)

**Interfaces:**
- Consumes: `budgetStatuses(tx, currency, today, { subjectIds })` from `services/finance.ts`; `loadOrg(tx, id)` from `middleware/tenant.ts`.
- Produces:
  - `interface PortalAccess { accessId: string | null; organizationId: string; clientId: string; sections: ClientPortalSections; projectIds: string[] }`
  - `loadPortalAccess(deps: Deps, userId: string, accessId: string): Promise<PortalAccess>`
  - `previewAccess(x: Ctx, clientId: string): Promise<PortalAccess>` (in `portal-admin.ts`)
  - `portalSummary(deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalSummaryDto>`
  - Routes:
    - `GET /portal` → `PortalListItemDto[]`
    - `GET /portal/:accessId/summary?from&to`
    - `GET /orgs/:orgId/clients/:id/portal/preview?from&to`

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe('portal dashboard', () => {
  const range = '?from=2026-09-01&to=2026-09-30';
  beforeAll(async () => {
    const task = (await admin.post(o(`/projects/${siteId}/tasks`), { title: 'Homepage', estimate_seconds: 4 * 3600, assignee_ids: [walt.membershipId] })).body.id;
    const add = (m: string, p: string, h: number, taskId?: string) =>
      admin.post(o('/manual-time'), { membership_id: m, project_id: p, task_id: taskId, started_at: '2026-09-15T13:00:00Z', ended_at: new Date(Date.parse('2026-09-15T13:00:00Z') + h * 3600_000).toISOString(), reason: 'Work' });
    await add(walt.membershipId, siteId, 2, task);
    await add(bea.membershipId, siteId, 1);
    await add(walt.membershipId, appId, 3);
    await add(bea.membershipId, otherProjectId, 5); // another client's project: never shown
    await admin.post(o('/budgets'), { subject_type: 'PROJECT', subject_id: siteId, kind: 'HOURS', amount: 10 * 3600 });
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, project_ids: null, sections: { activity: false } });
    await t.flush();
  });

  it('lists only this client’s projects, workers and tasks', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.status).toBe(200);
    expect(r.body.client.name).toBe('Acme');
    expect(r.body.totals.manual_seconds).toBe(6 * 3600);
    expect(r.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['Mobile app', 'Website']);
    const w = Object.fromEntries(r.body.workers.map((x: { name: string; manual_seconds: number }) => [x.name, x.manual_seconds]));
    expect(w).toEqual({ Walt: 5 * 3600, Bea: 3600 });
    expect(r.body.tasks).toEqual([expect.objectContaining({ title: 'Homepage', estimate_seconds: 4 * 3600, tracked_seconds: 2 * 3600, assignees: ['Walt'] })]);
    expect(r.body.projects.find((p: { name: string }) => p.name === 'Website').budget).toEqual({ amount_seconds: 10 * 3600, used_seconds: 3 * 3600, pct_used: 30 });
  });

  it('never includes money, and activity stays hidden while that section is off', async () => {
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(JSON.stringify(r.body)).not.toMatch(/amount_minor|rate|invoice|bill_|pay_|currency/);
    expect(r.body.workers.every((x: { activity_pct: number | null }) => x.activity_pct === null)).toBe(true);
  });

  it('respects the project selection and hides sections that are off', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [appId], sections: { tasks: false } });
    const r = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Mobile app']);
    expect(r.body.tasks).toBeNull();
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: null, sections: { tasks: true } });
  });

  it('is closed to other users, revoked viewers and disabled portals, and is audited', async () => {
    expect((await bea.client.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: false });
    expect((await dora.get(`/portal/${doraAccessId}/summary${range}`)).status).toBe(404);
    expect((await dora.get('/me')).body.client_portals).toEqual([]);
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true });
    const audit = await admin.get(o('/audit-logs?action=client_portal.viewed'));
    expect(audit.body.data.some((a: { actor_type: string }) => a.actor_type === 'client')).toBe(true);
  });

  it('lets admins preview exactly what the client sees', async () => {
    const p = await admin.get(o(`/clients/${clientId}/portal/preview${range}`));
    const v = await dora.get(`/portal/${doraAccessId}/summary${range}`);
    expect({ ...p.body, access_id: null }).toEqual({ ...v.body, access_id: null });
  });
});
```

The `manual-time`, `budgets` and `audit-logs` request shapes are the ones used by `test/reports.test.ts` and `test/finance.test.ts`. Keep the field names identical to those tests if they differ from the above.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts -t "portal dashboard"`
Expected: FAIL (404).

- [ ] **Step 3: Add access resolution and the summary to `packages/api/src/services/portal.ts`**

```ts
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  auditLogs,
  clientPortalAccess,
  clientPortalSettings,
  clients,
  DEFAULT_PORTAL_SECTIONS,
  memberships,
  organizations,
  projects,
  rollupWorkerDay,
  taskAssignees,
  tasks,
  timeEntries,
  users,
  withSystem,
  withTenant,
  workerProfiles,
  type ClientPortalSections,
  type Tx,
} from '@tallywork/db';
import { newId, notFound } from '@tallywork/domain';
import type { PortalListItemDto, PortalSummaryDto } from '@tallywork/contracts';
import { budgetStatuses } from './finance';

export interface PortalAccess {
  accessId: string | null;
  organizationId: string;
  clientId: string;
  sections: ClientPortalSections;
  projectIds: string[];
}

/** The included projects: the selection, limited to projects the client still owns. */
export async function includedProjects(tx: Tx, clientId: string, selected: string[] | null): Promise<string[]> {
  const own = (await tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))).map((p) => p.id);
  return selected ? own.filter((id) => selected.includes(id)) : own;
}

export async function listMyPortals(deps: Deps, userId: string): Promise<PortalListItemDto[]> {
  const rows = await withSystem(deps.db, (tx) =>
    tx
      .select({ accessId: clientPortalAccess.id, organizationName: organizations.name, clientName: clients.name })
      .from(clientPortalAccess)
      .innerJoin(organizations, eq(organizations.id, clientPortalAccess.organizationId))
      .innerJoin(clients, eq(clients.id, clientPortalAccess.clientId))
      .innerJoin(clientPortalSettings, and(eq(clientPortalSettings.organizationId, clientPortalAccess.organizationId), eq(clientPortalSettings.clientId, clientPortalAccess.clientId)))
      .where(and(eq(clientPortalAccess.userId, userId), eq(clientPortalAccess.status, 'ACTIVE'), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt))),
  );
  return rows.map((r) => ({ access_id: r.accessId, organization_name: r.organizationName, client_name: r.clientName }));
}

/** Only the viewer's own ACTIVE access to an enabled portal of a non-archived client; anything else is 404. */
export async function loadPortalAccess(deps: Deps, userId: string, accessId: string): Promise<PortalAccess> {
  const [a] = await withSystem(deps.db, (tx) =>
    tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.id, accessId), eq(clientPortalAccess.userId, userId), eq(clientPortalAccess.status, 'ACTIVE'))).limit(1),
  );
  if (!a) throw notFound('dashboard');
  return withTenant(deps.db, a.organizationId, async (tx) => {
    const [s] = await tx.select().from(clientPortalSettings).where(eq(clientPortalSettings.clientId, a.clientId));
    const [c] = await tx.select({ archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, a.clientId));
    if (!s?.enabled || !c || c.archivedAt) throw notFound('dashboard');
    return { accessId: a.id, organizationId: a.organizationId, clientId: a.clientId, sections: { ...DEFAULT_PORTAL_SECTIONS, ...s.sections }, projectIds: await includedProjects(tx, a.clientId, s.projectIds) };
  });
}

export async function logPortalView(tx: Tx, access: PortalAccess, action: string, metadata: Record<string, unknown> = {}) {
  if (!access.accessId) return; // admin preview: the admin's own request is already audited
  await tx.insert(auditLogs).values({ id: newId(), organizationId: access.organizationId, actorType: 'client', actorId: access.accessId, action, targetType: 'client', targetId: access.clientId, metadata });
  await tx.update(clientPortalAccess).set({ lastViewedAt: new Date() }).where(eq(clientPortalAccess.id, access.accessId));
}

export async function portalSummary(deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalSummaryDto> {
  return withTenant(deps.db, access.organizationId, async (tx) => {
    const [org] = await tx.select({ id: organizations.id, name: organizations.name, currency: organizations.currency }).from(organizations).where(eq(organizations.id, access.organizationId));
    const [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, access.clientId));
    const ids = access.projectIds;
    const none = ids.length === 0;
    const projectRows = none ? [] : await tx.select({ id: projects.id, name: projects.name, color: projects.color, status: projects.status }).from(projects).where(inArray(projects.id, ids)).orderBy(projects.name);
    const rollups = none
      ? []
      : await tx
          .select()
          .from(rollupWorkerDay)
          .where(and(inArray(rollupWorkerDay.projectId, ids), gte(rollupWorkerDay.localDate, range.from), lte(rollupWorkerDay.localDate, range.to)));

    const byProject = new Map<string, number>();
    const byDay = new Map<string, number>();
    const byWorker = new Map<string, { tracked: number; manual: number; active: number; activityTracked: number; tasks: Map<string, number> }>();
    const totals = { tracked_seconds: 0, manual_seconds: 0, billable_seconds: 0 };
    for (const r of rollups) {
      const secs = r.trackedSeconds + r.manualSeconds;
      totals.tracked_seconds += r.trackedSeconds;
      totals.manual_seconds += r.manualSeconds;
      if (r.billable) totals.billable_seconds += secs;
      byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + secs);
      byDay.set(r.localDate, (byDay.get(r.localDate) ?? 0) + secs);
      const w = byWorker.get(r.membershipId) ?? { tracked: 0, manual: 0, active: 0, activityTracked: 0, tasks: new Map() };
      w.tracked += r.trackedSeconds;
      w.manual += r.manualSeconds;
      w.active += r.activeSeconds;
      w.activityTracked += r.activityTrackedSeconds;
      w.tasks.set(r.taskKey, (w.tasks.get(r.taskKey) ?? 0) + secs);
      byWorker.set(r.membershipId, w);
    }

    const taskRows = none
      ? []
      : await tx
          .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, estimateSeconds: tasks.estimateSeconds })
          .from(tasks)
          .where(and(inArray(tasks.projectId, ids), isNull(tasks.archivedAt)))
          .orderBy(tasks.status, tasks.dueDate);
    const taskTitle = new Map(taskRows.map((t) => [t.id, t.title]));

    const assigneeRows = taskRows.length
      ? await tx.select({ taskId: taskAssignees.taskId, membershipId: taskAssignees.membershipId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskRows.map((t) => t.id)))
      : [];
    const people = [...new Set([...byWorker.keys(), ...assigneeRows.map((a) => a.membershipId)])];
    const names = people.length
      ? await tx
          .select({ id: memberships.id, name: users.name, title: workerProfiles.title })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .leftJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
          .where(inArray(memberships.id, people))
      : [];
    const person = new Map(names.map((n) => [n.id, n]));

    // Time per task over the whole project history (progress vs estimate), not only the range.
    const taskTime = taskRows.length
      ? await tx
          .select({ taskId: timeEntries.taskId, secs: sql<number>`coalesce(sum(${timeEntries.durationSeconds}), 0)::int` })
          .from(timeEntries)
          .where(and(inArray(timeEntries.taskId, taskRows.map((t) => t.id)), isNull(timeEntries.deletedAt)))
          .groupBy(timeEntries.taskId)
      : [];
    const trackedByTask = new Map(taskTime.map((t) => [t.taskId, t.secs]));

    const budgets = (await budgetStatuses(tx, org!.currency, range.to, { subjectIds: ids })).filter((b) => b.kind === 'HOURS' && b.subject_type === 'PROJECT');
    const budgetOf = new Map(budgets.map((b) => [b.subject_id, { amount_seconds: b.amount, used_seconds: b.spent, pct_used: b.pct_used }]));

    const s = access.sections;
    await logPortalView(tx, access, 'client_portal.viewed', { from: range.from, to: range.to });
    return {
      access_id: access.accessId,
      organization: { id: org!.id, name: org!.name },
      client: { id: client!.id, name: client!.name },
      sections: s,
      range,
      totals,
      projects: projectRows.map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status, tracked_seconds: byProject.get(p.id) ?? 0, budget: s.tasks ? (budgetOf.get(p.id) ?? null) : null })),
      workers: s.hours
        ? [...byWorker.entries()]
            .map(([id, w]) => ({
              membership_id: id,
              name: person.get(id)?.name ?? 'Former member',
              title: person.get(id)?.title ?? null,
              tracked_seconds: w.tracked,
              manual_seconds: w.manual,
              activity_pct: s.activity && w.activityTracked > 0 ? Math.round((w.active / w.activityTracked) * 100) : null,
              tasks: [...w.tasks.entries()].map(([key, seconds]) => ({ task_id: key || null, title: key ? (taskTitle.get(key) ?? 'Archived task') : 'No task', seconds })).sort((a, b) => b.seconds - a.seconds),
            }))
            .sort((a, b) => b.tracked_seconds + b.manual_seconds - (a.tracked_seconds + a.manual_seconds))
        : null,
      days: s.hours ? [...byDay.entries()].map(([date, seconds]) => ({ date, seconds })).sort((a, b) => a.date.localeCompare(b.date)) : null,
      tasks: s.tasks
        ? taskRows.map((t) => ({
            id: t.id,
            project_id: t.projectId,
            title: t.title,
            status: t.status,
            priority: t.priority,
            due_date: t.dueDate,
            estimate_seconds: t.estimateSeconds,
            tracked_seconds: trackedByTask.get(t.id) ?? 0,
            assignees: assigneeRows.filter((a) => a.taskId === t.id).map((a) => person.get(a.membershipId)?.name ?? 'Former member'),
          }))
        : null,
    };
  });
}
```

`import type { Deps } from '../context';` is already imported from Task 4. If `tasks.archivedAt` does not exist, drop that condition (check `packages/db/src/schema/workforce.ts:119-141`).

- [ ] **Step 4: Add the admin preview helper** (`packages/api/src/services/portal-admin.ts`)

```ts
import { includedProjects, type PortalAccess } from './portal';

/** The access object the client would get, for "Preview as client" (no viewer, so no client audit row). */
export async function previewAccess(x: Ctx, clientId: string): Promise<PortalAccess> {
  assertManager(x);
  await loadClient(x, clientId);
  const s = await settingsRow(x, clientId);
  return { accessId: null, organizationId: x.org.id, clientId, sections: { ...DEFAULT_PORTAL_SECTIONS, ...s.sections }, projectIds: await includedProjects(x.tx, clientId, s.projectIds) };
}
```

- [ ] **Step 5: Add the routes**

`packages/api/src/routes/portal.ts`: add after the accept route, and import `z` from `zod`, `query` from `../lib/http`, `portalRangeInput`, and `listMyPortals`, `loadPortalAccess`, `portalSummary`.

```ts
  .use(rateLimit('portal', 120, 60))
  .get('/', async (c) => c.json(await listMyPortals(c.var.deps, viewer(c))))
  .get('/:accessId/summary', async (c) => {
    const access = await loadPortalAccess(c.var.deps, viewer(c), z.uuid().parse(c.req.param('accessId')));
    return c.json(await portalSummary(c.var.deps, access, query(c, portalRangeInput)));
  });
```

At the top of the file:

```ts
import { DomainError } from '@tallywork/domain';

function viewer(c: Context<AppEnv>): string {
  const p = c.var.principal;
  // MFA-pending sessions are already limited to the two MFA paths by middleware/auth.ts.
  if (!p || p.type !== 'user') throw new DomainError('unauthenticated', 'unauthenticated', 'Please sign in to continue');
  return p.userId;
}
```

`packages/api/src/routes/org.ts`:

```ts
  .get('/clients/:id/portal/preview', requirePermission('clients:manage'), async (c) =>
    c.json(await portalSummary(c.var.deps, await previewAccess(ctx(c), c.req.param('id')), query(c, portalRangeInput))),
  )
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src packages/api/test/portal.test.ts
git commit -m "feat(api): client portal dashboard (hours, workers, tasks, hour budgets) and admin preview"
```

---

### Task 6: Screenshots section

**Files:**
- Modify: `packages/api/src/services/portal.ts`, `packages/api/src/routes/portal.ts`, `packages/api/src/routes/org.ts`
- Test: `packages/api/test/portal.test.ts` (extend)

**Interfaces:**
- Consumes: `mediaUrl(x: Pick<Ctx, 'deps' | 'org'>, storageKey, variant)` from `services/activity.ts`; `loadOrg` from `middleware/tenant.ts`.
- Produces:
  - `portalScreenshots(deps: Deps, access: PortalAccess, range): Promise<PortalScreenshotDto[]>` (at most 200, newest first)
  - Routes: `GET /portal/:accessId/screenshots?from&to`, `GET /orgs/:orgId/clients/:id/portal/preview/screenshots?from&to`.

- [ ] **Step 1: Write the failing tests** (append; the screenshot is created through the desktop agent flow exactly as `test/agent-me.test.ts:53-69` does)

```ts
import { newId } from '@tallywork/domain';
import { pkce } from './harness';

describe('portal screenshots', () => {
  let shotOnClient: string;
  beforeAll(async () => {
    await admin.put(o(`/policies/ORG/${orgId}`), { screenshots: { enabled: true, perTenMinutes: 1 } });
    const { verifier, challenge } = pkce();
    const code = await walt.client.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
    const agent = new Client(t);
    agent.bearer = (await agent.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Walt-PC', platform: 'windows', agent_version: '0.1.0' } })).body.access_token;
    const session = newId();
    const start = new Date(t.clock.now);
    const at = (ms: number) => new Date(start.getTime() + ms).toISOString();
    await agent.post('/agent/ingest/batch', { sent_at: at(0), events: [{ event_id: newId(), type: 'session.start', session_id: session, seq: 1, occurred_at: at(0), project_id: siteId }] });
    t.clock.advance(5 * 60_000);
    shotOnClient = newId();
    const intent = await agent.post('/agent/screenshots/upload-intent', { screenshot_id: shotOnClient, session_id: session, captured_at: at(5 * 60_000), content_type: 'image/webp', bytes: 4 });
    await agent.post('/agent/ingest/batch', { sent_at: at(5 * 60_000), events: [{ event_id: newId(), type: 'screenshot.captured', session_id: session, occurred_at: at(5 * 60_000), screenshot_id: shotOnClient, captured_at: at(5 * 60_000), display_index: 0, blurred: false, width: 1920, height: 1080, bytes: 4, sha256: 'a'.repeat(64), storage_key: intent.body.storage_key }] });
    t.clock.advance(10 * 60_000);
    await agent.post('/agent/ingest/batch', { sent_at: at(15 * 60_000), events: [{ event_id: newId(), type: 'session.stop', session_id: session, seq: 2, occurred_at: at(15 * 60_000) }] });
    await t.flush();
  });

  const today = () => t.clock.now.toISOString().slice(0, 10);

  it('is refused while the section is off', async () => {
    expect((await dora.get(`/portal/${doraAccessId}/screenshots?from=${today()}&to=${today()}`)).status).toBe(403);
  });

  it('shows screenshots from time on the client’s projects, with signed media links, and logs the view', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { sections: { screenshots: true } });
    const r = await dora.get(`/portal/${doraAccessId}/screenshots?from=${today()}&to=${today()}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ id: shotOnClient, worker_name: 'Walt', project_id: siteId, full_url: expect.stringMatching(/\/api\/v1\/media\//) })]);
    const log = await admin.get(o('/audit-logs?action=client_portal.screenshots_viewed'));
    expect(log.body.data[0]).toMatchObject({ actor_type: 'client' });
  });

  it('never shows them when the project is not included', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: [appId] });
    const r = await dora.get(`/portal/${doraAccessId}/screenshots?from=${today()}&to=${today()}`);
    expect(r.body).toEqual([]);
    await admin.put(o(`/clients/${clientId}/portal`), { project_ids: null, sections: { screenshots: false } });
  });
});
```

Move the two new imports to the top of the file with the others.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts -t "portal screenshots"`
Expected: FAIL (404).

- [ ] **Step 3: Implement `portalScreenshots`** (add to `services/portal.ts`; add `screenshots`, `desc`, `forbidden` and `PortalScreenshotDto` to the imports)

```ts
import { mediaUrl } from './activity';
import { loadOrg } from '../middleware/tenant';

/** Screenshots captured while the worker tracked time on one of the client's included projects. */
export async function portalScreenshots(deps: Deps, access: PortalAccess, range: { from: string; to: string }): Promise<PortalScreenshotDto[]> {
  if (!access.sections.screenshots) throw forbidden('Screenshots are not shared on this dashboard');
  if (!access.projectIds.length) return [];
  return withTenant(deps.db, access.organizationId, async (tx) => {
    const org = await loadOrg(tx, access.organizationId);
    const rows = await tx
      .select({ id: screenshots.id, capturedAt: screenshots.capturedAt, storageKey: screenshots.storageKey, blurred: screenshots.blurred, projectId: timeEntries.projectId, worker: users.name })
      .from(screenshots)
      .innerJoin(
        timeEntries,
        and(
          eq(timeEntries.sessionId, screenshots.sessionId),
          isNull(timeEntries.deletedAt),
          lte(timeEntries.startedAt, screenshots.capturedAt),
          gte(timeEntries.endedAt, screenshots.capturedAt),
          inArray(timeEntries.projectId, access.projectIds),
        ),
      )
      .innerJoin(memberships, eq(memberships.id, screenshots.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(isNull(screenshots.deletedAt), gte(timeEntries.localDate, range.from), lte(timeEntries.localDate, range.to)))
      .orderBy(desc(screenshots.capturedAt))
      .limit(200);
    const media = { deps, org };
    await logPortalView(tx, access, 'client_portal.screenshots_viewed', { count: rows.length, from: range.from, to: range.to });
    return rows.map((s) => ({ id: s.id, captured_at: s.capturedAt.toISOString(), worker_name: s.worker, project_id: s.projectId, blurred: s.blurred, thumb_url: mediaUrl(media, s.storageKey, 'thumb'), full_url: mediaUrl(media, s.storageKey) }));
  });
}
```

- [ ] **Step 4: Add the routes**

`routes/portal.ts`:

```ts
  .get('/:accessId/screenshots', async (c) => {
    const access = await loadPortalAccess(c.var.deps, viewer(c), z.uuid().parse(c.req.param('accessId')));
    return c.json(await portalScreenshots(c.var.deps, access, query(c, portalRangeInput)));
  })
```

`routes/org.ts`:

```ts
  .get('/clients/:id/portal/preview/screenshots', requirePermission('clients:manage'), async (c) =>
    c.json(await portalScreenshots(c.var.deps, await previewAccess(ctx(c), c.req.param('id')), query(c, portalRangeInput))),
  )
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src packages/api/test/portal.test.ts
git commit -m "feat(api): client portal screenshots (opt-in per client, audited)"
```

---

### Task 7: Worker transparency API

**Files:**
- Modify: `packages/api/src/services/portal.ts`, `packages/api/src/routes/time.ts` (or the file holding `/me/*` org routes), `packages/api/src/services/agent-me.ts`, `packages/api/src/routes/agent.ts`, `apps/desktop/src/shared/ipc.ts` (`ME_RESOURCES`)
- Test: `packages/api/test/portal.test.ts` (extend)

**Interfaces:**
- Produces:
  - `clientVisibilityFor(tx: Tx, membershipId: string): Promise<ClientVisibilityDto>`
  - `GET /orgs/:orgId/me/client-visibility` (web)
  - `GET /agent/me/client-visibility` (desktop; add `'client-visibility'` to `ME_RESOURCES`)

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('worker transparency', () => {
  it('tells a worker which clients can see their activity or screenshots', async () => {
    await admin.put(o(`/clients/${clientId}/portal`), { enabled: true, sections: { activity: true, screenshots: false } });
    const r = await walt.client.get(o('/me/client-visibility'));
    expect(r.body).toEqual({ clients: [{ client_name: 'Acme', activity: true, screenshots: false }] });
    const none = await admin.get(o('/me/client-visibility'));
    expect(none.body).toEqual({ clients: [] });
  });
});
```

Walt has time on Acme's projects. The admin has none, so their list is empty.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts -t "worker transparency"`
Expected: FAIL (404).

- [ ] **Step 3: Implement** (`services/portal.ts`)

```ts
/** Clients whose enabled portal shares activity or screenshots from projects this worker has time on. */
export async function clientVisibilityFor(tx: Tx, membershipId: string): Promise<ClientVisibilityDto> {
  const rows = await tx
    .selectDistinct({ clientId: clients.id, clientName: clients.name, sections: clientPortalSettings.sections, projectIds: clientPortalSettings.projectIds, projectId: rollupWorkerDay.projectId })
    .from(rollupWorkerDay)
    .innerJoin(projects, eq(projects.id, rollupWorkerDay.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(clientPortalSettings, eq(clientPortalSettings.clientId, clients.id))
    .where(and(eq(rollupWorkerDay.membershipId, membershipId), eq(clientPortalSettings.enabled, true), isNull(clients.archivedAt)));
  const out = new Map<string, { client_name: string; activity: boolean; screenshots: boolean }>();
  for (const r of rows) {
    if (r.projectIds && !r.projectIds.includes(r.projectId)) continue;
    const s = { ...DEFAULT_PORTAL_SECTIONS, ...r.sections };
    if (!s.activity && !s.screenshots) continue;
    out.set(r.clientId, { client_name: r.clientName, activity: s.activity, screenshots: s.screenshots });
  }
  return { clients: [...out.values()].sort((a, b) => a.client_name.localeCompare(b.client_name)) };
}
```

Web route (next to the other `/me/*` org routes):

```ts
  .get('/me/client-visibility', async (c) => c.json(await clientVisibilityFor(c.var.tx, c.var.actor.membershipId)))
```

Desktop: in `services/agent-me.ts`, add a `'client-visibility'` resource that calls `clientVisibilityFor(tx, device.membershipId)`, following how the existing resources are dispatched there. In `routes/agent.ts`, expose it at `GET /agent/me/client-visibility`. In `apps/desktop/src/shared/ipc.ts`, append `'client-visibility'` to `ME_RESOURCES`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tallywork/api exec vitest run test/portal.test.ts test/agent-me.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src packages/api/test/portal.test.ts apps/desktop/src/shared/ipc.ts
git commit -m "feat(api): workers can see which clients view their activity or screenshots"
```

---

### Task 8: Web, invitation page and routing for portal-only users

**Files:**
- Create: `apps/web/app/portal-invite/page.tsx`, `apps/web/app/portal/page.tsx`
- Modify: `apps/web/app/page.tsx`, `apps/web/app/(auth)/login/page.tsx` (`finish`), `apps/web/messages/en.ts`

**Interfaces:**
- Consumes: `POST /portal/invitations/accept`, `GET /portal`, `MeDto.client_portals`.

- [ ] **Step 1: Add the copy** (`apps/web/messages/en.ts`)

```ts
  'portal.invite.title': 'Open your project dashboard',
  'portal.invite.subtitle': 'Create your WorkPulse account to follow the work on your projects.',
  'portal.invite.submit': 'Open dashboard',
  'portal.list.title': 'Your dashboards',
  'portal.list.empty': 'You do not have access to any dashboards yet. Ask the organization you work with to invite you.',
```

- [ ] **Step 2: Create `apps/web/app/portal-invite/page.tsx`** (modelled on `apps/web/app/(auth)/invite/page.tsx`)

```tsx
'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

function Form() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ access_id: string }>('/portal/invitations/accept', { body: { token, name: name || undefined, password: password || undefined } });
          router.replace(`/portal/${r.access_id}`);
        } catch (err) {
          const e2 = err instanceof ApiError ? err : new ApiError(500, 'error', t('auth.invite.failed'));
          if (e2.code === 'login_required') return router.replace(`/login?next=${encodeURIComponent(`/portal-invite?token=${token}`)}`);
          setError(e2);
          setLoading(false);
        }
      }}
    >
      <Field label={t('auth.yourName')} htmlFor="name">
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      </Field>
      <Field label={t('auth.invite.choosePassword')} htmlFor="pw" hint={t('auth.passwordHint')} error={error?.field('password')}>
        <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && !error.errors && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error.title}
        </p>
      )}
      <Button type="submit" variant="primary" size="md" loading={loading}>
        {t('portal.invite.submit')}
      </Button>
    </form>
  );
}

export default function PortalInvitePage() {
  return (
    <AuthShell title={t('portal.invite.title')} subtitle={t('portal.invite.subtitle')}>
      <Suspense>
        <Form />
      </Suspense>
    </AuthShell>
  );
}
```

When the signed-in person comes back via `/login?next=/portal-invite?token=…`, the same page posts with their session cookie and the API links the existing account.

- [ ] **Step 3: Create `apps/web/app/portal/page.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { PortalListItemDto } from '@tallywork/contracts';
import { Spinner } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function PortalListPage() {
  const { data } = useQuery({ queryKey: ['portal', 'list'], queryFn: () => api<PortalListItemDto[]>('/portal') });
  return (
    <AuthShell title={t('portal.list.title')}>
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-text-muted">{t('portal.list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((p) => (
            <li key={p.access_id}>
              <Link href={`/portal/${p.access_id}`} className="block rounded-sm border border-border px-3 py-2 hover:bg-surface-muted">
                <span className="font-medium">{p.client_name}</span>
                <span className="block text-xs text-text-muted">{p.organization_name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 4: Route portal-only users** (`apps/web/app/page.tsx` and the login page's `finish`)

In `apps/web/app/page.tsx`, replace `router.replace(target ? \`/o/${target.id}\` : '/welcome');` with:

```ts
        // Client viewers have no organization of their own: they go to their dashboards.
        router.replace(target ? `/o/${target.id}` : me.client_portals.length ? (me.client_portals.length === 1 ? `/portal/${me.client_portals[0]!.access_id}` : '/portal') : '/welcome');
```

In `apps/web/app/(auth)/login/page.tsx`, `finish(me)`, change the fallback `'/welcome'` in the same way (`next` still wins).

- [ ] **Step 5: Typecheck and try it**

Run: `pnpm --filter @tallywork/web typecheck`
Expected: PASS. Then `pnpm dev`. As an admin, invite a viewer through the API (Task 10 adds the UI), open the `invite_url` from the dev console mail log, create the account, and land on `/portal/<id>`. That page is a 404 until Task 9.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/portal-invite apps/web/app/portal/page.tsx apps/web/app/page.tsx "apps/web/app/(auth)/login/page.tsx" apps/web/messages/en.ts
git commit -m "feat(web): client portal invitation page and dashboard list"
```

---

### Task 9: Web, the client dashboard

**Files:**
- Create: `apps/web/components/portal/portal-dashboard.tsx`, `apps/web/app/portal/[accessId]/page.tsx`
- Modify: `apps/web/messages/en.ts`

**Interfaces:**
- Consumes: `PortalSummaryDto`, `PortalScreenshotDto`; `GET /portal/:accessId/summary`, `GET /portal/:accessId/screenshots`.
- Produces: `<PortalDashboard summary={PortalSummaryDto} screenshots={PortalScreenshotDto[] | null} range onRange />`, reused by the admin preview (Task 10).

- [ ] **Step 1: Add the copy**

```ts
  'portal.dash.range': 'Period',
  'portal.dash.total': 'Hours this period',
  'portal.dash.billable': 'Billable',
  'portal.dash.projects': 'Projects',
  'portal.dash.budget': '{used} of {amount} hours ({pct}%)',
  'portal.dash.workers': 'People on your projects',
  'portal.dash.activity': 'Activity',
  'portal.dash.tasks': 'Tasks',
  'portal.dash.estimate': '{tracked} of {estimate}',
  'portal.dash.screenshots': 'Screenshots',
  'portal.dash.noTime': 'No time was recorded on your projects in this period.',
  'portal.status.TODO': 'To do',
  'portal.status.IN_PROGRESS': 'In progress',
  'portal.status.DONE': 'Done',
```

- [ ] **Step 2: Create `apps/web/components/portal/portal-dashboard.tsx`**

```tsx
'use client';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { BrandLockup } from '@tallywork/ui';
import { t } from '@/lib/i18n';

const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PortalDashboard({ summary: s, screenshots, range, onRange }: { summary: PortalSummaryDto; screenshots: PortalScreenshotDto[] | null; range: { from: string; to: string }; onRange: (r: { from: string; to: string }) => void }) {
  const total = s.totals.tracked_seconds + s.totals.manual_seconds;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <BrandLockup size={28} />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{s.client.name}</h1>
          <p className="text-sm text-text-muted">{s.organization.name}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {t('portal.dash.range')}
          <input type="date" value={range.from} max={range.to} onChange={(e) => onRange({ ...range, from: e.target.value })} className="rounded-sm border border-border bg-surface px-2 py-1" />
          <input type="date" value={range.to} min={range.from} onChange={(e) => onRange({ ...range, to: e.target.value })} className="rounded-sm border border-border bg-surface px-2 py-1" />
        </label>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t('portal.dash.total')}>
          <p className="text-3xl font-semibold tabular">{hours(total)}</p>
          <p className="text-xs text-text-muted">
            {t('portal.dash.billable')}: {hours(s.totals.billable_seconds)}
          </p>
        </Card>
        <Card title={t('portal.dash.projects')}>
          <ul className="flex flex-col gap-2 text-sm">
            {s.projects.map((p) => (
              <li key={p.id}>
                <div className="flex justify-between">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
                    {p.name}
                  </span>
                  <span className="tabular">{hours(p.tracked_seconds)}</span>
                </div>
                {p.budget && (
                  <>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={p.budget.pct_used} aria-valuemin={0} aria-valuemax={100}>
                      <div className={`h-full ${p.budget.pct_used >= 100 ? 'bg-danger' : p.budget.pct_used >= 80 ? 'bg-warning' : 'bg-interactive'}`} style={{ width: `${Math.min(100, p.budget.pct_used)}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">{t('portal.dash.budget', { used: (p.budget.used_seconds / 3600).toFixed(1), amount: (p.budget.amount_seconds / 3600).toFixed(1), pct: p.budget.pct_used })}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {s.workers && (
        <Card title={t('portal.dash.workers')}>
          {s.workers.length === 0 ? (
            <p className="text-sm text-text-muted">{t('portal.dash.noTime')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {s.workers.map((w) => (
                  <tr key={w.membership_id} className="border-t border-border align-top first:border-t-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{w.name}</span>
                      {w.title && <span className="block text-xs text-text-muted">{w.title}</span>}
                      <ul className="mt-1 text-xs text-text-muted">
                        {w.tasks.slice(0, 5).map((k) => (
                          <li key={k.task_id ?? 'none'}>
                            {k.title}: {hours(k.seconds)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2 text-right tabular">{hours(w.tracked_seconds + w.manual_seconds)}</td>
                    {s.sections.activity && (
                      <td className="py-2 pl-3 text-right tabular" title={t('portal.dash.activity')}>
                        {w.activity_pct === null ? '—' : `${w.activity_pct}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {s.tasks && (
        <Card title={t('portal.dash.tasks')}>
          <ul className="divide-y divide-border text-sm">
            {s.tasks.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{k.title}</span>
                  <span className="block text-xs text-text-muted">
                    {t(`portal.status.${k.status}` as 'portal.status.TODO')}
                    {k.due_date ? ` · ${k.due_date}` : ''}
                    {k.assignees.length ? ` · ${k.assignees.join(', ')}` : ''}
                  </span>
                </span>
                <span className="tabular text-xs text-text-muted">{k.estimate_seconds ? t('portal.dash.estimate', { tracked: hours(k.tracked_seconds), estimate: hours(k.estimate_seconds) }) : hours(k.tracked_seconds)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {screenshots && (
        <Card title={t('portal.dash.screenshots')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {screenshots.map((sh) => (
              <a key={sh.id} href={sh.full_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
                <img src={sh.thumb_url} alt={`${sh.worker_name}, ${new Date(sh.captured_at).toLocaleString()}`} className="aspect-video w-full object-cover" loading="lazy" />
                <span className="block px-2 py-1 text-xs text-text-muted">
                  {sh.worker_name}
                  {' · '}
                  {new Date(sh.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/portal/[accessId]/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { ErrorState, Spinner } from '@tallywork/ui';
import { PortalDashboard } from '@/components/portal/portal-dashboard';
import { api } from '@/lib/api';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PortalPage() {
  const { accessId } = useParams<{ accessId: string }>();
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()) }));
  const qs = `?from=${range.from}&to=${range.to}`;
  const summary = useQuery({ queryKey: ['portal', accessId, 'summary', range], queryFn: () => api<PortalSummaryDto>(`/portal/${accessId}/summary${qs}`) });
  const shots = useQuery({ queryKey: ['portal', accessId, 'screenshots', range], queryFn: () => api<PortalScreenshotDto[]>(`/portal/${accessId}/screenshots${qs}`), enabled: !!summary.data?.sections.screenshots });
  if (summary.error) return <div className="flex min-h-dvh items-center justify-center"><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></div>;
  if (!summary.data) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>;
  return <PortalDashboard summary={summary.data} screenshots={summary.data.sections.screenshots ? (shots.data ?? []) : null} range={range} onRange={setRange} />;
}
```

- [ ] **Step 4: Check it in the browser**

Run `pnpm dev`, sign in as the viewer from Task 8, and open `/portal/<accessId>`. Check at 1440 px and 390 px wide, in light and dark mode:
- the lockup and client name show at the top;
- hours, projects and budget bars show;
- people are listed with their tasks, plus an Activity column only when that section is on;
- tasks show status and time against the estimate;
- screenshots show only when that section is on.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @tallywork/web typecheck` (expected PASS)

```bash
git add apps/web/components/portal apps/web/app/portal apps/web/messages/en.ts
git commit -m "feat(web): client dashboard (hours, people, tasks, optional activity and screenshots)"
```

---

### Task 10: Web, admin settings with Preview as client

**Files:**
- Create: `apps/web/app/o/[orgId]/clients/[id]/portal/page.tsx`
- Modify: `apps/web/app/o/[orgId]/clients/page.tsx` (link per row), `apps/web/messages/en.ts`

**Interfaces:**
- Consumes:
  - `GET|PUT /orgs/:orgId/clients/:id/portal`
  - `POST …/portal/invitations`
  - `DELETE …/portal/access/:accessId`
  - `GET …/portal/preview` and `…/preview/screenshots`
  - `<PortalDashboard>` (Task 9)

- [ ] **Step 1: Add the copy**

```ts
  'portal.admin.title': 'Client portal',
  'portal.admin.description': 'A read-only dashboard for this client: who works on their projects, hours per task and task progress. Money is never shown.',
  'portal.admin.enabled': 'Portal on',
  'portal.admin.sections': 'What the client sees',
  'portal.admin.hours': 'Hours per person, task and day',
  'portal.admin.tasks': 'Task progress and hour budgets',
  'portal.admin.activity': 'Activity level of each person',
  'portal.admin.screenshots': 'Screenshots taken on this client’s projects',
  'portal.admin.monitoringNote': 'People working on this client’s projects are told when their activity or screenshots are shared.',
  'portal.admin.projects': 'Projects included',
  'portal.admin.allProjects': 'All projects of this client, including new ones',
  'portal.admin.viewers': 'People with access',
  'portal.admin.invite': 'Invite',
  'portal.admin.revoke': 'Revoke',
  'portal.admin.preview': 'Preview as client',
```

- [ ] **Step 2: Create the page** (`apps/web/app/o/[orgId]/clients/[id]/portal/page.tsx`)

```tsx
'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientPortalSettingsDto, PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { Button, Field, Input, PageHeader, Spinner } from '@tallywork/ui';
import { PortalDashboard } from '@/components/portal/portal-dashboard';
import { api, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Section = 'hours' | 'tasks' | 'activity' | 'screenshots';

export default function ClientPortalSettingsPage() {
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const base = `/orgs/${orgId}/clients/${id}/portal`;
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['portal-admin', id], queryFn: () => api<ClientPortalSettingsDto>(base) });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<ClientPortalSettingsDto>(base, { method: 'PUT', body: patch }),
    onSuccess: (d) => {
      qc.setQueryData(['portal-admin', id], d);
      void qc.invalidateQueries({ queryKey: ['portal-admin', id, 'preview'] });
    },
  });
  const [email, setEmail] = useState('');
  const invite = useMutation({
    mutationFn: () => api(`${base}/invitations`, { body: { email } }),
    onSuccess: () => {
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['portal-admin', id] });
    },
  });
  const revoke = useMutation({ mutationFn: (accessId: string) => api(`${base}/access/${accessId}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-admin', id] }) });
  const [preview, setPreview] = useState(false);
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()) }));
  const qs = `?from=${range.from}&to=${range.to}`;
  const summary = useQuery({ queryKey: ['portal-admin', id, 'preview', range], queryFn: () => api<PortalSummaryDto>(`${base}/preview${qs}`), enabled: preview });
  const shots = useQuery({ queryKey: ['portal-admin', id, 'preview', 'shots', range], queryFn: () => api<PortalScreenshotDto[]>(`${base}/preview/screenshots${qs}`), enabled: preview && !!summary.data?.sections.screenshots });

  const s = settings.data;
  if (!s) return <Spinner />;
  const toggle = (k: Section) => save.mutate({ sections: { [k]: !s.sections[k] } });
  const disabled = (k: Section) => (k === 'activity' && !s.can_enable.activity && !s.sections.activity) || (k === 'screenshots' && !s.can_enable.screenshots && !s.sections.screenshots);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('portal.admin.title')} description={t('portal.admin.description')} actions={<Button onClick={() => setPreview((p) => !p)}>{t('portal.admin.preview')}</Button>} />
      {save.error && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{errorMessage(save.error)}</p>}
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={s.enabled} onChange={() => save.mutate({ enabled: !s.enabled })} />
        {t('portal.admin.enabled')}
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{t('portal.admin.sections')}</legend>
        {(['hours', 'tasks', 'activity', 'screenshots'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.sections[k]} disabled={disabled(k)} onChange={() => toggle(k)} />
            {t(`portal.admin.${k}`)}
          </label>
        ))}
        <p className="text-xs text-text-muted">{t('portal.admin.monitoringNote')}</p>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{t('portal.admin.projects')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.project_ids === null} onChange={() => save.mutate({ project_ids: s.project_ids === null ? s.projects.map((p) => p.id) : null })} />
          {t('portal.admin.allProjects')}
        </label>
        {s.project_ids !== null &&
          s.projects.map((p) => (
            <label key={p.id} className="ml-6 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.project_ids!.includes(p.id)} onChange={() => save.mutate({ project_ids: s.project_ids!.includes(p.id) ? s.project_ids!.filter((x) => x !== p.id) : [...s.project_ids!, p.id] })} />
              {p.name}
            </label>
          ))}
      </fieldset>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t('portal.admin.viewers')}</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <Field label="Email" htmlFor="portal-email" error={invite.error ? errorMessage(invite.error) : undefined}>
            <Input id="portal-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={invite.isPending} className="self-end">{t('portal.admin.invite')}</Button>
        </form>
        <ul className="divide-y divide-border text-sm">
          {s.access.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>{a.name ?? a.email} <span className="text-xs text-text-muted">{a.email} · {a.status}</span></span>
              {a.status !== 'REVOKED' && <Button size="xs" variant="ghost" onClick={() => revoke.mutate(a.id)}>{t('portal.admin.revoke')}</Button>}
            </li>
          ))}
        </ul>
      </section>
      {preview && (summary.data ? <div className="rounded-md border border-dashed border-border"><PortalDashboard summary={summary.data} screenshots={summary.data.sections.screenshots ? (shots.data ?? []) : null} range={range} onRange={setRange} /></div> : <Spinner />)}
    </div>
  );
}
```

If `PageHeader` has no `actions` prop, place the Preview button next to it, following how other pages in `apps/web/app/o/[orgId]/` add header buttons.

- [ ] **Step 3: Link it from the clients list** (`apps/web/app/o/[orgId]/clients/page.tsx`)

In each client's row actions, add a link shown only to people who can manage clients:

```tsx
<Link href={`/o/${orgId}/clients/${c.id}/portal`} className="text-sm text-interactive hover:underline">
  {t('portal.admin.title')}
</Link>
```

- [ ] **Step 4: Check it in the browser**

As an admin in `pnpm dev`, run through this list:
- switch the portal on;
- toggle sections: a manager sees Activity and Screenshots disabled;
- choose projects;
- invite an email, then revoke it;
- open **Preview as client** and compare it with the viewer's `/portal/<id>`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @tallywork/web typecheck` (expected PASS)

```bash
git add "apps/web/app/o/[orgId]/clients" apps/web/messages/en.ts
git commit -m "feat(web): client portal settings, viewers and preview for admins"
```

---

### Task 11: Worker notices (web and desktop) and documentation

**Files:**
- Modify:
  - `apps/web/app/o/[orgId]/me/monitoring/page.tsx`
  - `apps/desktop/src/renderer/src/App.tsx` (the `Monitoring` component)
  - `apps/web/messages/en.ts`
  - `docs/plan/08-decisions.md` (ADR-133)
  - `docs/api/README.md`
  - `README.md` (feature list)
  - `docs/plan/05-security-api.md` (visibility matrix: a Client viewer column)

**Interfaces:**
- Consumes: `GET /orgs/:orgId/me/client-visibility`, desktop `bridge.me('client-visibility')` → `ClientVisibilityDto`.

- [ ] **Step 1: Web notice.** In `me/monitoring/page.tsx`, fetch `/orgs/${orgId}/me/client-visibility` with `useQuery`, and when `clients.length > 0` render under the header:

```tsx
<p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">
  {t('portal.visibility.web', { clients: v.clients.map((c) => `${c.client_name} (${[c.activity && t('portal.visibility.activity'), c.screenshots && t('portal.visibility.screenshots')].filter(Boolean).join(', ')})`).join('; ') })}
</p>
```

with copy:

```ts
  'portal.visibility.web': 'Clients can see some of your monitoring data from time on their projects: {clients}.',
  'portal.visibility.activity': 'activity level',
  'portal.visibility.screenshots': 'screenshots',
```

- [ ] **Step 2: Desktop notice.** In `App.tsx` `Monitoring`, load `bridge.me<ClientVisibilityDto>('client-visibility')` in a `useEffect` and, when non-empty, render the same sentence in the warning style the Wayland notice uses, just above it.

- [ ] **Step 3: Docs.**
  - `08-decisions.md`: add **ADR-133 Client portal**, covering these points:
    - viewers are users with `client_portal_access`, never members;
    - `/portal` is resolved with `withSystem`, then `withTenant`;
    - four sections per client (monitoring off by default, and only people with org-wide monitoring access can turn it on);
    - no money;
    - screenshots come only from time on included projects, through signed media;
    - `actor_type='client'` audit;
    - workers are notified.
  - `docs/api/README.md`: list the `/portal/*` and `/orgs/:orgId/clients/:id/portal*` endpoints and `GET /orgs/:orgId/me/client-visibility`.
  - `docs/plan/05-security-api.md`: add a "Client viewer" column to the visibility matrix: Projects R (included), Tasks R (if tasks), Time R (if hours), Activity R (if enabled), Screenshots R (if enabled), everything else none.
  - `README.md`: one line under features.

- [ ] **Step 4: Full verification**

Run:
```bash
pnpm -r --filter "./packages/*" --filter @tallywork/web typecheck
pnpm --filter @tallywork/domain --filter @tallywork/ui --filter @tallywork/db --filter @tallywork/api test
cd apps/desktop && npx tsc -p tsconfig.node.json && npx tsc -p tsconfig.web.json && npx vitest run
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/desktop/src docs README.md
git commit -m "feat: tell workers which clients see their data; document the client portal (ADR-133)"
```

---

## Self-review

- **Spec coverage:** decision 1 (invited accounts) is Tasks 3, 4 and 8. Decision 2 (sections) is Tasks 5, 6 and 9. Decision 3 (no money) is Task 5's test and hour-only budgets. Decision 4 (per-client settings and preview) is Tasks 3, 5 and 10. Decision 5 (worker notice) is Tasks 7 and 11. The Global Constraints are covered by tests in Tasks 3 to 7 (isolation, revocation, disabled portal, project moved or deselected, money keys, monitoring permission, audit rows).
- **Known follow-ups (out of scope):**
  - portal 2FA enforcement;
  - resending invitations (revoke and re-invite works today);
  - client-branded portals;
  - weekly email summary to clients;
  - a live "working now" indicator.
- **Names used across tasks:** `PortalAccess`, `loadPortalAccess`, `includedProjects`, `previewAccess`, `portalSummary`, `portalScreenshots`, `logPortalView`, `clientVisibilityFor`, `listMyPortals`, `acceptPortalInvitation`, `getPortalSettings`, `updatePortalSettings`, `invitePortalViewer`, `revokePortalViewer`, and the DTO names from Task 2 are the same everywhere.
