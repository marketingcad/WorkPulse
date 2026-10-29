'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageHeader, Panel, PermissionState, Select, SkeletonRows, Stat, StatusBadge, Switch, Textarea, cx, fmtDate, useToast } from '@tallywork/ui';
import type { OrgContextDto } from '@tallywork/contracts';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { SupportAccessPanel } from '@/components/security/support-access-panel';

interface Retention {
  data_class: string;
  keep_days: number;
  pending_keep_days: number | null;
  pending_from: string | null;
  min_days: number;
  purged_automatically: boolean;
}
interface RetentionPreview {
  data_class: string;
  keep_days: number;
  next_run_deletes: number;
  pending_keep_days: number | null;
  pending_from: string | null;
  pending_deletes: number | null;
}

const CLASS_INFO: Record<string, { label: string; help: string; unit: string }> = {
  SCREENSHOTS: { label: 'Screenshots', help: 'Screen captures and thumbnails.', unit: 'screenshots' },
  ACTIVITY: { label: 'Activity levels', help: 'Per-minute keyboard and mouse counts.', unit: 'activity minutes' },
  APPS: { label: 'Application usage', help: 'Foreground application names and durations.', unit: 'app records' },
  URLS: { label: 'Website usage', help: 'Visited domains or addresses, per policy.', unit: 'website records' },
  SESSIONS: { label: 'Tracking sessions', help: 'Timer sessions, idle and break records.', unit: 'records' },
  TIMESHEETS: { label: 'Timesheets', help: 'Submitted and approved timesheets. Kept at least 7 years.', unit: 'records' },
  INVOICES: { label: 'Invoices & payments', help: 'Financial records. Kept at least 7 years.', unit: 'records' },
  AUDIT: { label: 'Audit log', help: 'Who changed what. Kept at least 1 year.', unit: 'audit entries' },
  LOCATION: { label: 'Location', help: 'Not collected today (requires the mobile app).', unit: 'records' },
};

function humanDays(d: number): string {
  if (d >= 36500) return 'forever';
  if (d >= 365 && d % 365 === 0) return `${d / 365} ${d === 365 ? 'year' : 'years'}`;
  if (d >= 365) return `about ${Math.round((d / 365) * 10) / 10} years`;
  if (d >= 30 && d % 30 === 0) return `${d / 30} ${d === 30 ? 'month' : 'months'}`;
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

type EnforceMfa = 'none' | 'admins' | 'all';
interface SecurityForm {
  enforceMfa: EnforceMfa;
  sessionTtlHours: number;
  requireDeviceApproval: boolean;
  ipAllowlist: string;
}

function securityFromOrg(o: OrgContextDto['organization']): SecurityForm {
  const s = o.settings as Partial<{ enforceMfa: EnforceMfa; sessionTtlHours: number; requireDeviceApproval: boolean; ipAllowlist: string[] }>;
  return { enforceMfa: s.enforceMfa ?? 'none', sessionTtlHours: s.sessionTtlHours ?? 336, requireDeviceApproval: s.requireDeviceApproval ?? false, ipAllowlist: (s.ipAllowlist ?? []).join('\n') };
}

const ranges = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

export default function SecurityPage() {
  const org = useOrg();
  const canRetention = org.can('retention:manage') || org.can('settings:security');
  const canSecurity = org.can('settings:security') && org.can('org:update');
  if (!canRetention && !canSecurity) return <PermissionState />;

  return (
    <>
      <PageHeader
        title="Security & retention"
        description="How sign-in is protected, where the organization can be used from, and how long data is kept."
        actions={
          org.can('members:manage') || org.can('settings:security') ? (
            <Link href={`${org.base}/settings/access-review`} className="text-sm font-medium text-interactive hover:underline">
              Access review
            </Link>
          ) : undefined
        }
      />
      <div className="flex max-w-4xl flex-col gap-4">
        {canSecurity ? <SecuritySettingsPanel /> : <SecuritySummary />}
        {canRetention && <RetentionPanel />}
        {org.can('settings:security') && <SupportAccessPanel />}
      </div>
    </>
  );
}

function SecuritySummary() {
  const org = useOrg();
  const s = securityFromOrg(org.organization);
  const list = ranges(s.ipAllowlist);
  return (
    <Panel title="Security summary">
      <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Session lifetime" value={s.sessionTtlHours >= 48 ? `${Math.round(s.sessionTtlHours / 24)} days` : `${s.sessionTtlHours} hours`} />
        <div className="min-w-0">
          <dt className="text-xs text-text-muted">New desktop devices</dt>
          <dd className="mt-0.5">{s.requireDeviceApproval ? <StatusBadge status="PENDING" label="Admin approval required" /> : <StatusBadge status="ACTIVE" label="Approved automatically" />}</dd>
        </div>
        <Stat label="Two-factor authentication" value={s.enforceMfa === 'all' ? 'Required for everyone' : s.enforceMfa === 'admins' ? 'Required for admins' : 'Optional'} />
        <Stat label="Allowed networks" value={list.length ? `${list.length} ${list.length === 1 ? 'range' : 'ranges'}` : 'Anywhere'} />
      </dl>
    </Panel>
  );
}

function SecuritySettingsPanel() {
  const org = useOrg();
  const toast = useToast();
  const initial = useMemo(() => securityFromOrg(org.organization), [org.organization]);
  const [f, setF] = useState<SecurityForm>(initial);
  useEffect(() => setF(initial), [initial]);
  const set = <K extends keyof SecurityForm>(k: K, v: SecurityForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const list = ranges(f.ipAllowlist);
  const ttlBad = !Number.isInteger(f.sessionTtlHours) || f.sessionTtlHours < 1 || f.sessionTtlHours > 2160;
  const tooMany = list.length > 50;
  // The server refuses to require two-factor until the admin's own account uses it; say so before they try.
  const mfaQ = useQuery<{ enabled: boolean }, ApiError>({ queryKey: ['me', 'mfa'], queryFn: () => api<{ enabled: boolean }>('/me/mfa') });
  const ownMfaOff = mfaQ.data?.enabled === false;

  const m = useOrgMutation<{ settings: Record<string, unknown> }, OrgContextDto>('PATCH', '/', { onSuccess: () => toast.success('Security settings saved') });
  const err = m.error instanceof ApiError ? m.error : null;
  const mfaErr = err?.code === 'mfa_required_first' ? err.title : err?.field('settings.enforceMfa');
  const ipErr = err?.field('settings.ipAllowlist') ? err.title : err?.code === 'ip_allowlist_lockout' ? err.title : undefined;
  const ttlErr = err?.field('settings.sessionTtlHours');
  const otherErr = err && !mfaErr && !ipErr && !ttlErr ? err.title : null;

  const save = () => {
    if (ttlBad || tooMany) return;
    m.mutate({ settings: { enforceMfa: f.enforceMfa, sessionTtlHours: f.sessionTtlHours, requireDeviceApproval: f.requireDeviceApproval, ipAllowlist: list } });
  };

  return (
    <Panel
      title="Sign-in & access"
      actions={
        <>
          <Button
            size="sm"
            disabled={!dirty || m.isPending}
            onClick={() => {
              setF(initial);
              m.reset();
            }}
          >
            Discard
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || ttlBad || tooMany} loading={m.isPending} onClick={save}>
            Save security settings
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {otherErr && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {otherErr}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Require two-factor authentication"
            htmlFor="sec-mfa"
            error={mfaErr}
            hint={
              f.enforceMfa === 'none'
                ? 'People can turn on two-factor in their profile, but are not required to.'
                : `${f.enforceMfa === 'all' ? 'Everyone' : 'The owner and anyone who can change the organization or manage members'} must enter an authenticator code when signing in. Anyone without two-factor sees a setup screen and cannot use the organization until it is on. This applies to the web app; the desktop app signs in without it.`
            }
          >
            <Select id="sec-mfa" value={f.enforceMfa} onChange={(e) => set('enforceMfa', e.target.value as EnforceMfa)}>
              <option value="none">Not required</option>
              <option value="admins">Admins only</option>
              <option value="all">Everyone</option>
            </Select>
          </Field>
          <Field
            label="Session lifetime (hours)"
            htmlFor="sec-ttl"
            error={ttlErr ?? (ttlBad ? 'Between 1 and 2160 hours' : undefined)}
            hint={`People are signed out after ${f.sessionTtlHours >= 48 ? `${Math.round(f.sessionTtlHours / 24)} days` : `${f.sessionTtlHours} hours`}. If someone belongs to several organizations, the shortest lifetime applies. Max 2160 (90 days).`}
          >
            <Input id="sec-ttl" type="number" min={1} max={2160} className="tabular" value={f.sessionTtlHours} onChange={(e) => set('sessionTtlHours', e.target.value === '' ? 0 : Math.round(Number(e.target.value)))} />
          </Field>
        </div>
        {f.enforceMfa !== 'none' && ownMfaOff && (
          <p className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">
            Turn on two-factor for your own account first, so you are not locked out.{' '}
            <Link href={`${org.base}/me/profile#two-factor`} className="font-medium underline">
              Set it up in your profile
            </Link>
          </p>
        )}
        <Switch checked={f.requireDeviceApproval} onCheckedChange={(v) => set('requireDeviceApproval', v)} label="Require device approval" description="New desktop app installs stay pending until an admin approves them on the Devices page." />
        <Field
          label="Allowed networks (IP allowlist)"
          htmlFor="sec-ip"
          error={ipErr ?? (tooMany ? `At most 50 ranges (${list.length} entered)` : undefined)}
          hint={
            list.length
              ? `${list.length} ${list.length === 1 ? 'range' : 'ranges'}. The web app and API keys only work from these addresses; the desktop app is not affected. Your current address must be in the list.`
              : 'Empty: the organization can be used from anywhere.'
          }
        >
          <Textarea id="sec-ip" rows={5} spellCheck={false} className="font-mono text-xs" placeholder={'203.0.113.0/24\n198.51.100.7\n2001:db8::/32'} value={f.ipAllowlist} onChange={(e) => set('ipAllowlist', e.target.value)} />
        </Field>
        <p className="-mt-3 text-xs text-text-faint">One IPv4 or IPv6 address or CIDR range per line.</p>
      </form>
    </Panel>
  );
}

function RetentionPanel() {
  const org = useOrg();
  const toast = useToast();
  const canEdit = org.can('retention:manage');
  const q = useOrgQuery<Retention[]>('/retention-policies');
  const previewQ = useOrgQuery<RetentionPreview[]>('/retention-policies/preview');
  const preview = useMemo(() => new Map((previewQ.data ?? []).map((p) => [p.data_class, p])), [previewQ.data]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const reset = () => q.data && setDraft(Object.fromEntries(q.data.map((r) => [r.data_class, String(r.keep_days)])));
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const changed = useMemo(() => (q.data ?? []).filter((r) => draft[r.data_class] !== undefined && Number(draft[r.data_class]) !== r.keep_days), [q.data, draft]);
  const invalid = (q.data ?? []).some((r) => {
    const v = Number(draft[r.data_class]);
    return !Number.isInteger(v) || v < r.min_days || v > 36500;
  });
  const m = useOrgMutation<{ policies: Array<{ data_class: string; keep_days: number }> }, Retention[]>('PUT', '/retention-policies');
  const cancelM = useOrgMutation<{ policies: Array<{ data_class: string; keep_days: number }> }, Retention[]>('PUT', '/retention-policies');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const err = m.error instanceof ApiError ? m.error : null;

  const save = () => {
    const shorter = changed.some((r) => Number(draft[r.data_class]) < r.keep_days);
    m.mutate(
      { policies: changed.map((r) => ({ data_class: r.data_class, keep_days: Number(draft[r.data_class]) })) },
      { onSuccess: () => toast.success(shorter ? 'Retention saved. Shorter periods apply in 7 days; nothing is deleted before then.' : 'Retention saved') },
    );
  };
  // Saving the current period again cancels a scheduled shorter one.
  const keepCurrent = (r: Retention) => {
    setCancelling(r.data_class);
    cancelM.mutate(
      { policies: [{ data_class: r.data_class, keep_days: r.keep_days }] },
      {
        onSuccess: () => toast.success(`${CLASS_INFO[r.data_class]?.label ?? r.data_class}: the scheduled change was cancelled`),
        onError: (e) => toast.error(errorMessage(e)),
        onSettled: () => setCancelling(null),
      },
    );
  };

  return (
    <Panel
      title="Data retention"
      actions={
        canEdit && q.data ? (
          <>
            <Button size="sm" disabled={!changed.length || m.isPending} onClick={reset}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={!changed.length || invalid} loading={m.isPending} onClick={save}>
              Save retention
            </Button>
          </>
        ) : undefined
      }
      footer={
        <>
          A daily cleanup permanently deletes activity, application and website usage and audit entries older than their period. A shorter period is scheduled and applies after 7 days, so a mistake can be undone before anything is deleted; a longer one applies at once. Timesheets, invoices, sessions and location are never deleted automatically. Screenshots have their own schedule under{" "}
          <Link href={`${org.base}/settings/screenshot-retention`} className="text-interactive hover:underline">
            Screenshot retention
          </Link>
          .
        </>
      }
    >
      {err && !err.errors?.length && (
        <p role="alert" className="m-4 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {err.title}
        </p>
      )}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <SkeletonRows rows={8} cols={3} />
      ) : !q.data?.length ? (
        <EmptyState title="No retention rules" description="Retention defaults are created with the organization. Contact support if this list is empty." />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((r) => {
            const info = CLASS_INFO[r.data_class] ?? { label: r.data_class, help: '', unit: 'records' };
            const v = draft[r.data_class] ?? String(r.keep_days);
            const n = Number(v);
            const bad = !Number.isInteger(n) || n < r.min_days || n > 36500;
            const fieldErr = err?.field(`policies.${r.data_class}`);
            const p = preview.get(r.data_class);
            const id = `ret-${r.data_class}`;
            return (
              <li key={r.data_class} className={cx('flex flex-col gap-2 px-4 py-3', n !== r.keep_days && 'bg-interactive-soft/30')}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className="text-sm font-medium">
                        {info.label}
                      </label>
                      {!r.purged_automatically && <Badge>Kept · never deleted automatically</Badge>}
                    </span>
                    <p className="text-xs text-text-muted">{info.help}</p>
                    {r.purged_automatically && p && (
                      <p className="tabular text-xs text-text-muted">{p.keep_days >= 36500 ? 'Kept forever: nothing is deleted.' : p.next_run_deletes ? `Next daily run deletes ${p.next_run_deletes.toLocaleString()} ${info.unit}.` : 'Next daily run deletes nothing.'}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
                    <span className="inline-flex items-center gap-2">
                      <Input id={id} type="number" min={r.min_days} max={36500} className="tabular w-28 text-right" value={v} disabled={!canEdit} aria-invalid={bad || !!fieldErr} onChange={(e) => setDraft((d) => ({ ...d, [r.data_class]: e.target.value }))} />
                      <span className="text-xs text-text-muted">days</span>
                    </span>
                    <span className={cx('text-2xs', bad || fieldErr ? 'text-danger' : 'text-text-faint')}>{fieldErr ?? (bad ? `Minimum ${r.min_days} days` : `${humanDays(n)} · min ${humanDays(r.min_days)}`)}</span>
                  </div>
                </div>
                {r.pending_keep_days != null && r.pending_from && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge status="PENDING" label="Scheduled" />
                      <span>
                        Changes to {humanDays(r.pending_keep_days)} on {fmtDate(r.pending_from)}
                        {r.purged_automatically && p?.pending_deletes != null && <span className="tabular">{` · would delete ${p.pending_deletes.toLocaleString()} ${info.unit} now`}</span>}
                      </span>
                    </span>
                    {canEdit && (
                      <Button size="xs" loading={cancelling === r.data_class} disabled={cancelM.isPending && cancelling !== r.data_class} onClick={() => keepCurrent(r)}>
                        Keep current ({humanDays(r.keep_days)})
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
