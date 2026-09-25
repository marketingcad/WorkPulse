'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import type { Permission, Scope } from '@tallywork/domain';
import { Badge, DataTable, EmptyState, ErrorState, KpiStrip, PageHeader, Panel, PermissionState, PersonCell, SegmentedControl, SkeletonRows, StatusBadge, fmtDate, fmtRelative, humanize, type Column } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

interface Review {
  roles: Array<{ id: string; key: string; name: string; members: number; grants: Partial<Record<Permission, Scope>> }>;
  members: Array<{ membership_id: string; name: string; email: string; role: string; is_owner: boolean; mfa_enabled: boolean }>;
  api_keys: Array<{ id: string; name: string; scopes: string[]; created_by: string; last_used_at: string | null; expires_at: string | null }>;
}
type Member = Review['members'][number];
type ApiKey = Review['api_keys'][number];

/** Grants worth a second look in a review: control over the organization, people, money or monitoring data. */
const SENSITIVE: Permission[] = ['org:update', 'roles:manage', 'members:manage', 'settings:security', 'retention:manage', 'api_keys:manage', 'webhooks:manage', 'audit:read', 'screenshots:read', 'screenshots:delete', 'members:read_pay_rate', 'rates:manage', 'invoices:manage', 'payments:manage', 'time:edit'];
const SCOPE_LABEL: Record<Scope, string> = { own: 'own', assigned: 'assigned', team: 'team', org: 'org' };
const RESOURCE_LABEL: Record<string, string> = { org: 'Organization', api_keys: 'API keys', manual_time: 'Manual time', time_off: 'Time off', settings: 'Security settings' };

function grouped(grants: Review['roles'][number]['grants']) {
  const m = new Map<string, Array<[string, Scope]>>();
  for (const [p, s] of Object.entries(grants) as Array<[Permission, Scope]>) {
    const [res, action] = p.split(':') as [string, string];
    m.set(res, [...(m.get(res) ?? []), [action, s]]);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function AccessReviewPage() {
  const org = useOrg();
  const router = useRouter();
  const allowed = org.can('members:manage') || org.can('settings:security');
  const q = useOrgQuery<Review>(allowed ? '/permissions/review' : null);
  const [memberView, setMemberView] = useState<'no-mfa' | 'all' | null>(null);
  const withoutMfa = useMemo(() => (q.data?.members ?? []).filter((m) => !m.mfa_enabled), [q.data]);
  if (!allowed) return <PermissionState />;

  const d = q.data;
  const view = memberView ?? (withoutMfa.length ? 'no-mfa' : 'all');
  const enforce = (org.organization.settings as { enforceMfa?: string }).enforceMfa ?? 'none';
  const memberCols: Column<Member>[] = [
    { key: 'name', header: 'Member', cell: (m) => <PersonCell name={m.name} sub={m.email} />, value: (m) => m.name, priority: 'primary' },
    { key: 'role', header: 'Role', cell: (m) => <span className="flex items-center gap-1.5">{m.role}{m.is_owner && <Badge tone="brand">Owner</Badge>}</span>, value: (m) => m.role, priority: 'secondary' },
    { key: 'mfa', header: 'Two-factor', cell: (m) => (m.mfa_enabled ? <StatusBadge status="ACTIVE" label="On" /> : <StatusBadge status="REJECTED" label="Off" />), value: (m) => (m.mfa_enabled ? 1 : 0), priority: 'primary' },
  ];
  const keyCols: Column<ApiKey>[] = [
    { key: 'name', header: 'Key', cell: (k) => <span className="font-medium">{k.name}</span>, value: (k) => k.name, priority: 'primary' },
    {
      key: 'scopes',
      header: 'Scopes',
      cell: (k) => (
        <span className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <Badge key={s} className="font-mono">
              {s}
            </Badge>
          ))}
        </span>
      ),
      priority: 'secondary',
    },
    { key: 'by', header: 'Created by', cell: (k) => k.created_by, value: (k) => k.created_by, priority: 'secondary' },
    { key: 'used', header: 'Last used', cell: (k) => (k.last_used_at ? fmtRelative(k.last_used_at) : <span className="text-text-faint">Never</span>), value: (k) => k.last_used_at ?? '', priority: 'primary' },
    {
      key: 'expires',
      header: 'Expires',
      cell: (k) => (!k.expires_at ? <span className="text-text-faint">Never</span> : new Date(k.expires_at) < new Date() ? <StatusBadge status="OVERDUE" label={`Expired ${fmtDate(k.expires_at)}`} /> : fmtDate(k.expires_at)),
      value: (k) => k.expires_at ?? '9999',
      priority: 'low',
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/settings/security`} className="hover:text-text hover:underline">
            Security & retention
          </Link>
        }
        title="Access review"
        description="Who can do what in this organization: roles and their grants, members and their two-factor status, and active API keys. Review it regularly and after people change jobs."
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <Panel>
          <SkeletonRows rows={6} cols={4} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <KpiStrip
            items={[
              { label: 'Active members', value: d.members.length },
              { label: 'Without two-factor', value: <span className={withoutMfa.length ? 'text-danger' : undefined}>{withoutMfa.length}</span>, hint: enforce === 'none' ? 'Not required' : enforce === 'admins' ? 'Required for admins' : 'Required for everyone' },
              { label: 'Roles', value: d.roles.length },
              { label: 'Active API keys', value: d.api_keys.length },
            ]}
          />

          <Panel
            title="Members"
            actions={
              <SegmentedControl
                size="xs"
                label="Members shown"
                value={view}
                onChange={setMemberView}
                options={[
                  { value: 'no-mfa', label: `Without two-factor (${withoutMfa.length})` },
                  { value: 'all', label: `All (${d.members.length})` },
                ]}
              />
            }
          >
            {view === 'no-mfa' && withoutMfa.length > 0 && (
              <p className="flex items-start gap-2 border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {withoutMfa.length} {withoutMfa.length === 1 ? 'member signs' : 'members sign'} in with a password only.
                  {enforce === 'none' && org.can('settings:security') && (
                    <>
                      {' '}
                      <Link href={`${org.base}/settings/security`} className="font-medium underline">
                        Require two-factor
                      </Link>
                    </>
                  )}
                </span>
              </p>
            )}
            <DataTable
              rows={view === 'no-mfa' ? withoutMfa : d.members}
              columns={memberCols}
              rowKey={(m) => m.membership_id}
              onRowClick={(m) => router.push(`${org.base}/workers/${m.membership_id}`)}
              searchable
              searchPlaceholder="Search members"
              caption="Members and their two-factor status"
              empty={<EmptyState title="Everyone uses two-factor" description="All active members sign in with an authenticator code." />}
            />
          </Panel>

          <Panel title="Roles" footer="Scopes: own = only their own data · assigned = projects they are assigned to · team = teams they manage · org = everyone.">
            <ul className="divide-y divide-border">
              {d.roles.map((r) => {
                const sensitive = SENSITIVE.filter((p) => r.grants[p]);
                const total = Object.keys(r.grants).length;
                return (
                  <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{r.name}</span>
                      <Badge>
                        <span className="tabular">{r.members}</span> {r.members === 1 ? 'member' : 'members'}
                      </Badge>
                      <span className="text-xs text-text-muted">
                        <span className="tabular">{total}</span> permissions
                      </span>
                    </div>
                    {sensitive.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {sensitive.map((p) => (
                          <Badge key={p} tone="warning" className="font-mono">
                            {p} · {SCOPE_LABEL[r.grants[p]!]}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-interactive hover:underline">All grants</summary>
                      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                        {grouped(r.grants).map(([res, actions]) => (
                          <div key={res} className="flex min-w-0 gap-2">
                            <dt className="w-28 shrink-0 font-medium text-text-muted">{RESOURCE_LABEL[res] ?? humanize(res)}</dt>
                            <dd className="min-w-0 text-text">{actions.map(([a, s]) => `${humanize(a)} (${SCOPE_LABEL[s]})`).join(', ')}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            title="API keys"
            actions={
              org.can('api_keys:manage') ? (
                <Link href={`${org.base}/developer/api-keys`} className="text-sm font-medium text-interactive hover:underline">
                  Manage API keys
                </Link>
              ) : undefined
            }
          >
            <DataTable rows={d.api_keys} columns={keyCols} rowKey={(k) => k.id} caption="Active API keys" empty={<EmptyState title="No active API keys" description="Keys created on the API keys page appear here with their scopes and last use." />} />
          </Panel>
        </div>
      )}
    </>
  );
}
