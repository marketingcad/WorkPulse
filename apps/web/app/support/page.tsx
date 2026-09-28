'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, Lock, Search } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, ErrorState, Input, PageHeader, Panel, SkeletonRows, Stat, StatusBadge, fmtDate, fmtDateTime, fmtRelative, type Column } from '@tallywork/ui';
import { ApiError, api } from '@/lib/api';

interface OrgHit {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}
interface Overview {
  organization: { id: string; name: string; slug: string; timezone: string; currency: string; created_at: string };
  owner: { name: string; email: string } | null;
  members: number;
  devices: Record<string, number>;
  agent_versions: Record<string, number>;
  live_sessions: number;
  last_time_entry_at: string | null;
  health: { parked_events: number; webhooks: { endpoints: number; disabled: number; failing: number }; integrations_in_error: number; exports_failed_24h: number };
  security: { enforce_mfa: string; session_ttl_hours: number; ip_allowlist_ranges: number; device_approval: boolean };
  support_access: { expires_at: string; reason: string } | null;
}
interface Details {
  grant: { expires_at: string; reason: string };
  members: Array<{ membership_id: string; name: string; email: string; role: string; status: string; is_owner: boolean }>;
  devices: Array<{ id: string; name: string; platform: string; status: string; version: string | null; lastSeenAt: string | null; lastSyncAt: string | null }>;
  audit: Array<{ action: string; actor_type: string; target_type: string | null; created_at: string }>;
}

/**
 * Support console for Tallywork staff (SUPPORT_STAFF_EMAILS, two-factor session). Counts and
 * health for any organization; members, devices and the audit log only while that organization
 * has granted access. Every view is recorded in the organization's audit log.
 */
export default function SupportPage() {
  const me = useQuery<{ email: string }, ApiError>({ queryKey: ['support', 'me'], queryFn: () => api('/support/me'), retry: false });
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const hits = useQuery<OrgHit[], ApiError>({ queryKey: ['support', 'orgs', term], queryFn: () => api(`/support/orgs?q=${encodeURIComponent(term)}`), enabled: term.length >= 2 && me.isSuccess });

  if (me.isLoading) return <main className="p-6"><SkeletonRows rows={4} /></main>;
  if (me.error) {
    const mfa = me.error.status === 403;
    return (
      <main className="mx-auto max-w-lg p-6">
        <EmptyState
          icon={<Lock className="size-5" />}
          title={mfa ? 'Two-factor authentication required' : 'Page not found'}
          description={mfa ? 'The support console needs a session verified with two-factor authentication. Sign out and sign in again with your code.' : 'This page does not exist.'}
          action={<Link href="/" className="text-sm font-medium text-interactive hover:underline">Back to WorkPulse</Link>}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="Support console" description={`Signed in as ${me.data!.email}. Every organization you open is recorded in its audit log.`} />
      <Panel title="Find an organization">
        <form
          className="flex flex-wrap gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
            setOrgId(null);
          }}
          role="search"
        >
          <label htmlFor="support-q" className="sr-only">Organization name, slug, id or owner email</label>
          <Input id="support-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Organization name, slug, id or owner email" className="min-w-64 flex-1" />
          <Button type="submit" variant="primary" icon={<Search className="size-3.5" />} disabled={q.trim().length < 2}>
            Search
          </Button>
        </form>
        {term.length >= 2 &&
          (hits.error ? (
            <ErrorState error={hits.error} onRetry={() => hits.refetch()} />
          ) : (
            <DataTable
              rows={hits.data}
              loading={hits.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOrgId(r.id)}
              columns={[
                { key: 'name', header: 'Organization', priority: 'primary', value: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
                { key: 'slug', header: 'Slug', value: (r) => r.slug, cell: (r) => <span className="font-mono text-xs">{r.slug}</span> },
                { key: 'created', header: 'Created', value: (r) => r.created_at, cell: (r) => fmtDate(r.created_at) },
              ]}
              empty={<EmptyState title="No organizations match" description="Try the owner’s email or part of the name." />}
            />
          ))}
      </Panel>
      {orgId && <OrgView id={orgId} />}
    </main>
  );
}

function OrgView({ id }: { id: string }) {
  const ov = useQuery<Overview, ApiError>({ queryKey: ['support', 'org', id], queryFn: () => api(`/support/orgs/${id}`) });
  const granted = !!ov.data?.support_access;
  const details = useQuery<Details, ApiError>({ queryKey: ['support', 'details', id], queryFn: () => api(`/support/orgs/${id}/details`), enabled: granted, retry: false });
  if (ov.error) return <ErrorState error={ov.error} onRetry={() => ov.refetch()} />;
  if (!ov.data) return <Panel title="Loading"><SkeletonRows rows={4} /></Panel>;
  const o = ov.data;
  const health = [
    o.health.parked_events ? `${o.health.parked_events} parked event(s)` : null,
    o.health.webhooks.disabled ? `${o.health.webhooks.disabled} webhook endpoint(s) disabled` : null,
    o.health.webhooks.failing ? `${o.health.webhooks.failing} webhook endpoint(s) failing` : null,
    o.health.integrations_in_error ? `${o.health.integrations_in_error} integration(s) in error` : null,
    o.health.exports_failed_24h ? `${o.health.exports_failed_24h} export(s) failed in 24h` : null,
  ].filter(Boolean);

  return (
    <>
      <Panel title={o.organization.name}>
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Owner" value={o.owner ? `${o.owner.name} · ${o.owner.email}` : '—'} />
          <Stat label="Members" value={o.members} />
          <Stat label="Tracking now" value={o.live_sessions} />
          <Stat label="Last time entry" value={fmtRelative(o.last_time_entry_at)} />
          <Stat label="Devices" value={Object.entries(o.devices).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ') || 'none'} />
          <Stat label="App versions" value={Object.entries(o.agent_versions).map(([v, n]) => `${v} (${n})`).join(', ') || '—'} />
          <Stat label="Time zone / currency" value={`${o.organization.timezone} · ${o.organization.currency}`} />
          <Stat label="Created" value={fmtDate(o.organization.created_at)} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 text-xs">
          <Badge tone={o.security.enforce_mfa === 'none' ? 'neutral' : 'success'}>2FA required: {o.security.enforce_mfa}</Badge>
          <Badge tone="neutral">Sessions {o.security.session_ttl_hours}h</Badge>
          <Badge tone="neutral">{o.security.ip_allowlist_ranges ? `IP allowlist (${o.security.ip_allowlist_ranges})` : 'No IP allowlist'}</Badge>
          <Badge tone="neutral">Device approval {o.security.device_approval ? 'on' : 'off'}</Badge>
        </div>
        <div className="border-t border-border px-4 py-3 text-sm">
          {health.length ? (
            <ul className="list-inside list-disc text-warning">{health.map((h) => <li key={h}>{h}</li>)}</ul>
          ) : (
            <span className="text-success">No health problems.</span>
          )}
        </div>
      </Panel>

      {!granted ? (
        <Panel title="Members, devices and audit log">
          <div className="flex items-start gap-3 p-4 text-sm text-text-muted">
            <LifeBuoy className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Not shared. Ask an admin of this organization to grant support access under Settings → Security → Support access. It is read-only and expires on its own.</p>
          </div>
        </Panel>
      ) : details.error ? (
        <ErrorState error={details.error} onRetry={() => details.refetch()} />
      ) : (
        <>
          <p role="status" className="rounded-md border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
            Access granted until {fmtDateTime(o.support_access!.expires_at)}: “{o.support_access!.reason}”
          </p>
          <Panel title="Members">
            <DataTable
              rows={details.data?.members}
              loading={details.isLoading}
              rowKey={(m) => m.membership_id}
              searchable
              columns={[
                { key: 'name', header: 'Name', priority: 'primary', value: (m) => m.name, cell: (m) => <span className="font-medium">{m.name}{m.is_owner && <Badge tone="brand" className="ml-2">Owner</Badge>}</span> },
                { key: 'email', header: 'Email', value: (m) => m.email, cell: (m) => m.email },
                { key: 'role', header: 'Role', value: (m) => m.role, cell: (m) => m.role },
                { key: 'status', header: 'Status', value: (m) => m.status, cell: (m) => <StatusBadge status={m.status} /> },
              ] satisfies Column<Details['members'][number]>[]}
            />
          </Panel>
          <Panel title="Devices">
            <DataTable
              rows={details.data?.devices}
              loading={details.isLoading}
              rowKey={(d) => d.id}
              columns={[
                { key: 'name', header: 'Device', priority: 'primary', value: (d) => d.name, cell: (d) => <span className="font-medium">{d.name}</span> },
                { key: 'platform', header: 'Platform', value: (d) => d.platform, cell: (d) => d.platform },
                { key: 'version', header: 'Version', value: (d) => d.version ?? '', cell: (d) => d.version ?? '—' },
                { key: 'status', header: 'Status', value: (d) => d.status, cell: (d) => <StatusBadge status={d.status} /> },
                { key: 'seen', header: 'Last seen', value: (d) => d.lastSeenAt ?? '', cell: (d) => fmtRelative(d.lastSeenAt) },
                { key: 'sync', header: 'Last sync', value: (d) => d.lastSyncAt ?? '', cell: (d) => fmtRelative(d.lastSyncAt) },
              ] satisfies Column<Details['devices'][number]>[]}
            />
          </Panel>
          <Panel title="Audit log (latest 200)">
            <DataTable
              rows={details.data?.audit}
              loading={details.isLoading}
              rowKey={(a) => `${a.created_at}-${a.action}`}
              searchable
              columns={[
                { key: 'when', header: 'When', priority: 'primary', value: (a) => a.created_at, cell: (a) => fmtDateTime(a.created_at) },
                { key: 'action', header: 'Action', value: (a) => a.action, cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
                { key: 'actor', header: 'By', value: (a) => a.actor_type, cell: (a) => a.actor_type },
                { key: 'target', header: 'On', value: (a) => a.target_type ?? '', cell: (a) => a.target_type ?? '—' },
              ] satisfies Column<Details['audit'][number]>[]}
            />
          </Panel>
        </>
      )}
    </>
  );
}
