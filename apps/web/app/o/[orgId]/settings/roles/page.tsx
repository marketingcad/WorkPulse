'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, SCOPES, type Grants, type Permission, type Scope } from '@tallywork/domain';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, Panel, PermissionState, Select, SkeletonRows, Textarea, cx, humanize, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtin: boolean;
  grants: Grants;
}

const EDITABLE = PERMISSIONS.filter((p) => p !== 'agent:ingest');
const RESOURCE_LABEL: Record<string, string> = { org: 'Organization', api_keys: 'API keys', manual_time: 'Manual time', time_off: 'Time off', settings: 'Security settings' };
const SCOPE_LABEL: Record<Scope, string> = { own: 'Own', assigned: 'Assigned', team: 'Team', org: 'Org' };
const SCOPE_HELP = 'Own = only their own data · Assigned = projects they are assigned to · Team = teams they manage · Org = everyone';

function groups(): Array<{ resource: string; perms: Permission[] }> {
  const m = new Map<string, Permission[]>();
  for (const p of EDITABLE) {
    const r = p.split(':')[0]!;
    m.set(r, [...(m.get(r) ?? []), p]);
  }
  return [...m.entries()].map(([resource, perms]) => ({ resource, perms }));
}
const GROUPS = groups();
const resourceLabel = (r: string) => RESOURCE_LABEL[r] ?? humanize(r);
const actionLabel = (p: Permission) => humanize(p.split(':')[1] ?? p);

export default function RolesPage() {
  const org = useOrg();
  const toast = useToast();
  const allowed = org.can('roles:manage');
  const q = useOrgQuery<Role[]>(allowed ? '/roles' : null);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/roles/${b.id}`, {
    onSuccess: () => {
      toast.success('Role deleted');
      setDeleting(null);
    },
  });

  if (!allowed) return <PermissionState />;
  const roles = q.data ?? [];

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role can do, and over whose data. Built-in roles are fixed; create a custom role to adjust access."
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
            Create custom role
          </Button>
        }
      />
      <Panel title="Permission matrix" actions={<span className="hidden text-xs text-text-muted lg:block">{SCOPE_HELP}</span>}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <SkeletonRows rows={12} cols={5} />
        ) : !roles.length ? (
          <EmptyState title="No roles" />
        ) : (
          <div className="max-h-[70vh] overflow-auto" tabIndex={0} role="region" aria-label="Permissions by role">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Permissions by role. {SCOPE_HELP}</caption>
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border">
                  <th scope="col" className="sticky left-0 z-20 min-w-52 bg-surface px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-text-muted">
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th key={r.id} scope="col" className="min-w-32 px-3 py-2 text-left align-bottom">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm font-semibold" title={r.description ?? undefined}>
                          {r.name}
                        </span>
                        {r.builtin ? (
                          <Lock className="size-3 shrink-0 text-text-faint" aria-label="Built-in, read-only" />
                        ) : (
                          <>
                            <IconButton label={`Edit ${r.name}`} size="xs" onClick={() => setEditing(r)}>
                              <Pencil className="size-3" />
                            </IconButton>
                            <IconButton label={`Delete ${r.name}`} size="xs" onClick={() => setDeleting(r)}>
                              <Trash2 className="size-3" />
                            </IconButton>
                          </>
                        )}
                      </div>
                      <div className="text-2xs font-normal text-text-faint">{r.builtin ? 'Built-in' : 'Custom'}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => (
                  <Fragment key={g.resource}>
                    <tr className="bg-surface-muted/60">
                      <th scope="rowgroup" colSpan={roles.length + 1} className="sticky left-0 px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-wide text-text-muted">
                        {resourceLabel(g.resource)}
                      </th>
                    </tr>
                    {g.perms.map((p) => (
                      <tr key={p} className="border-b border-border last:border-0 hover:bg-surface-muted/40">
                        <th scope="row" className="sticky left-0 bg-surface px-3 py-1.5 text-left font-normal">
                          <span className="block">{actionLabel(p)}</span>
                          <span className="block font-mono text-2xs text-text-faint">{p}</span>
                        </th>
                        {roles.map((r) => {
                          const s = r.grants[p];
                          return (
                            <td key={r.id} className="px-3 py-1.5">
                              {s ? <Badge tone={s === 'org' ? 'brand' : s === 'team' ? 'secondary' : 'neutral'}>{SCOPE_LABEL[s]}</Badge> : <span className="text-text-faint" aria-label="Not granted">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RoleDialog open={editing !== null} role={editing === 'new' ? null : editing} roles={roles} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete role?"
        description={deleting ? `“${deleting.name}” will be deleted. Members must be moved to another role first.` : undefined}
        confirmLabel="Delete role"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate({ id: deleting.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </>
  );
}

function RoleDialog({ open, role, roles, onOpenChange }: { open: boolean; role: Role | null; roles: Role[]; onOpenChange: (o: boolean) => void }) {
  const org = useOrg();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [grants, setGrants] = useState<Grants>({});
  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setGrants({ ...(role?.grants ?? {}) });
  }, [open, role]);

  const m = useOrgMutation<{ name: string; description: string | null; grants: Grants }, Role>(role ? 'PUT' : 'POST', role ? `/roles/${role.id}` : '/roles', {
    onSuccess: () => {
      toast.success(role ? 'Role updated' : 'Role created');
      onOpenChange(false);
    },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  /** A role can never grant more than the editor holds. */
  const allowedScopes = (p: Permission): Scope[] => {
    const mine = org.grants[p];
    if (!mine) return [];
    return mine === 'org' ? [...SCOPES] : [mine];
  };
  const count = Object.keys(grants).length;
  const copyFrom = (id: string) => {
    const src = roles.find((r) => r.id === id);
    if (!src) return;
    const next: Grants = {};
    for (const [p, s] of Object.entries(src.grants) as Array<[Permission, Scope]>) if (allowedScopes(p).includes(s)) next[p] = s;
    setGrants(next);
  };
  const submit = () => m.mutate({ name: name.trim(), description: description.trim() || null, grants });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) m.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={role ? `Edit ${role.name}` : 'Create custom role'}
      description={SCOPE_HELP}
      width={720}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-text-muted">{count} permissions granted</span>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={submit}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="role-name" error={err?.field('name')} required>
            <Input id="role-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          {!role && (
            <Field label="Start from" htmlFor="role-copy" hint="Copies grants you are allowed to give.">
              <Select id="role-copy" defaultValue="" onChange={(e) => copyFrom(e.target.value)}>
                <option value="">Nothing (empty role)</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Description" htmlFor="role-desc" className="sm:col-span-2" error={err?.field('description')}>
            <Textarea id="role-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-0" />
          </Field>
        </div>
        {err && !err.errors?.length && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {err.title}
          </p>
        )}
        <div className="rounded-sm border border-border">
          {GROUPS.map((g) => (
            <div key={g.resource} className="border-b border-border last:border-0">
              <div className="bg-surface-muted/60 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">{resourceLabel(g.resource)}</div>
              <ul className="divide-y divide-border">
                {g.perms.map((p) => {
                  const opts = allowedScopes(p);
                  const v = grants[p] ?? '';
                  const shown: Scope[] = v && !opts.includes(v) ? [...opts, v] : opts;
                  return (
                    <li key={p} className={cx('flex items-center justify-between gap-3 px-3 py-1.5', !opts.length && 'opacity-50')}>
                      <label htmlFor={`g-${p}`} className="min-w-0">
                        <span className="block text-sm">{actionLabel(p)}</span>
                        <span className="block font-mono text-2xs text-text-faint">{p}</span>
                      </label>
                      <Select
                        id={`g-${p}`}
                        className="w-32 shrink-0"
                        value={v}
                        disabled={!opts.length && !v}
                        title={!opts.length ? 'You do not hold this permission' : undefined}
                        onChange={(e) =>
                          setGrants((gr) => {
                            const next = { ...gr };
                            if (e.target.value) next[p] = e.target.value as Scope;
                            else delete next[p];
                            return next;
                          })
                        }
                      >
                        <option value="">—</option>
                        {shown.map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
