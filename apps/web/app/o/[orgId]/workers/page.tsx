'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, MailPlus, X } from 'lucide-react';
import type { ProjectDto, TeamDto, WorkerDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Panel,
  PermissionState,
  PersonCell,
  Select,
  StatusBadge,
  Tabs,
  fmtDate,
  fmtRelative,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { MultiSelect } from '@/components/workspace/multi-select';
import { useOrgAction, type RoleDto } from '@/components/workspace/shared';

interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  role_id: string;
  role_name: string;
  expires_at: string;
  created_at: string;
  expired: boolean;
}
interface InviteResult {
  id: string;
  email: string;
  invite_url: string;
  expires_at: string;
  email_sent?: boolean;
}

export default function WorkersPage() {
  const org = useOrg();
  const router = useRouter();
  const canManage = org.can('members:manage');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('ACTIVE_ALL');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [view, setView] = useState<'current' | 'former'>('current');
  const former = view === 'former';

  const workersQ = useOrgQuery<WorkerDto[]>(org.can('members:read') ? (former ? '/workers?include_removed=true' : '/workers') : null);
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const rolesQ = useOrgQuery<RoleDto[]>('/roles');
  const teamName = useMemo(() => new Map((teamsQ.data ?? []).map((t) => [t.id, t.name])), [teamsQ.data]);

  const rows = useMemo(
    () => (workersQ.data ?? []).filter((w) => (former ? w.status === 'REMOVED' : w.status !== 'REMOVED') && (!role || w.role_id === role) && (former || status === 'ACTIVE_ALL' || w.status === status)),
    [workersQ.data, role, status, former],
  );

  if (!org.can('members:read')) return <PermissionState />;

  const columns: Column<WorkerDto>[] = [
    { key: 'name', header: 'Member', priority: 'primary', value: (w) => `${w.name} ${w.email}`, cell: (w) => <PersonCell name={w.name} sub={w.email} /> },
    {
      key: 'role',
      header: 'Role',
      priority: 'secondary',
      value: (w) => w.role_name,
      cell: (w) => (
        <span className="inline-flex items-center gap-1.5">
          {w.role_name}
          {w.is_owner && <Badge tone="brand">Owner</Badge>}
        </span>
      ),
    },
    {
      key: 'teams',
      header: 'Teams',
      value: (w) => w.team_ids.map((t) => teamName.get(t) ?? '').join(', '),
      cell: (w) => <span className="block max-w-48 truncate text-text-muted">{w.team_ids.map((t) => teamName.get(t)).filter(Boolean).join(', ') || '—'}</span>,
    },
    { key: 'title', header: 'Title', value: (w) => w.title ?? '', cell: (w) => <span className="text-text-muted">{w.title ?? '—'}</span> },
    { key: 'tz', header: 'Timezone', value: (w) => w.timezone, cell: (w) => <span className="text-xs text-text-muted">{w.timezone}</span> },
    ...(former
      ? [
          { key: 'started', header: 'Started', value: (w: WorkerDto) => w.start_date ?? '', cell: (w: WorkerDto) => <span className="text-text-muted">{w.start_date ? fmtDate(w.start_date) : '—'}</span> },
          { key: 'left', header: 'Date left', priority: 'secondary' as const, value: (w: WorkerDto) => w.end_date ?? '', cell: (w: WorkerDto) => <span className="text-text-muted">{w.end_date ? fmtDate(w.end_date) : '—'}</span> },
        ]
      : [{ key: 'status', header: 'Status', priority: 'secondary' as const, value: (w: WorkerDto) => w.status, cell: (w: WorkerDto) => <StatusBadge status={w.status} /> }]),
    {
      key: 'tracking',
      header: 'Tracking',
      value: (w) => (w.tracking_enabled ? 1 : 0),
      cell: (w) => (w.tracking_enabled ? <Badge tone="success" icon={<Check className="size-3" />}>On</Badge> : <Badge icon={<X className="size-3" />}>Off</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone in your workspace, their role, teams and tracking status."
        actions={
          canManage && (
            <Button variant="primary" icon={<MailPlus className="size-3.5" />} onClick={() => setInviteOpen(true)}>
              Invite member
            </Button>
          )
        }
      />
      {canManage && <Tabs value={view} onValueChange={(v) => setView(v as 'current' | 'former')} items={[{ value: 'current', label: 'Current members' }, { value: 'former', label: 'Former members' }]} className="mb-4" />}
      <Panel>
        {workersQ.error ? (
          <ErrorState error={workersQ.error} onRetry={() => workersQ.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(w) => w.id}
            loading={workersQ.isLoading}
            onRowClick={(w) => router.push(`${org.base}/workers/${w.id}`)}
            searchable
            searchPlaceholder="Search name or email…"
            caption="Members"
            initialSort={{ key: 'name', dir: 'asc' }}
            toolbar={
              <>
                <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className="h-7 w-40 text-xs">
                  <option value="">All roles</option>
                  {rolesQ.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                {!former && (
                <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-7 w-36 text-xs">
                  <option value="ACTIVE_ALL">Any status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
                )}
                <span className="ml-auto text-xs text-text-muted tabular">{rows.length} members</span>
              </>
            }
            empty={
              <EmptyState
                title={former ? 'No former members' : role || status !== 'ACTIVE_ALL' ? 'No members match these filters' : 'No members yet'}
                description={former ? 'Members you remove are listed here with the date they left.' : canManage ? 'Invite your first member to start tracking time together.' : undefined}
                action={!former && canManage && <Button onClick={() => setInviteOpen(true)}>Invite member</Button>}
              />
            }
          />
        )}
      </Panel>

      {canManage && !former && <PendingInvitations />}
      {canManage && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={rolesQ.data ?? []} teams={teamsQ.data ?? []} />}
    </>
  );
}

function PendingInvitations() {
  const invQ = useOrgQuery<InvitationRow[]>('/invitations');
  const run = useOrgAction();
  const toast = useToast();
  const [revoke, setRevoke] = useState<InvitationRow | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: Column<InvitationRow>[] = [
    { key: 'email', header: 'Email', priority: 'primary', value: (i) => i.email, cell: (i) => <PersonCell name={i.name ?? i.email} sub={i.name ? i.email : undefined} /> },
    { key: 'role', header: 'Role', priority: 'secondary', value: (i) => i.role_name, cell: (i) => i.role_name },
    { key: 'sent', header: 'Sent', value: (i) => i.created_at, cell: (i) => <span className="text-text-muted">{fmtRelative(i.created_at)}</span> },
    {
      key: 'expires',
      header: 'Expires',
      priority: 'secondary',
      value: (i) => i.expires_at,
      cell: (i) => (i.expired ? <StatusBadge status="OVERDUE" label="Expired" /> : <span className="text-text-muted">{fmtDate(i.expires_at)}</span>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (i) => (
        <Button size="xs" variant="ghost" onClick={() => setRevoke(i)}>
          Revoke
        </Button>
      ),
    },
  ];

  if (invQ.error) return null;
  if (!invQ.data?.length) return null;
  return (
    <Panel className="mt-4" title={`Pending invitations (${invQ.data.length})`}>
      <DataTable rows={invQ.data} columns={columns} rowKey={(i) => i.id} caption="Pending invitations" />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revoke invitation?"
        description={revoke && `The invite link sent to ${revoke.email} will stop working.`}
        confirmLabel="Revoke"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!revoke) return;
          setBusy(true);
          try {
            await run('DELETE', `/invitations/${revoke.id}`);
            toast.success('Invitation revoked');
            setRevoke(null);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Panel>
  );
}

function InviteDialog({ open, onOpenChange, roles, teams }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleDto[]; teams: TeamDto[] }) {
  const run = useOrgAction();
  const toast = useToast();
  const defaultRole = roles.find((r) => r.key === 'WORKER')?.id ?? roles[0]?.id ?? '';
  const empty = { email: '', name: '', role_id: '', team_ids: [] as string[], manager: false, project_ids: [] as string[] };
  const [f, setF] = useState(empty);
  const projectsQ = useOrgQuery<ProjectDto[]>(open ? '/projects' : null);
  const projects = (projectsQ.data ?? []).filter((x) => !x.archived_at);
  const roleKey = roles.find((r) => r.id === (f.role_id || defaultRole))?.key;
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const roleId = f.role_id || defaultRole;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setF(empty);
      setErr(null);
      setResult(null);
      setCopied(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await run<InviteResult>('POST', '/invitations', {
        email: f.email.trim(),
        name: f.name.trim() || undefined,
        role_id: roleId,
        team_ids: f.team_ids,
        team_role: (f.manager || roleKey === 'TEAM_MANAGER') && f.team_ids.length ? 'MANAGER' : 'MEMBER',
        project_ids: f.project_ids,
      });
      setResult(r);
      toast.success(`Invitation created for ${r.email}`);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.invite_url);
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={result ? 'Invitation ready' : 'Invite member'}
      description={result ? undefined : 'They will get an email with a link to join. You can also share the link yourself.'}
      footer={
        result ? (
          <>
            <Button onClick={() => (setResult(null), setCopied(false), setF({ ...empty, role_id: f.role_id, team_ids: f.team_ids, manager: f.manager, project_ids: f.project_ids }))}>Invite another</Button>
            <Button variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!f.email.trim() || !roleId} onClick={submit}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {result.email_sent === false ? (
              <>
                Email is not set up for this workspace, so nothing was sent. Share this link with <span className="font-medium">{result.email}</span> yourself.
              </>
            ) : (
              <>
                We emailed an invitation to <span className="font-medium">{result.email}</span>. You can also share this link with them directly.
              </>
            )}{' '}
            It expires {fmtDate(result.expires_at)}.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={result.invite_url} aria-label="Invitation link" onFocus={(e) => e.target.select()} className="font-mono text-xs" />
            <IconButton label={copied ? 'Copied' : 'Copy link'} variant="secondary" onClick={copy}>
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </IconButton>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Email" htmlFor="inv-email" required error={err?.field('email')}>
            <Input id="inv-email" type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@company.com" />
          </Field>
          <Field label="Name" htmlFor="inv-name" hint="Optional. They can change it when they accept." error={err?.field('name')}>
            <Input id="inv-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Role" htmlFor="inv-role" required error={err?.field('role_id')}>
            <Select id="inv-role" value={roleId} onChange={(e) => setF({ ...f, role_id: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          {teams.length > 0 && (
            <Field label="Teams" htmlFor="inv-teams" error={err?.field('team_ids')}>
              <MultiSelect id="inv-teams" options={teams.map((t) => ({ value: t.id, label: t.name }))} value={f.team_ids} onChange={(team_ids) => setF({ ...f, team_ids })} placeholder="No teams" />
            </Field>
          )}
          {f.team_ids.length > 0 && (
            <Checkbox
              label="Manages these teams (approves their timesheets and time off)"
              checked={f.manager || roleKey === 'TEAM_MANAGER'}
              disabled={roleKey === 'TEAM_MANAGER'}
              onChange={(e) => setF({ ...f, manager: e.target.checked })}
            />
          )}
          {projects.length > 0 && (
            <Field label="Projects" htmlFor="inv-projects" hint="They can track time to these as soon as they join. Projects assigned to their teams are included automatically." error={err?.field('project_ids')}>
              <MultiSelect id="inv-projects" options={projects.map((x) => ({ value: x.id, label: x.client_name ? `${x.name} (${x.client_name})` : x.name }))} value={f.project_ids} onChange={(project_ids) => setF({ ...f, project_ids })} placeholder="No projects" />
            </Field>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
