'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, MoreHorizontal, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import type { ProjectDto, TeamDto, WorkerDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PermissionState,
  PersonCell,
  Select,
  Textarea,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ColorDot, useOrgAction } from '@/components/workspace/shared';

export default function TeamsPage() {
  const org = useOrg();
  const canManage = org.can('teams:manage');
  const teamsQ = useOrgQuery<TeamDto[]>(org.can('teams:read') ? '/teams' : null);
  const projectsQ = useOrgQuery<ProjectDto[]>(org.can('projects:read') ? '/projects' : null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<TeamDto | 'new' | null>(null);
  const [archive, setArchive] = useState<TeamDto | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useOrgAction();
  const toast = useToast();
  const openTeam = teamsQ.data?.find((t) => t.id === openId) ?? null;

  if (!org.can('teams:read')) return <PermissionState />;

  const columns: Column<TeamDto>[] = [
    {
      key: 'name',
      header: 'Team',
      priority: 'primary',
      value: (t) => t.name,
      cell: (t) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{t.name}</span>
          {t.description && <span className="block max-w-96 truncate text-xs text-text-muted">{t.description}</span>}
        </span>
      ),
    },
    {
      key: 'managers',
      header: 'Managers',
      priority: 'secondary',
      value: (t) => t.members.filter((m) => m.role === 'MANAGER').map((m) => m.name).join(', '),
      cell: (t) => {
        const ms = t.members.filter((m) => m.role === 'MANAGER');
        return ms.length ? <span className="block max-w-56 truncate">{ms.map((m) => m.name).join(', ')}</span> : <span className="text-text-faint">No manager</span>;
      },
    },
    { key: 'members', header: 'Members', align: 'right', priority: 'secondary', value: (t) => t.members.length, cell: (t) => t.members.length },
    { key: 'projects', header: 'Projects', align: 'right', value: (t) => t.project_ids.length, cell: (t) => t.project_ids.length },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (t: TeamDto) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Menu
                  trigger={
                    <IconButton label={`Actions for ${t.name}`} size="xs">
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  }
                >
                  <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(t)}>
                    Rename
                  </MenuItem>
                  <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchive(t)}>
                    Archive team
                  </MenuItem>
                </Menu>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group members, give them a manager, and assign projects to the whole team."
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
              New team
            </Button>
          )
        }
      />
      <Panel>
        {teamsQ.error ? (
          <ErrorState error={teamsQ.error} onRetry={() => teamsQ.refetch()} />
        ) : (
          <DataTable
            rows={teamsQ.data}
            loading={teamsQ.isLoading}
            columns={columns}
            rowKey={(t) => t.id}
            onRowClick={(t) => setOpenId(t.id)}
            searchable
            searchPlaceholder="Search teams…"
            caption="Teams"
            initialSort={{ key: 'name', dir: 'asc' }}
            empty={
              <EmptyState
                title="No teams yet"
                description={canManage ? 'Create a team to give a group of members a manager and shared projects.' : 'You are not on any team yet.'}
                action={canManage && <Button onClick={() => setEdit('new')}>New team</Button>}
              />
            }
          />
        )}
      </Panel>

      <TeamDrawer team={openTeam} onClose={() => setOpenId(null)} projects={projectsQ.data ?? []} canManage={canManage} />
      <TeamDialog team={edit === 'new' ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} onCreated={(t) => setOpenId(t.id)} />
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'team'}?`}
        description="Members are taken off the team and lose project access that came through it. Their tracked time is kept."
        confirmLabel="Archive team"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!archive) return;
          setBusy(true);
          try {
            await run('DELETE', `/teams/${archive.id}`);
            toast.success('Team archived');
            if (openId === archive.id) setOpenId(null);
            setArchive(null);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function TeamDialog({ team, open, onOpenChange, onCreated }: { team: TeamDto | null; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (t: TeamDto) => void }) {
  const run = useOrgAction();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(team?.name ?? '');
      setDescription(team?.description ?? '');
      setErr(null);
    }
  }, [open, team]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { name, description: description || null };
      const t = team ? await run<TeamDto>('PATCH', `/teams/${team.id}`, body) : await run<TeamDto>('POST', '/teams', body);
      toast.success(team ? 'Team updated' : 'Team created');
      onOpenChange(false);
      if (!team) onCreated(t);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={team ? 'Rename team' : 'New team'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            {team ? 'Save' : 'Create team'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" htmlFor="team-name" required error={err?.field('name')}>
          <Input id="team-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Description" htmlFor="team-desc" error={err?.field('description')}>
          <Textarea id="team-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function TeamDrawer({ team, onClose, projects, canManage }: { team: TeamDto | null; onClose: () => void; projects: ProjectDto[]; canManage: boolean }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const workersQ = useOrgQuery<WorkerDto[]>(canManage && team && org.can('members:read') ? '/workers' : null);
  const [add, setAdd] = useState({ membership_id: '', role: 'MEMBER' });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setAdd({ membership_id: '', role: 'MEMBER' }), [team?.id]);

  const candidates = useMemo(() => (workersQ.data ?? []).filter((w) => w.status === 'ACTIVE' && !team?.members.some((m) => m.membership_id === w.id)), [workersQ.data, team]);
  const teamProjects = projects.filter((p) => team?.project_ids.includes(p.id));

  const setMember = async (membershipId: string, role: 'MANAGER' | 'MEMBER' | null) => {
    if (!team) return;
    setBusy(membershipId);
    try {
      if (role) await run('PUT', `/teams/${team.id}/members/${membershipId}`, { role });
      else await run('DELETE', `/teams/${team.id}/members/${membershipId}`);
      if (membershipId === add.membership_id) setAdd({ membership_id: '', role: 'MEMBER' });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer open={!!team} onOpenChange={(o) => !o && onClose()} title={team?.name ?? ''} subtitle={team ? `${team.members.length} members · ${team.members.filter((m) => m.role === 'MANAGER').length} managers` : undefined}>
      {team && (
        <div className="flex flex-col">
          {team.description && <p className="border-b border-border px-5 py-3 text-sm text-text-muted">{team.description}</p>}

          {canManage && (
            <form
              className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (add.membership_id) void setMember(add.membership_id, add.role as 'MANAGER' | 'MEMBER');
              }}
            >
              <Field label="Add member" htmlFor="team-add" className="min-w-40 flex-1">
                <Select id="team-add" value={add.membership_id} onChange={(e) => setAdd({ ...add, membership_id: e.target.value })}>
                  <option value="">{candidates.length ? 'Choose a member…' : 'Everyone is already on this team'}</option>
                  {candidates.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role" htmlFor="team-add-role" className="w-32">
                <Select id="team-add-role" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                  <option value="MEMBER">Member</option>
                  <option value="MANAGER">Manager</option>
                </Select>
              </Field>
              <Button type="submit" variant="primary" icon={<UserPlus className="size-3.5" />} disabled={!add.membership_id} loading={busy === add.membership_id && !!add.membership_id}>
                Add
              </Button>
            </form>
          )}

          <h3 className="px-5 pb-1 pt-4 text-2xs font-semibold uppercase tracking-wide text-text-muted">Members</h3>
          {team.members.length === 0 ? (
            <EmptyState title="No members yet" description={canManage ? 'Add members above. Managers can approve their team’s timesheets.' : undefined} />
          ) : (
            <ul className="divide-y divide-border">
              {team.members.map((m) => (
                <li key={m.membership_id} className="flex items-center gap-3 px-5 py-2">
                  <Link href={`${org.base}/workers/${m.membership_id}`} className="min-w-0 flex-1 hover:underline">
                    <PersonCell name={m.name} />
                  </Link>
                  {canManage ? (
                    <>
                      <Select aria-label={`Team role for ${m.name}`} value={m.role} disabled={busy === m.membership_id} onChange={(e) => setMember(m.membership_id, e.target.value as 'MANAGER' | 'MEMBER')} className="h-7 w-28 text-xs">
                        <option value="MEMBER">Member</option>
                        <option value="MANAGER">Manager</option>
                      </Select>
                      <IconButton label={`Remove ${m.name} from team`} size="xs" disabled={busy === m.membership_id} onClick={() => setMember(m.membership_id, null)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </>
                  ) : (
                    m.role === 'MANAGER' && <Badge tone="brand">Manager</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="border-t border-border px-5 pb-1 pt-4 text-2xs font-semibold uppercase tracking-wide text-text-muted">Projects</h3>
          {teamProjects.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-text-muted">No projects. Assign this team from a project’s settings.</p>
          ) : (
            <ul className="divide-y divide-border pb-2">
              {teamProjects.map((p) => (
                <li key={p.id}>
                  <Link href={`${org.base}/projects/${p.id}`} className="flex items-center gap-2 px-5 py-2 text-sm hover:bg-surface-muted">
                    <ColorDot color={p.color} />
                    <span className="truncate">{p.name}</span>
                    {p.client_name && <span className="truncate text-text-muted">· {p.client_name}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}
