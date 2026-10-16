'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientDto, ClientPortalSettingsDto, PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { Button, Checkbox, ConfirmDialog, ErrorState, Field, Input, PageHeader, Panel, PermissionState, Spinner, StatusBadge, useToast } from '@tallywork/ui';
import { PortalDashboard } from '@/components/portal/portal-dashboard';
import { errorMessage, qs, useOrgId, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Section = 'hours' | 'tasks' | 'activity' | 'screenshots';
const SECTIONS: Section[] = ['hours', 'tasks', 'activity', 'screenshots'];
type Access = ClientPortalSettingsDto['access'][number];

export default function ClientPortalSettingsPage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const canManage = org.can('clients:manage');

  // The settings endpoint doesn't return the client's name; look it up from the clients list so the
  // header can say which client this is (the list is cheap and usually already cached from that page).
  const clientsQ = useOrgQuery<ClientDto[]>(canManage ? `/clients${qs({ include_archived: true })}` : null);
  const clientName = clientsQ.data?.find((c) => c.id === id)?.name;

  const settingsQ = useOrgQuery<ClientPortalSettingsDto>(canManage ? `/clients/${id}/portal` : null);
  const qc = useQueryClient();
  const orgId = useOrgId();
  // The PUT answers with the saved settings: put them in the cache right away, so the controls unlock
  // on fresh state instead of waiting for the background refetch.
  const save = useOrgMutation<Record<string, unknown>, ClientPortalSettingsDto>('PUT', `/clients/${id}/portal`, {
    onSuccess: (r) => qc.setQueryData(['org', orgId, `/clients/${id}/portal`], r),
  });

  const [email, setEmail] = useState('');
  const invite = useOrgMutation<{ email: string }>('POST', `/clients/${id}/portal/invitations`, {
    onSuccess: () => {
      setEmail('');
      toast.success(t('portal.admin.inviteSent'));
    },
  });
  const [revoking, setRevoking] = useState<Access | null>(null);
  const revoke = useOrgMutation<{ id: string }>('DELETE', (b) => `/clients/${id}/portal/access/${b.id}`, {
    onSuccess: () => {
      toast.success(t('portal.admin.accessRevoked'));
      setRevoking(null);
    },
  });

  const [preview, setPreview] = useState(false);
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 29 * 86_400_000)), to: iso(new Date()) }));
  const previewQ = useOrgQuery<PortalSummaryDto>(preview ? `/clients/${id}/portal/preview${qs(range)}` : null);
  const shotsQ = useOrgQuery<PortalScreenshotDto[]>(preview && previewQ.data?.sections.screenshots ? `/clients/${id}/portal/preview/screenshots${qs(range)}` : null);

  if (!canManage) return <PermissionState />;
  if (settingsQ.error) return <ErrorState error={settingsQ.error} onRetry={() => settingsQ.refetch()} />;
  if (!settingsQ.data)
    return (
      <Panel>
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </Panel>
    );
  const s = settingsQ.data;

  // Every toggle saves from the last server state: while one save is in flight, lock the controls so a
  // second click cannot build its change on stale settings and undo the first.
  const saving = save.isPending;
  const toggleSection = (k: Section) => save.mutate({ sections: { [k]: !s.sections[k] } });
  const disabledSection = (k: Section) => (k === 'activity' && !s.can_enable.activity && !s.sections.activity) || (k === 'screenshots' && !s.can_enable.screenshots && !s.sections.screenshots);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/clients`} className="hover:text-text hover:underline">
            {t('nav.item.clients')}
          </Link>
        }
        title={clientName ? `${clientName} — ${t('portal.admin.title')}` : t('portal.admin.title')}
        description={t('portal.admin.description')}
        actions={
          <Button onClick={() => setPreview((p) => !p)} variant={preview ? 'secondary' : 'primary'} aria-pressed={preview}>
            {t('portal.admin.preview')}
          </Button>
        }
      />

      {save.error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      )}

      <Panel bodyClassName="flex flex-col gap-5 p-4">
        <Checkbox label={t('portal.admin.enabled')} checked={s.enabled} disabled={saving} onChange={() => save.mutate({ enabled: !s.enabled })} />

        <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
          <legend className="mb-1 text-sm font-semibold">{t('portal.admin.sections')}</legend>
          {SECTIONS.map((k) => (
            <Checkbox key={k} label={t(`portal.admin.${k}`)} checked={s.sections[k]} disabled={saving || disabledSection(k)} onChange={() => toggleSection(k)} />
          ))}
          <p className="mt-1 text-xs text-text-muted">{t('portal.admin.monitoringNote')}</p>
        </fieldset>

        <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
          <legend className="mb-1 text-sm font-semibold">{t('portal.admin.projects')}</legend>
          <Checkbox
            label={t('portal.admin.allProjects')}
            checked={s.project_ids === null}
            disabled={saving}
            onChange={() => save.mutate({ project_ids: s.project_ids === null ? s.projects.map((p) => p.id) : null })}
          />
          {s.project_ids !== null &&
            s.projects.map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                className="ml-6"
                checked={s.project_ids!.includes(p.id)}
                disabled={saving}
                onChange={() => save.mutate({ project_ids: s.project_ids!.includes(p.id) ? s.project_ids!.filter((x) => x !== p.id) : [...s.project_ids!, p.id] })}
              />
            ))}
        </fieldset>
      </Panel>

      <Panel title={t('portal.admin.viewers')} bodyClassName="p-4">
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) invite.mutate({ email: email.trim() });
          }}
        >
          <Field label={t('portal.admin.email')} htmlFor="portal-email" error={invite.error ? errorMessage(invite.error) : undefined} className="min-w-56 flex-1">
            <Input id="portal-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            {t('portal.admin.invite')}
          </Button>
        </form>
        {s.access.length === 0 ? (
          <p className="text-sm text-text-muted">{t('portal.admin.noViewers')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {s.access.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{a.name ?? a.email}</span>
                  <span className="ml-2 text-xs text-text-muted">{a.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={a.status} />
                  {a.status !== 'REVOKED' && (
                    <Button size="xs" variant="ghost" onClick={() => setRevoking(a)}>
                      {t('portal.admin.revoke')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {preview &&
        (previewQ.error ? (
          <Panel>
            <ErrorState error={previewQ.error} onRetry={() => previewQ.refetch()} />
          </Panel>
        ) : !previewQ.data ? (
          <Panel>
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          </Panel>
        ) : (
          <div className="overflow-hidden rounded-md border border-dashed border-border">
            <PortalDashboard
              summary={previewQ.data}
              screenshots={previewQ.data.sections.screenshots ? (shotsQ.data ?? []) : null}
              screenshotsLoading={previewQ.data.sections.screenshots && shotsQ.isLoading}
              range={range}
              onRange={setRange}
              embedded
            />
          </div>
        ))}

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('portal.admin.revokeTitle')}
        description={t('portal.admin.revokeBody', { name: revoking?.name ?? revoking?.email ?? '' })}
        confirmLabel={t('portal.admin.revoke')}
        danger
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ id: revoking.id }, { onError: (e) => toast.error(errorMessage(e)) })}
      />
    </div>
  );
}
