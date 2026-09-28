# Design System & Dashboards

## 13. Design System

### Brand direction
**"Calm instrument."** The product should feel like a precision tool used all day: steady, legible, dense, and quiet until something needs attention. It takes its cues from well-made instruments (ledgers, flight decks), not from marketing sites. Colour is reserved for **state and priority**. Chrome stays neutral so status stands out.

- **Voice:** direct and specific. "3 timesheets need approval", not "You've got things to do! 🎉".

### Brand identity (as built, ADR-125)
- **Name:** **WorkPulse**, tagline **"Track • Focus • Achieve"**. This is the name people read in the web app, the desktop app, emails and notifications. Technical identifiers (packages, env vars, webhook headers, installer files, the desktop app's system name) stay "Tallywork".
- **Mark:** a hexagon "pulse": an outer hexagon in `#1766FF`, an inner hexagon in `#0B2A66`, and a white pulse line clipped to the inner hexagon. It replaces the earlier working concept (a tally-mark monogram).
- **Components** (`packages/ui/src/logo.tsx`):
  - `Logo`: the mark alone, at any size (`size`, accessible `title`, default "WorkPulse").
  - `BrandLockup`: the mark plus the wordmark "Work" + "Pulse", with an optional tagline. "Work" uses the text colour (white on dark panels), "Pulse" is `#1766FF` (`#4D8DFF` on dark, `tone="onDark"`), and the tagline uses the muted text colour.
- **Wordmark font:** Poppins Bold, loaded in `apps/web/app/layout.tsx` as `--font-brand` and used only for the wordmark. The rest of the UI stays Inter.
- **Where it appears:** the favicon is `apps/web/app/icon.svg` (the same drawing as `Logo`). The desktop app icon is `apps/desktop/build/icon.svg`, rendered to `build/icon.png`: the mark on a dark rounded square with a soft blue glow. The public (signed-out) pages (login, signup, invitation, forgot/reset password, verify email, welcome, the desktop authorize page and the /download page) share `AuthShell` (`apps/web/components/auth-shell.tsx`), which shows the lockup with the tagline.
- The brand colours are fixed values for the mark and wordmark only. UI components still use the semantic tokens below.

### Colour tokens

Semantic tokens are defined on `:root`. Components reference only semantic tokens, never raw hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-900` (primary) | `#0F2240` deep navy | `#E6ECF5` | Sidebar background (light), headings accent, auth-page brand panel (the logo uses its own fixed colours, see Brand identity) |
| `--interactive` | `#1F5FD1` | `#5B8DEF` | Links, primary buttons, focus ring base |
| `--interactive-hover` | `#1A4FB0` | `#7AA3F2` | |
| `--secondary` (indigo) | `#4B4FC4` | `#8A8DF0` | Secondary series, selected nav, chips |
| `--success` | `#16794A` | `#3FB27F` | Approved, active, healthy budget |
| `--warning` | `#B26A00` | `#E3A33B` | Pending, idle, budget warning |
| `--danger` | `#C0362C` | `#F07167` | Rejected, exceeded, revoked, errors |
| `--info` | `#0E7490` | `#38B2CC` | Neutral informative states (web source, manual) |
| `--bg` | `#F6F7F9` | `#0E1117` | App background |
| `--surface` | `#FFFFFF` | `#161B22` | Panels, tables |
| `--surface-muted` | `#EEF1F5` | `#1C232D` | Table header, zebra, filter bar |
| `--border` | `#DCE1E8` | `#2A323D` | 1px dividers |
| `--text` | `#141A23` | `#E6EAF0` | Primary text |
| `--text-muted` | `#5A6472` | `#9AA4B2` | Secondary text/metadata |
| `--focus` | `#1F5FD1` 2px + 2px offset | `#7AA3F2` | Visible focus |

- Every text/background pair is **AA** (4.5:1 body, 3:1 large text/UI). CI runs a contrast check on the token pairs.
- **Status never relies on colour alone.** Every status badge pairs colour with an icon and text label (e.g. ● Tracking, ◐ Idle, ○ Offline).
- **Activity scale:** a sequential single-hue indigo ramp (5 steps). There is no red/green "good/bad" scale for activity, because activity is a signal, not a verdict.
- **Project colours:** 12 distinguishable categorical hues (validated for colour-vision deficiency), assigned per project and used in timelines.

### Typography
- **Wordmark only:** Poppins Bold via `--font-brand` (see Brand identity).
- `Inter` (variable, self-hosted), falling back to `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) for all durations, money, and table numbers, so digits line up and the running timer doesn't jitter.

| Role | Size / line-height / weight |
|---|---|
| Page title | 28 / 36 / 600 |
| Section heading | 20 / 28 / 600 |
| Panel heading | 16 / 24 / 600 |
| Body | 14 / 20 / 400 (15/22 on mobile) |
| Secondary | 13 / 18 / 400 |
| Metadata / table header | 12 / 16 / 500, +0.02em tracking |
| Timer (agent) | 44 / 48 / 500 tabular |

### Spacing, radius, elevation
- The spacing scale uses a 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48. Page gutter is 24px on desktop and 16px on mobile.
- **Radius:** 4px for inputs, buttons, and badges; 6px for panels; 8px for dialogs. No pill-shaped containers except status badges.
- **Elevation:** borders first. Shadows only for overlays (menus, popovers, dialogs, drawers). No glassmorphism, no gradients except inside charts where they encode data (e.g. heat).
- **Motion:** 120–180ms ease-out for overlays and expanding rows only. `prefers-reduced-motion` removes all non-essential motion. No decorative animation.

### Components (`packages/ui`)
Built on Radix primitives (for accessibility behaviour) with our own styling:

| Group | Components |
|---|---|
| Shell | AppShell, Sidebar (collapsible groups, collapsed icon rail), Topbar (org switcher, global search ⌘K, timer bar, notifications, user menu), PageHeader (title, breadcrumbs, primary action, secondary actions) |
| Inputs | Button (primary/secondary/ghost/danger; sm/md), Input, Textarea, Select, Combobox (async search), DatePicker, DateRangePicker (presets: Today, Yesterday, This week, Last week, This pay period, Custom), DurationInput (`1h 30m`, `1.5`, `90m`), MoneyInput, Checkbox, Switch, RadioGroup |
| Overlays | Dialog, Drawer (right detail panels), DropdownMenu, Popover, Tooltip, Toast, ConfirmDialog (types the resource name for destructive actions) |
| Navigation | Tabs, SegmentedControl, Breadcrumbs, Pagination (cursor) |
| Data | DataTable, FilterBar, SearchField, BulkActionBar, ColumnPicker, DensityToggle, SavedViews, EmptyState, LoadingState (skeleton rows matching the table layout), ErrorState (with request ID), PermissionState |
| Display | KpiSummary (strip of 3–6 metrics with delta vs previous period), ChartCard, StatusBadge, Avatar, AvatarGroup, WorkerStatus (live dot + label + current project), ActivityIndicator (bar with kb/mouse split), TimeDisplay (formats per org preference: `7:45` vs `7h 45m` vs `7.75`), Timeline (day ribbon), BudgetProgress (bar with threshold ticks and projected marker) |
| Domain | Timer, ProjectSelector, TaskSelector, ProjectTaskCommand (combined search), ScreenshotGrid, ScreenshotViewer (keyboard nav, zoom, multi-display switcher), TimesheetGrid, ApprovalPanel, InvoiceTable, PolicyField (shows inheritance source) |

### Tables (the core component)
- **Density:** compact 32px rows (default for managers/admins), comfortable 40px (default for workers). The user's choice is remembered.
- Sticky header and first column; numeric columns right-aligned with tabular figures; a totals footer row where it makes sense.
- Sortable headers (`aria-sort`); filters live in the FilterBar, not in headers; column visibility and order are saved per user per table.
- Row selection → BulkActionBar slides in with count plus allowed actions (permission-filtered).
- The row action menu (⋯) sits at the end, and an inline primary action appears on hover/focus (e.g. "Approve").
- Every table works with the keyboard: arrow row focus, `Space` to select, `Enter` to open.
- **Responsive:** below 768px, rows become **stacked list items** with the 2–3 most important fields plus a status badge and chevron. Detail opens full-screen. Horizontal scroll with a frozen first column is allowed only in reports.

### Charts
- Chart rules: one question per chart, a title stated as the question/answer ("Hours by project, this week"), direct labels over legends where possible, no 3D, no donut charts with more than 5 slices (use bars), zero baseline for bars.
- Standard set: stacked bar (hours by day by project), horizontal bar (top apps/URLs/projects), line (budget burn vs budget with projection dashed), day ribbon (timeline), heat grid (activity by hour × day), bullet (budget), sparkline in KPIs.
- **Accessibility:** every chart has a visually-hidden data table alternative and an `aria-label` summary. Chart colours pass 3:1 against the surface. Hover values are also reachable by keyboard.

### Navigation
- A **role-aware sidebar** built from one navigation config filtered by permissions (the admin, manager, and worker structures below are *outputs* of that filter, not three separate codebases).
- Grouped sections with collapsible headers. The collapsed state is an icon rail with tooltips. The active item is marked with a 3px `--secondary` inset bar plus weight 600.
- ⌘K / Ctrl+K command palette: jump to worker/project/report, start a timer on a project, run actions ("Approve timesheets").

**System Admin** (consolidated from brief §54; related workflows grouped as tabs rather than separate pages):
```text
Overview
Workspace:   Workers · Teams · Clients · Projects (tasks as tab + global Tasks view)
Tracking:    Live (who's working) · Activity [Screenshots | Apps | URLs] · Sessions · Devices · Locations (Future)
Timesheets:  View & Edit · Approvals · Manual Time
People Ops:  Attendance · Schedules · Time Off
Finance:     Billing (rates, amounts owed) · Budgets · Expenses · Invoices · Payments
Reports:     catalog (grouped by question)
Developer:   API Keys · Webhooks · API Docs
Settings:    Organization · Tracking Policies · Roles & Permissions · Notifications · Security · Retention · Integrations · Subscription
```
**Team Manager:** Overview · Team [Workers · Live · Activity · Sessions] · Timesheets [Review · Approvals] · Projects [Projects · Tasks · Budgets] · People Ops [Attendance · Schedules · Time Off] · Reports.
**Worker:** Today · Timesheet · Projects & Tasks · My Activity · Time Off · Schedule · Profile & Devices. *As built (ADR-124, ADR-128): this is the desktop app's navigation. Workers are redirected from the web workspace to `/download`, which offers the installer for their OS.*

### Responsive behaviour

| Breakpoint | Layout |
|---|---|
| ≥ 1280 | Sidebar (240px) + main; detail drawers overlay the right 480px |
| 1024–1279 | Sidebar collapsible to a 64px rail; drawers 400px |
| 768–1023 | Rail by default; tables drop low-priority columns (column `priority` metadata) |
| < 768 | Top bar + hamburger drawer nav + **bottom tab bar for workers** (Today, Timesheet, Time Off, More). The timer is a sticky bottom sheet. Approvals become swipe-free list items with explicit Approve/Reject buttons. Screenshot review is a single column with day and hour pickers. |

Mobile priorities (from the brief): timer, own timesheet, approvals, notifications, and activity review are fully usable on mobile. Heavy admin configuration shows desktop-optimized layouts that remain functional.

### Accessibility commitments
Semantic landmarks (`header`, `nav`, `main`), skip-link, a logical heading order, and focus trap and return in dialogs/drawers. All interactive elements are reachable by keyboard with visible focus, and form errors are announced via `aria-live`. The live timer uses `aria-live="off"` with an on-demand "announce elapsed" button, so screen readers aren't spammed. Targets are ≥ 24×24px (44 on touch). Tested with axe in CI plus manual VoiceOver/NVDA passes each milestone.

## 15. Dashboard Architecture

### Widget framework
```ts
interface WidgetDefinition {
  key: 'worked_today' | 'tracked_this_week' | 'active_workers' | ...;
  title: string;
  question: string;                     // the business question it answers
  requiredPermission: Permission;       // widget hidden if missing
  supportedScopes: ('ALL'|'ME'|'WORKER')[];
  sizes: ('S'|'M'|'L')[];               // S = 3 cols, M = 6, L = 12 on a 12-col grid
  settingsSchema: ZodSchema;            // e.g. {team_id?, project_id?, threshold?}
  dataEndpoint: `/widgets/${string}`;   // server computes from rollups, scope-filtered
  refresh: 'live' | '60s' | '5m' | 'on-load';
  drillDown: (ctx) => Href;             // every widget links to its full page/report
}
```
- The layout is stored per membership **per scope** in `dashboard_layouts.widgets` = `[{key, size, order, settings}]`. **Role default layouts** are shipped as data, and "Reset to default" is available.
- The data endpoint of every widget passes through the permission evaluator. A manager's "Active workers" is automatically team-scoped.
- The grid uses CSS grid with drag reordering (dnd-kit, keyboard-accessible: pick up with Space, move with arrows) and a size switcher. There is no free-form pixel resizing, which keeps layouts tidy and predictable.
- Live widgets (Active workers, Current timer) subscribe to SSE. Others poll or fetch on load with TanStack Query caching.

### Widget catalogue

| Widget | Question | Admin | Manager | Worker |
|---|---|---|---|---|
| Current timer | Am I tracking, on what? | ✓ (if worker) | ✓ (if worker) | **default** |
| Worked today | How much today? | default (org) | default (team) | **default** (me) |
| Tracked this week | Week total vs expected | default | default | **default** |
| Active workers / Currently working | Who is working now? | default | **default** | — |
| Currently idle | Who is idle now? | ✓ | **default** | — |
| Activity (avg %, trend) | Engagement signal this period | ✓ | default | ✓ (me) |
| Apps & URLs (top 5) | Where did time go? | ✓ | ✓ | ✓ (me, if policy) |
| Recent screenshots | Quick visual check | ✓ | default | ✓ (me, if policy) |
| Recent sessions | What was just worked on? | ✓ | ✓ | ✓ |
| Timesheets to approve | What needs my approval? | default | **default** | — |
| My timesheet status | Is my period submitted? | — | — | **default** |
| Project budgets | Which projects are near/over? | default | ✓ | — |
| Client budgets | Which clients are near/over? | ✓ | — | — |
| Weekly limits | Who's approaching limits? | ✓ | default | ✓ (me) |
| Billable hours | Billable vs non-billable this period | default | ✓ (if P) | — |
| Amounts owed | What do we owe workers? | default | — | ✓ (me, if P) |
| Invoices (outstanding/overdue) | What are clients late on? | default | — | — |
| Payments (recent) | What came in? | ✓ | — | — |
| Time-off requests | What leave needs a decision? | ✓ | default | — |
| Upcoming time off | Who's out soon? | ✓ | default | ✓ (mine) |
| Attendance today | Who's late or absent? | ✓ | default | — |
| Assigned tasks | What should I work on? | — | ✓ | **default** |
| Upcoming schedule | When am I working? | — | — | **default** |
| Projects (hours by project) | Where did time go by project? | ✓ | ✓ | ✓ |
| Devices offline | Which agents need attention? | ✓ | — | — |

### Default compositions (6–8 widgets each, never all at once)
- **System Admin:** KPI strip (Worked today · This week · Active workers · Billable hours · Amounts owed) → Timesheets to approve (M) + Project budgets (M) → Hours by project (L) → Invoices (M) + Time-off requests (M).
- **Team Manager:** KPI strip (Team members · Working now · Idle now · Team hours today · Avg activity) → Currently working list with live status, current project, and quick actions (L) → Timesheets to approve (M) + Attendance today (M) → Recent screenshots (M) + Upcoming time off (M).
- **Worker:** Current timer (M, with the start/stop button) + Today/This week (M) → Assigned tasks (M) + Recent time entries (M) → My timesheet status (S) + Upcoming schedule (S) + Time off balance (S).

**Fast actions** from manager widgets (row actions): Review timesheet · View worker · View activity · View screenshots · Open session · Approve · Reject. Approve/Reject run inline with an optimistic UI plus undo toast (5s) before commit.
