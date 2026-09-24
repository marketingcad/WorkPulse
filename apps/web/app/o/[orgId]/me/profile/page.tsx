'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Laptop } from 'lucide-react';
import type { DeviceDto, MeDto } from '@tallywork/contracts';
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Panel, Select, SkeletonRows, StatusBadge, Stat, fmtRelative, useToast } from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { browserTimeZone, timeZones } from '@/components/settings/options';

interface Pref {
  type: string;
  in_app: boolean;
  email: boolean;
}
const NOTIFICATION_TYPES: Array<{ type: string; label: string; manager?: boolean }> = [
  { type: 'timesheet.approved', label: 'My timesheet was approved' },
  { type: 'timesheet.rejected', label: 'My timesheet was rejected' },
  { type: 'time_off.approved', label: 'My time off was approved' },
  { type: 'manual_time.approved', label: 'My manual time was approved' },
  { type: 'budget.warning', label: 'A budget reached its warning threshold', manager: true },
  { type: 'policy.changed', label: 'Monitoring settings that apply to me changed' },
];

export default function ProfilePage() {
  const org = useOrg();
  const meQ = useQuery<MeDto, ApiError>({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const me = meQ.data;
  return (
    <>
      <PageHeader title="Profile" description="Your account, sign-in, devices and notifications." />
      <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Account">
          {meQ.error ? (
            <ErrorState error={meQ.error} onRetry={() => meQ.refetch()} />
          ) : !me ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={me.user.name} size={40} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{me.user.name}</div>
                  <div className="truncate text-sm text-text-muted">{me.user.email}</div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <Stat label="Role in this organization" value={org.membership.role_name} />
                <Stat label="Email" value={me.user.email_verified ? <StatusBadge status="APPROVED" label="Verified" /> : <StatusBadge status="PENDING" label="Not verified" />} />
              </dl>
              <TimezoneForm />
            </div>
          )}
        </Panel>
        <PasswordPanel />
        <DevicesPanel />
        <NotificationsPanel />
      </div>
    </>
  );
}

function TimezoneForm() {
  const org = useOrg();
  const toast = useToast();
  const [tz, setTz] = useState(org.membership.timezone);
  useEffect(() => setTz(org.membership.timezone), [org.membership.timezone]);
  const zones = useMemo(() => timeZones(tz), [tz]);
  const m = useOrgMutation<{ timezone: string }>('PATCH', `/workers/${org.membership.id}`, { onSuccess: () => toast.success('Time zone saved') });
  const detected = browserTimeZone();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ timezone: tz }, { onError: (err) => toast.error(errorMessage(err)) });
      }}
    >
      <Field label="My time zone" htmlFor="me-tz" hint={detected !== tz ? `Your browser reports ${detected}.` : 'Used for your schedule, attendance and dates you see.'} className="min-w-56 flex-1">
        <Select id="me-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Field>
      {detected !== tz && (
        <Button type="button" variant="ghost" onClick={() => setTz(detected)}>
          Use {detected.split('/').pop()?.replace(/_/g, ' ')}
        </Button>
      )}
      <Button type="submit" variant="primary" disabled={tz === org.membership.timezone} loading={m.isPending}>
        Save
      </Button>
    </form>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;
  const short = next.length > 0 && next.length < 10;
  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api('/auth/password/change', { method: 'POST', body: { current_password: current, new_password: next } });
      toast.success('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      else toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Panel title="Password">
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (current && next && !mismatch && !short) void submit();
        }}
      >
        <Field label="Current password" htmlFor="pw-current" error={error?.field('current_password') ?? (error?.code === 'invalid_password' ? error.title : undefined)}>
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint="At least 10 characters." error={error?.field('new_password') ?? (short ? 'Use at least 10 characters' : undefined)}>
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? 'Passwords do not match' : undefined}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && !error.errors?.length && error.code !== 'invalid_password' && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {error.title}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={loading} disabled={!current || !next || mismatch || short}>
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function DevicesPanel() {
  const org = useOrg();
  const toast = useToast();
  const q = useOrgQuery<DeviceDto[]>('/devices');
  const mine = (q.data ?? []).filter((d) => d.membership_id === org.membership.id);
  const [revoking, setRevoking] = useState<DeviceDto | null>(null);
  const revoke = useOrgMutation<{ id: string }>('POST', (b) => `/devices/${b.id}/revoke`, {
    onSuccess: () => {
      toast.success('Device signed out');
      setRevoking(null);
    },
  });
  const canManage = org.can('devices:manage');
  return (
    <Panel title="My devices">
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <SkeletonRows rows={2} cols={3} />
      ) : !mine.length ? (
        <EmptyState icon={<Laptop className="size-5" />} title="No desktop app connected" description="Install the Tallywork desktop app and sign in to track time with activity." />
      ) : (
        <ul className="divide-y divide-border">
          {mine.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <Laptop className="size-4 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{d.name}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="truncate text-xs text-text-muted">
                  {d.platform}
                  {d.os_version && ` ${d.os_version}`}
                  {d.agent_version && ` · app ${d.agent_version}`} · last seen {fmtRelative(d.last_seen_at)}
                </div>
              </div>
              {canManage && d.status !== 'REVOKED' && (
                <Button size="xs" variant="ghost" onClick={() => setRevoking(d)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this device?"
        description={revoking ? `“${revoking.name}” will be signed out and stop tracking. Sign in again from the desktop app to reconnect.` : undefined}
        confirmLabel="Revoke device"
        danger
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
      <div className="border-t border-border px-4 py-2 text-xs">
        <Link href={`${org.base}/me/monitoring`} className="font-medium text-interactive hover:underline">
          See what the desktop app monitors →
        </Link>
      </div>
    </Panel>
  );
}

function NotificationsPanel() {
  const org = useOrg();
  const toast = useToast();
  const q = useOrgQuery<Pref[]>('/notification-preferences');
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const base = useMemo(() => {
    const saved = new Map((q.data ?? []).map((p) => [p.type, p]));
    // Server defaults when nothing is saved: in-app on, email off.
    return Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.type, saved.get(t.type) ?? { type: t.type, in_app: true, email: false }]));
  }, [q.data]);
  useEffect(() => setPrefs(base), [base]);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(base);
  const m = useOrgMutation<{ preferences: Pref[] }, Pref[]>('PUT', '/notification-preferences', { onSuccess: () => toast.success('Notification preferences saved') });
  const types = NOTIFICATION_TYPES.filter((t) => !t.manager || org.can('budgets:read'));
  const toggle = (type: string, k: 'in_app' | 'email') => setPrefs((p) => ({ ...p, [type]: { ...p[type]!, [k]: !p[type]![k] } }));

  return (
    <Panel
      title="Notifications"
      actions={
        <Button size="sm" variant="primary" disabled={!dirty} loading={m.isPending} onClick={() => m.mutate({ preferences: Object.values(prefs) }, { onError: (e) => toast.error(errorMessage(e)) })}>
          Save
        </Button>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <SkeletonRows rows={5} cols={3} />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Notification preferences</caption>
          <thead>
            <tr className="border-b border-border bg-surface-muted/60 text-2xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-4 py-1.5 text-left font-semibold">
                Notify me when
              </th>
              <th scope="col" className="w-20 px-2 py-1.5 text-center font-semibold">
                In app
              </th>
              <th scope="col" className="w-20 px-2 py-1.5 text-center font-semibold">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {types.map((t) => {
              const p = prefs[t.type];
              if (!p) return null;
              return (
                <tr key={t.type}>
                  <td className="px-4 py-2">
                    {t.label}
                    {t.type === 'policy.changed' && <Badge className="ml-2">Recommended</Badge>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" aria-label={`${t.label}: in app`} checked={p.in_app} onChange={() => toggle(t.type, 'in_app')} className="size-4 accent-[var(--color-interactive)]" />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" aria-label={`${t.label}: email`} checked={p.email} onChange={() => toggle(t.type, 'email')} className="size-4 accent-[var(--color-interactive)]" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
