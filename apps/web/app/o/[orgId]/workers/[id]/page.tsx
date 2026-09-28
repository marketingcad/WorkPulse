'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Activity, ArrowRight, Check, Clock, Eraser, Lock, Pencil, UserX, X } from 'lucide-react';
import type { DeviceDto, EffectivePolicyDto, ProjectDto, TeamDto, TimeEntryDto, WorkerDto } from '@tallywork/contracts';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KpiStrip,
  PageHeader,
  Panel,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  Switch,
  Tabs,
  fmtDate,
  fmtDateTime,
  fmtRelative,
  fmtTime,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgQuery } from '@/lib/api';
import { addDays, todayIn, useOrg, weekStartOf } from '@/lib/org';
import { ColorDot, ProjectStatusBadge, hoursToSeconds, secondsToHours, useOrgAction, type RoleDto } from '@/components/workspace/shared';
import { AnonymizeDialog } from '@/components/security/anonymize-dialog';
import { DataExportAction } from '@/components/security/data-export';

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const org = useOrg();
  const [tab, setTab] = useState('overview');
  const workerQ = useOrgQuery<WorkerDto>(`/workers/${id}`);
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const w = workerQ.data;
  const isSelf = id === org.membership.id;

  if (workerQ.error) return <ErrorState error={workerQ.error} onRetry={() => workerQ.refetch()} />;
  if (!w)
    return (
      <Panel>
        <SkeletonRows rows={4} cols={3} />
      </Panel>
    );

  const teamNames = w.team_ids.map((t) => teamsQ.data?.find((x) => x.id === t)?.name).filter(Boolean) as string[];
  const items = [
    { value: 'overview', label: 'Overview' },
    ...(org.can('time:read') ? [{ value: 'time', label: 'Time' }] : []),
    ...(org.can('activity:read') ? [{ value: 'activity', label: 'Activity' }] : []),
    { value: 'projects', label: 'Projects' },
    ...(org.can('devices:read') ? [{ value: 'devices', label: 'Devices' }] : []),
    ...(org.can('policies:read') ? [{ value: 'policy', label: 'Policy' }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/workers`} className="hover:text-text hover:underline">
            Members
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={w.name} size={36} />
            <span className="min-w-0 truncate">{w.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{w.email}</span>
            <span aria-hidden>·</span>
            <span>{w.role_name}</span>
            {w.is_owner && <Badge tone="brand">Owner</Badge>}
            {isSelf && <Badge>You</Badge>}
            <StatusBadge status={w.status} />
          </span>
        }
      />
      <Tabs value={tab} onValueChange={setTab} items={items} className="mb-4" />
      {tab === 'overview' && <OverviewTab w={w} teamNames={teamNames} />}
      {tab === 'time' && <TimeTab w={w} />}
      {tab === 'activity' && <ActivityTab w={w} />}
      {tab === 'projects' && <ProjectsTab w={w} teams={teamsQ.data ?? []} />}
      {tab === 'devices' && <DevicesTab w={w} />}
      {tab === 'policy' && <PolicyTab w={w} />}
    </>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({ w, teamNames }: { w: WorkerDto; teamNames: string[] }) {
  const org = useOrg();
  const router = useRouter();
  const run = useOrgAction();
  const toast = useToast();
  const admin = org.can('members:manage');
  const isSelf = w.id === org.membership.id;
  const canEdit = admin || isSelf;
  const rolesQ = useOrgQuery<RoleDto[]>(admin ? '/roles' : null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'suspend' | 'remove' | null>(null);
  const [erasing, setErasing] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (kind: 'suspend' | 'restore' | 'remove') => {
    setBusy(true);
    try {
      if (kind === 'remove') {
        await run('DELETE', `/workers/${w.id}`);
        toast.success(`${w.name} was removed`);
        router.push(`${org.base}/workers`);
      } else {
        await run('PATCH', `/workers/${w.id}`, { status: kind === 'suspend' ? 'SUSPENDED' : 'ACTIVE' });
        toast.success(kind === 'suspend' ? `${w.name} is suspended` : `${w.name} is active again`);
      }
      setConfirm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title="Profile"
        actions={
          canEdit &&
          !editing && (
            <Button size="xs" icon={<Pencil className="size-3" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        {editing ? (
          <ProfileForm w={w} roles={rolesQ.data ?? []} admin={admin} onDone={() => setEditing(false)} />
        ) : (
          <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
            <Stat label="Role" value={w.role_name} />
            <Stat label="Title" value={w.title ?? '—'} />
            <Stat label="Timezone" value={w.timezone} />
            <Stat label="Employment" value={w.employment_type === 'CONTRACTOR' ? 'Contractor' : 'Employee'} />
            <Stat label="Expected per week" value={w.weekly_expected_seconds === null ? 'Not set' : org.fmtDuration(w.weekly_expected_seconds)} />
            <Stat label="Start date" value={w.start_date ? fmtDate(w.start_date) : 'Not set'} />
            <Stat
              label="Time tracking"
              value={
                w.tracking_enabled ? (
                  <Badge tone="success" icon={<Check className="size-3" />}>
                    Enabled
                  </Badge>
                ) : (
                  <Badge icon={<X className="size-3" />}>Disabled</Badge>
                )
              }
            />
            <Stat label="Teams" value={teamNames.length ? teamNames.join(', ') : '—'} />
            <Stat label="Member since" value={fmtDate(w.created_at)} />
          </dl>
        )}
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Quick links">
          <ul className="divide-y divide-border text-sm">
            {org.can('timesheets:read') && <QuickLink href={`${org.base}/timesheets?member=${w.id}`} icon={<Clock className="size-3.5" />} label="Timesheet" />}
            {org.can('activity:read') && <QuickLink href={`${org.base}/activity?member=${w.id}`} icon={<Activity className="size-3.5" />} label="Activity & screenshots" />}
          </ul>
        </Panel>

        {admin && !isSelf && (
          <Panel title="Access">
            {w.is_owner ? (
              <p className="flex items-start gap-2 p-4 text-sm text-text-muted">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                The organization owner cannot be suspended or removed. Transfer ownership first.
              </p>
            ) : w.status === 'REMOVED' ? (
              <p className="p-4 text-sm text-text-muted">This member was removed from the workspace.</p>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {w.status === 'SUSPENDED' ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-text-muted">Suspended members cannot sign in or track time.</p>
                    <Button size="sm" loading={busy} onClick={() => act('restore')}>
                      Reactivate
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-text-muted">Block sign-in and tracking. Their data is kept.</p>
                    <Button size="sm" onClick={() => setConfirm('suspend')}>
                      Suspend
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-sm text-text-muted">Remove from the workspace and all teams.</p>
                  <Button size="sm" variant="danger" icon={<UserX className="size-3.5" />} onClick={() => setConfirm('remove')}>
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        )}

        {(admin || isSelf) && (
          <Panel title="Personal data">
            <div className="flex flex-col gap-3 p-4">
              <p className="text-sm text-text-muted">{isSelf ? 'Download everything this organization holds about you as a JSON file.' : 'Answer an access request: a JSON file with everything held about this member.'}</p>
              <DataExportAction membershipId={w.id} label={isSelf ? 'Export my data' : 'Export their data'} />
              {admin && !isSelf && (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  {w.is_owner ? (
                    <p className="flex items-start gap-2 text-sm text-text-muted">
                      <Lock className="mt-0.5 size-3.5 shrink-0" />
                      The owner’s data cannot be erased. Transfer ownership first.
                    </p>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-text-muted">Erasure request: remove them and delete their monitoring data. Time and billing records are kept.</p>
                      <Button size="sm" variant="danger" icon={<Eraser className="size-3.5" />} onClick={() => setErasing(true)}>
                        Erase
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>

      <AnonymizeDialog
        open={erasing}
        onOpenChange={setErasing}
        member={w}
        onDone={(r) => {
          setErasing(false);
          toast.success(r.account_anonymized ? `${w.name}’s data was erased and their account anonymized` : `${w.name}’s data in this organization was erased`);
          router.push(`${org.base}/workers`);
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'remove' ? `Remove ${w.name}?` : `Suspend ${w.name}?`}
        description={
          confirm === 'remove'
            ? 'They lose access immediately and are taken off every team. Their tracked time stays in reports and timesheets.'
            : 'They will not be able to sign in or track time until you reactivate them.'
        }
        confirmLabel={confirm === 'remove' ? 'Remove member' : 'Suspend'}
        danger
        loading={busy}
        onConfirm={() => confirm && act(confirm)}
      />
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-muted">
        <span className="text-text-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        <ArrowRight className="size-3.5 text-text-faint" />
      </Link>
    </li>
  );
}

function ProfileForm({ w, roles, admin, onDone }: { w: WorkerDto; roles: RoleDto[]; admin: boolean; onDone: () => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const [f, setF] = useState({
    role_id: w.role_id,
    title: w.title ?? '',
    timezone: w.timezone,
    tracking_enabled: w.tracking_enabled,
    employment_type: w.employment_type,
    weekly: secondsToHours(w.weekly_expected_seconds),
    start_date: w.start_date ?? '',
  });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { title: f.title.trim() || null, timezone: f.timezone };
    if (admin) {
      body.tracking_enabled = f.tracking_enabled;
      body.employment_type = f.employment_type;
      body.weekly_expected_seconds = hoursToSeconds(f.weekly);
      body.start_date = f.start_date || null;
      if (!w.is_owner && f.role_id !== w.role_id) body.role_id = f.role_id;
    }
    try {
      await run('PATCH', `/workers/${w.id}`, body);
      toast.success('Profile saved');
      onDone();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {admin && (
        <Field label="Role" htmlFor="wk-role" error={err?.field('role_id')} hint={w.is_owner ? 'The owner’s role cannot be changed.' : undefined}>
          <Select id="wk-role" value={f.role_id} disabled={w.is_owner} onChange={(e) => setF({ ...f, role_id: e.target.value })}>
            {!roles.some((r) => r.id === w.role_id) && <option value={w.role_id}>{w.role_name}</option>}
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Title" htmlFor="wk-title" error={err?.field('title')}>
        <Input id="wk-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={100} placeholder="e.g. Designer" />
      </Field>
      <Field label="Timezone" htmlFor="wk-tz" error={err?.field('timezone')}>
        <Input id="wk-tz" list="wk-tz-list" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
        <datalist id="wk-tz-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      {admin && (
        <>
          <Field label="Employment type" htmlFor="wk-emp">
            <Select id="wk-emp" value={f.employment_type} onChange={(e) => setF({ ...f, employment_type: e.target.value })}>
              <option value="EMPLOYEE">Employee</option>
              <option value="CONTRACTOR">Contractor</option>
            </Select>
          </Field>
          <Field label="Expected hours per week" htmlFor="wk-hours" hint="Used for timesheet variance. Leave empty for none." error={err?.field('weekly_expected_seconds')}>
            <Input id="wk-hours" type="number" min={0} max={168} step={0.5} inputMode="decimal" className="tabular" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })} />
          </Field>
          <Field label="Start date" htmlFor="wk-start" hint="Employment start. Time-off accruals are pro-rated from it." error={err?.field('start_date')}>
            <Input id="wk-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={f.tracking_enabled} onCheckedChange={(v) => setF({ ...f, tracking_enabled: v })} label="Time tracking" description="When off, this member cannot start timers on the web or desktop app." />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

// ─── Time ────────────────────────────────────────────────────────────────────
function TimeTab({ w }: { w: WorkerDto }) {
  const org = useOrg();
  const [offset, setOffset] = useState(0);
  const from = addDays(weekStartOf(todayIn(w.timezone), org.organization.week_start), offset * 7);
  const to = addDays(from, 6);
  const q = useOrgQuery<TimeEntryDto[]>(`/time-entries${qs({ from, to, membership_ids: w.id })}`);
  const entries = q.data ?? [];
  const total = entries.reduce((s, e) => s + e.duration_seconds, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.duration_seconds, 0);
  const manual = entries.filter((e) => e.source === 'MANUAL').reduce((s, e) => s + e.duration_seconds, 0);

  const columns: Column<TimeEntryDto>[] = [
    { key: 'date', header: 'Date', priority: 'secondary', value: (e) => e.started_at, cell: (e) => fmtDate(e.local_date, { weekday: 'short', month: 'short', day: 'numeric' }) },
    {
      key: 'project',
      header: 'Project / task',
      priority: 'primary',
      value: (e) => `${e.project_name ?? ''} ${e.task_title ?? ''}`,
      cell: (e) => (
        <span className="block max-w-80 truncate">
          {e.project_name}
          {e.task_title && <span className="text-text-muted"> / {e.task_title}</span>}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Time',
      cell: (e) => (
        <span className="tabular text-text-muted">
          {fmtTime(e.started_at, w.timezone)} – {fmtTime(e.ended_at, w.timezone)}
        </span>
      ),
    },
    { key: 'source', header: 'Source', cell: (e) => <StatusBadge status={e.source === 'MANUAL' ? 'MANUAL' : (e.tracking_source ?? 'TRACKED')} /> },
    { key: 'billable', header: 'Billable', cell: (e) => (e.billable ? <Badge tone="success">Billable</Badge> : <span className="text-xs text-text-faint">No</span>) },
    { key: 'duration', header: 'Duration', align: 'right', priority: 'secondary', value: (e) => e.duration_seconds, cell: (e) => org.fmtDuration(e.duration_seconds) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
          ←
        </Button>
        <span className="text-sm font-medium tabular">
          {fmtDate(from, { month: 'short', day: 'numeric' })} – {fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Button size="sm" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Next week">
          →
        </Button>
        {offset !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            This week
          </Button>
        )}
        {org.can('timesheets:read') && (
          <Link href={`${org.base}/timesheets?member=${w.id}`} className="ml-auto text-sm font-medium text-interactive hover:underline">
            Open timesheet →
          </Link>
        )}
      </div>
      <KpiStrip
        items={[
          { label: 'Total', value: org.fmtDuration(total), hint: w.weekly_expected_seconds ? `of ${org.fmtDuration(w.weekly_expected_seconds)} expected` : undefined },
          { label: 'Billable', value: org.fmtDuration(billable) },
          { label: 'Manual', value: org.fmtDuration(manual) },
          { label: 'Entries', value: entries.length },
        ]}
      />
      <Panel title="Time entries">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable rows={q.data} loading={q.isLoading} columns={columns} rowKey={(e) => e.id} caption="Time entries this week" empty={<EmptyState title="No time this week" description="Entries appear here as soon as time is tracked or added." />} />
        )}
      </Panel>
    </div>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────
function ActivityTab({ w }: { w: WorkerDto }) {
  const org = useOrg();
  return (
    <Panel>
      <EmptyState
        icon={<Activity className="size-5" />}
        title={`Review ${w.name}'s activity`}
        description="Screenshots, activity levels, apps and URLs are in the activity review, day by day."
        action={
          <Link href={`${org.base}/activity?member=${w.id}`} className="inline-flex h-8 items-center rounded-sm bg-interactive px-3 text-sm font-medium text-on-accent hover:bg-interactive-hover">
            Open activity review
          </Link>
        }
      />
    </Panel>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────
function ProjectsTab({ w, teams }: { w: WorkerDto; teams: TeamDto[] }) {
  const org = useOrg();
  const router = useRouter();
  const q = useOrgQuery<ProjectDto[]>('/projects');
  const rows = useMemo(
    () =>
      (q.data ?? [])
        .map((p) => {
          const direct = p.member_ids.includes(w.id);
          const via = p.team_ids.filter((t) => w.team_ids.includes(t)).map((t) => teams.find((x) => x.id === t)?.name ?? 'a team');
          return { p, direct, via };
        })
        .filter((r) => r.direct || r.via.length > 0),
    [q.data, w, teams],
  );
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Project',
      priority: 'primary',
      value: (r) => r.p.name,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <ColorDot color={r.p.color} />
          <span className="truncate font-medium">{r.p.name}</span>
        </span>
      ),
    },
    { key: 'client', header: 'Client', value: (r) => r.p.client_name ?? '', cell: (r) => <span className="text-text-muted">{r.p.client_name ?? '—'}</span> },
    { key: 'via', header: 'Access', priority: 'secondary', cell: (r) => <span className="text-text-muted">{[r.direct ? 'Direct member' : null, ...r.via.map((t) => `via ${t}`)].filter(Boolean).join(', ')}</span> },
    { key: 'status', header: 'Status', cell: (r) => <ProjectStatusBadge project={r.p} /> },
  ];
  return (
    <Panel title="Projects this member can track to">
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={rows}
          loading={q.isLoading}
          columns={columns}
          rowKey={(r) => r.p.id}
          onRowClick={(r) => router.push(`${org.base}/projects/${r.p.id}`)}
          caption="Assigned projects"
          empty={<EmptyState title="Not on any project" description="Add this member to a project, or to a team that works on one, so they can track time." />}
        />
      )}
    </Panel>
  );
}

// ─── Devices ─────────────────────────────────────────────────────────────────
function DevicesTab({ w }: { w: WorkerDto }) {
  const q = useOrgQuery<DeviceDto[]>('/devices');
  const rows = useMemo(() => (q.data ?? []).filter((d) => d.membership_id === w.id), [q.data, w.id]);
  const columns: Column<DeviceDto>[] = [
    { key: 'name', header: 'Device', priority: 'primary', value: (d) => d.name, cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: 'platform', header: 'Platform', value: (d) => d.platform, cell: (d) => <span className="text-text-muted">{[d.platform, d.os_version].filter(Boolean).join(' ')}</span> },
    { key: 'agent', header: 'App version', value: (d) => d.agent_version ?? '', cell: (d) => <span className="tabular text-text-muted">{d.agent_version ?? '—'}</span> },
    { key: 'status', header: 'Status', priority: 'secondary', value: (d) => d.status, cell: (d) => <StatusBadge status={d.status} /> },
    { key: 'seen', header: 'Last seen', priority: 'secondary', value: (d) => d.last_seen_at ?? '', cell: (d) => <span className="text-text-muted" title={fmtDateTime(d.last_seen_at)}>{d.last_seen_at ? fmtRelative(d.last_seen_at) : 'Never'}</span> },
  ];
  return (
    <Panel title="Devices">
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable rows={rows} loading={q.isLoading} columns={columns} rowKey={(d) => d.id} caption="Devices" empty={<EmptyState title="No devices" description="Devices appear once this member signs in to the desktop app." />} />
      )}
    </Panel>
  );
}

// ─── Policy ──────────────────────────────────────────────────────────────────
function PolicyTab({ w }: { w: WorkerDto }) {
  const org = useOrg();
  const q = useOrgQuery<EffectivePolicyDto>(`/workers/${w.id}/effective-policy`);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [w.id]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <Panel>
        <SkeletonRows rows={6} cols={2} />
      </Panel>
    );
  const p = q.data.policy;
  const hm = (s: number | null) => (s === null ? 'No limit' : org.fmtDuration(s));
  const monitored: Array<{ label: string; on: boolean; detail?: string }> = [
    { label: 'Activity levels', on: p.activity.enabled, detail: 'Keyboard and mouse activity per 10 minutes (counts only, never keystrokes).' },
    { label: 'Screenshots', on: p.screenshots.enabled && p.screenshots.perTenMinutes > 0, detail: p.screenshots.enabled ? `${p.screenshots.perTenMinutes} per 10 minutes${p.screenshots.blur ? ', blurred' : ''}${p.screenshots.notify ? ', with notification' : ''}` : undefined },
    { label: 'Apps used', on: p.apps.enabled },
    { label: 'URLs visited', on: p.urls.enabled, detail: p.urls.enabled ? (p.urls.mode === 'domain' ? 'Domain only' : 'Full URL') + (p.urls.excludedDomains.length ? `, ${p.urls.excludedDomains.length} excluded domains` : '') : undefined },
    { label: 'Location', on: p.location.enabled },
    { label: 'Idle detection', on: p.idle.enabled, detail: p.idle.enabled ? `After ${p.idle.thresholdMinutes} min, ${p.idle.behavior === 'prompt' ? 'ask what to do' : p.idle.behavior === 'pause' ? 'pause the timer' : 'keep the time'}` : undefined },
  ];
  const rules: Array<[string, string]> = [
    ['Web timer', p.tracking.allowWeb ? 'Allowed' : 'Not allowed'],
    ['Desktop app', p.tracking.allowDesktop ? 'Allowed' : 'Not allowed'],
    ['Daily limit', hm(p.limits.dailySeconds)],
    ['Weekly limit', hm(p.limits.weeklySeconds)],
    ['Manual time', p.manualTime.allowed ? (p.manualTime.requiresApproval ? 'Allowed, needs approval' : 'Allowed') : 'Not allowed'],
    ['Edit own time', p.timeEdits.workerCanEdit ? 'Allowed' : 'Not allowed'],
    ['Delete own screenshots', p.screenshots.workerCanDelete ? (p.screenshots.deleteRemovesTime ? 'Allowed, removes that time' : 'Allowed') : 'Not allowed'],
  ];
  const sources = q.data.layers.map((l) => (l.scope === 'ORG' ? 'Organization default' : l.scope === 'TEAM' ? 'Team override' : 'Personal override'));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="What is monitored">
        <ul className="divide-y divide-border">
          {monitored.map((m) => (
            <li key={m.label} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{m.label}</div>
                {m.on && m.detail && <div className="text-xs text-text-muted">{m.detail}</div>}
              </div>
              {m.on ? (
                <Badge tone="info" icon={<Check className="size-3" />}>
                  Monitored
                </Badge>
              ) : (
                <Badge icon={<X className="size-3" />}>Off</Badge>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="Rules">
          <dl className="grid grid-cols-1 gap-3 p-4">
            {(showAll ? rules : rules.slice(0, 4)).map(([k, v]) => (
              <Stat key={k} label={k} value={v} />
            ))}
          </dl>
          {rules.length > 4 && (
            <button className="w-full border-t border-border px-4 py-2 text-left text-xs font-medium text-interactive hover:underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${rules.length} rules`}
            </button>
          )}
        </Panel>
        <Panel title="Where this comes from">
          <div className="p-4 text-sm text-text-muted">
            {sources.length ? (
              <ul className="list-inside list-disc">
                {sources.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              'WorkPulse defaults. No overrides are set.'
            )}
            {org.can('policies:manage') && (
              <Link href={`${org.base}/settings/policies`} className="mt-3 block font-medium text-interactive hover:underline">
                Edit tracking policies →
              </Link>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
