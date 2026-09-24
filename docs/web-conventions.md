# Web app conventions (apps/web)

Read this before adding pages. The canonical example is `apps/web/app/o/[orgId]/page.tsx` (Overview dashboard).

## Stack
- Next.js 16 App Router. Pages are **client components** (`'use client'`) that fetch from the Hono API at `/api/v1` with TanStack Query. Business logic stays in the API; pages only render and call endpoints.
- Tailwind v4 with semantic tokens only (`bg-surface`, `text-text-muted`, `border-border`, `bg-interactive`, `text-success`, `bg-warning-soft`, …). See `packages/ui/src/tokens.css`. **Never** use raw hex colours or Tailwind palette colours (`bg-blue-500`) except for project colours coming from data.
- Icons: `lucide-react`. Font: Inter (already global). Numbers/durations/money: add the `tabular` class.

## Routing
All org pages live under `apps/web/app/o/[orgId]/…`. Links use `org.base` from `useOrg()`, for example `` `${org.base}/projects/${id}` ``.

## Data
```ts
import { useOrgQuery, useOrgMutation, api, qs, errorMessage } from '@/lib/api';
const q = useOrgQuery<ProjectDto[]>('/projects');                 // GET /api/v1/orgs/:orgId/projects
const m = useOrgMutation<Body, Res>('POST', '/projects');          // invalidates all org queries on success
const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/projects/${b.id}`);
await api(`/orgs/${org.organization.id}/…`, { method: 'POST', body }); // ad-hoc
```
- DTO types: `@tallywork/contracts` (`packages/contracts/src/dto.ts`). Where no DTO type exists, read the service's return shape in `packages/api/src/services/*.ts` and declare a local interface.
- Endpoints: `packages/api/src/routes/*.ts`. Request validation: `packages/contracts/src/inputs.ts`.
- Errors: `ApiError` has `.status`, `.code`, `.title`, `.field(name)`. Show `.title` in toasts (`useToast()`), and field errors in `Field error=…`.
- Date ranges: the API caps ranges at 400 days. Use `todayIn(tz)`, `addDays`, and `weekStartOf` from `@/lib/org`.

## Permissions
`const org = useOrg();` exposes `org.can('invoices:manage')`, `org.grants`, `org.isManagerView`, `org.isAdmin`, `org.membership`, `org.organization` (timezone, currency, week_start), and `org.fmtDuration(seconds)` (respects the org duration format). Hide actions the user cannot perform. The server still enforces every rule. When a whole page is not allowed, render `<PermissionState />`.

## Components (`@tallywork/ui`)
- Layout: `PageHeader` (title, description, actions), `Panel` (title, actions, children), `FilterBar`, `KpiStrip`, `Tabs`, `SegmentedControl`.
- Data: `DataTable` (columns with `cell`, `value` for sort/search, `align: 'right'` for numbers, `priority: 'primary' | 'secondary'` for the mobile stacked layout; supports `selectable` + `bulkActions`, `searchable`, `onRowClick`), `EmptyState`, `ErrorState`, `SkeletonRows`, `PermissionState`.
- Inputs: `Button` (variant primary/secondary/ghost/danger/subtle, size xs/sm/md, `icon`, `loading`), `IconButton`, `Input`, `Select` (native), `Textarea`, `Field` (label/hint/error), `Checkbox`, `Switch`.
- Overlays: `Dialog` (title, footer), `Drawer` (right-hand detail panel), `ConfirmDialog`, `Menu`/`MenuItem`, `Popover`, `Tooltip`, `useToast()`.
- Display: `StatusBadge status="APPROVED"` (colour + icon + text), `Badge`, `Avatar`, `PersonCell`, `WorkerStatus`, `ActivityBar pct`, `BudgetProgress`, `Stat`.
- Format: `fmtDuration`, `fmtClock`, `fmtMoney(minor, currency)`, `fmtDate`, `fmtTime`, `fmtDateTime`, `fmtRelative`, `fmtPct`.
- App components: `@/components/project-task-picker` (`ProjectTaskPicker`), `@/components/charts` (`ColumnChart`, `StackedBars`, `DayRibbon`).

## Design rules (docs/plan/06-design-ux.md)
- Dense and operational: tables over cards, one purposeful chart per view, no decorative gradients or illustrations, no giant cards. Radius stays small (the components already handle it).
- Every page starts with `PageHeader`, then (optionally) a `FilterBar`, then `Panel`s.
- Status is never shown by colour alone; use `StatusBadge`.
- Mobile: `DataTable` switches to stacked rows automatically, so give each table a sensible `priority`. Keep toolbars wrapping (`flex-wrap`).
- Accessibility: every icon-only button needs `aria-label` (`IconButton label=…`), inputs need labels (`Field`), charts need text alternatives (built into `ColumnChart`).
- Empty states say what to do next ("Invite your first member").
- Destructive actions use `ConfirmDialog`.

## Don'ts
- Do not modify `packages/*`, `lib/*`, `components/shell/*`, or other groups' directories. Put shared pieces for your area in `apps/web/components/<area>/`.
- Do not add npm dependencies.
- Do not put business rules in React (e.g. computing billable amounts). The API returns computed values.
- If an endpoint is missing or broken, do not work around it with fake data. Note it in your final report.
