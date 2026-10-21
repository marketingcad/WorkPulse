'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, HardDrive, ImageOff, Play, ScanSearch, Trash2 } from 'lucide-react';
import type { ScreenshotCleanupRunDto, ScreenshotCleanupSettingsDto, ScreenshotStorageDto } from '@tallywork/contracts';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, KpiStrip, PageHeader, Panel, PermissionState, Select, SkeletonRows, Switch, fmtDate, fmtDateTime, useToast, type Tone } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { timeZones } from '@/components/settings/options';
import { HelpLink } from '@/components/help/help-link';

const PRESETS = [7, 14, 30, 60, 90];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Recorded image sizes: an estimate, so shown with "about". */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const STATUS: Record<ScreenshotCleanupRunDto['status'], { label: string; tone: Tone }> = {
  PREVIEWED: { label: 'Preview', tone: 'info' },
  RUNNING: { label: 'Running', tone: 'brand' },
  SUCCEEDED: { label: 'Completed', tone: 'success' },
  PARTIAL: { label: 'Partly completed', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Stopped', tone: 'neutral' },
};
const TRIGGER: Record<ScreenshotCleanupRunDto['trigger'], string> = { SCHEDULED: 'Scheduled', MANUAL: 'Manual', PREVIEW: 'Preview' };

interface Form {
  enabled: boolean;
  retention: string;
  custom: string;
  frequency: 'DAILY' | 'WEEKLY';
  runAt: string;
  weekday: number;
  timezone: string;
  retryFailed: boolean;
}

const toForm = (s: ScreenshotCleanupSettingsDto): Form => ({
  enabled: s.enabled,
  retention: PRESETS.includes(s.retention_days) ? String(s.retention_days) : 'custom',
  custom: String(s.retention_days),
  frequency: s.frequency,
  runAt: s.run_at,
  weekday: s.weekday,
  timezone: s.timezone ?? '',
  retryFailed: s.retry_failed,
});

/**
 * Screenshot retention & cleanup: how long screenshots are kept, when expired ones are deleted, and
 * the preview an administrator approves before the first deletion.
 */
export default function ScreenshotRetentionPage() {
  const org = useOrg();
  const canRead = org.can('retention:manage') || org.can('settings:security');
  const q = useOrgQuery<ScreenshotCleanupSettingsDto>(canRead ? '/screenshot-cleanup' : null, { refetchInterval: (query) => (query.state.data?.active_run ? 3000 : false) });
  if (!canRead) return <PermissionState />;
  return (
    <>
      <PageHeader title="Screenshot retention" description="How long screenshots are kept. Expired screenshots and their files are deleted automatically on a schedule you set." actions={<HelpLink article="screenshot-retention" />} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Panel>
          <SkeletonRows rows={6} cols={3} />
        </Panel>
      ) : (
        <div className="flex max-w-4xl flex-col gap-4">
          <StatusStrip s={q.data} />
          <PolicyPanel s={q.data} />
          <ApprovalPanel s={q.data} />
          <HistoryPanel active={!!q.data.active_run} />
        </div>
      )}
    </>
  );
}

function StatusStrip({ s }: { s: ScreenshotCleanupSettingsDto }) {
  const storage = useOrgQuery<ScreenshotStorageDto>('/screenshot-cleanup/storage');
  const last = s.last_run;
  return (
    <KpiStrip
      minItemWidth={190}
      items={[
        { label: 'Screenshots stored', value: storage.data ? storage.data.screenshots.toLocaleString() : '…', hint: storage.data ? `about ${fmtBytes(storage.data.recorded_bytes)}` : undefined, icon: <HardDrive />, tone: 'blue' },
        { label: 'Older than the retention period', value: storage.data ? storage.data.reclaimable_screenshots.toLocaleString() : '…', hint: storage.data ? `about ${fmtBytes(storage.data.reclaimable_bytes)} to free` : undefined, icon: <ImageOff />, tone: 'amber' },
        { label: 'Next cleanup', value: s.enabled ? fmtDateTime(s.next_run_at, s.effective_timezone) : 'Off', hint: s.enabled ? (s.approval.approved ? s.effective_timezone : 'Waiting for your approval') : 'Automatic cleanup is turned off', icon: <CalendarClock />, tone: 'violet' },
        { label: 'Last cleanup', value: last ? STATUS[last.status].label : 'Never', hint: last ? `${last.deleted.toLocaleString()} deleted · ${fmtDate(last.started_at)}` : undefined, icon: <CheckCircle2 />, tone: last?.status === 'SUCCEEDED' || !last ? 'green' : 'rose' },
      ]}
    />
  );
}

function PolicyPanel({ s }: { s: ScreenshotCleanupSettingsDto }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(s));
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmShorter, setConfirmShorter] = useState(false);
  useEffect(() => setF(toForm(s)), [s]);
  const zones = useMemo(() => timeZones(f.timezone || s.effective_timezone), [f.timezone, s.effective_timezone]);
  const days = f.retention === 'custom' ? Number(f.custom) : Number(f.retention);
  const daysError = !Number.isInteger(days) || days < 1 || days > 3650 ? 'Enter a whole number of days from 1 to 3650' : undefined;
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(s));
  const shorter = !daysError && days < s.retention_days;
  const m = useOrgMutation<unknown, ScreenshotCleanupSettingsDto>('PUT', '/screenshot-cleanup', { onSuccess: () => toast.success('Screenshot retention saved') });
  const readOnly = !s.can_manage;

  const save = async () => {
    setError(null);
    setConfirmShorter(false);
    try {
      await m.mutateAsync({ enabled: f.enabled, retention_days: days, frequency: f.frequency, run_at: f.runAt, weekday: f.weekday, timezone: f.timezone || null, retry_failed: f.retryFailed });
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Panel
      title="Retention policy"
      footer={readOnly ? 'Only administrators who manage data retention can change this.' : 'Screenshots captured more than this many days before a cleanup starts are deleted, with their files. Time, timesheets and invoices are never touched.'}
    >
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (shorter && s.approval.approved) setConfirmShorter(true);
          else void save();
        }}
      >
        <Switch id="cleanup-enabled" checked={f.enabled} disabled={readOnly} onCheckedChange={(v) => setF({ ...f, enabled: v })} label="Delete expired screenshots automatically" description="When off, nothing is deleted on a schedule. Screenshots already deleted are not restored." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Keep screenshots for" htmlFor="cleanup-days" error={error?.field('retention_days') ?? (f.retention === 'custom' ? daysError : undefined)} required>
            <div className="flex gap-2">
              <Select id="cleanup-days" value={f.retention} disabled={readOnly} onChange={(e) => setF({ ...f, retention: e.target.value })} className="min-w-0 flex-1">
                {PRESETS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
              {f.retention === 'custom' && <Input aria-label="Days to keep" type="number" min={1} max={3650} value={f.custom} disabled={readOnly} onChange={(e) => setF({ ...f, custom: e.target.value })} className="w-24" />}
            </div>
          </Field>
          <Field label="How often" htmlFor="cleanup-frequency">
            <Select id="cleanup-frequency" value={f.frequency} disabled={readOnly} onChange={(e) => setF({ ...f, frequency: e.target.value as Form['frequency'] })}>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">Once a week</option>
            </Select>
          </Field>
          {f.frequency === 'WEEKLY' && (
            <Field label="Day" htmlFor="cleanup-weekday">
              <Select id="cleanup-weekday" value={f.weekday} disabled={readOnly} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Time" htmlFor="cleanup-time" error={error?.field('run_at')} hint="A quiet hour, when few people work.">
            <Input id="cleanup-time" type="time" value={f.runAt} disabled={readOnly} onChange={(e) => setF({ ...f, runAt: e.target.value })} />
          </Field>
          <Field label="Time zone" htmlFor="cleanup-tz" error={error?.field('timezone')}>
            <Select id="cleanup-tz" value={f.timezone} disabled={readOnly} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              <option value="">Organization time zone ({s.timezone ? 'default' : s.effective_timezone})</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Switch id="cleanup-retry" checked={f.retryFailed} disabled={readOnly} onCheckedChange={(v) => setF({ ...f, retryFailed: v })} label="Retry failed deletions" description="If storage cannot delete a file, try again later (up to 5 times). The screenshot stays listed until its file is gone." />
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" loading={m.isPending} disabled={!dirty || !!daysError}>
              Save policy
            </Button>
            {shorter && s.approval.approved && <span className="text-xs text-warning">A shorter period needs a new preview and approval before anything is deleted.</span>}
          </div>
        )}
      </form>
      <ConfirmDialog
        open={confirmShorter}
        onOpenChange={setConfirmShorter}
        title="Keep screenshots for less time?"
        description={`Changing from ${s.retention_days} to ${days} days withdraws the current approval. Automatic cleanup pauses until you preview and approve again.`}
        confirmLabel="Save and withdraw approval"
        onConfirm={() => void save()}
        loading={m.isPending}
      />
    </Panel>
  );
}

function ApprovalPanel({ s }: { s: ScreenshotCleanupSettingsDto }) {
  const toast = useToast();
  const [preview, setPreview] = useState<ScreenshotCleanupRunDto | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'run' | null>(null);
  const previewM = useOrgMutation<undefined, ScreenshotCleanupRunDto>('POST', '/screenshot-cleanup/preview', { onSuccess: (r) => setPreview(r) });
  const approveM = useOrgMutation<{ preview_id: string }, ScreenshotCleanupSettingsDto>('POST', '/screenshot-cleanup/approve', { onSuccess: () => toast.success('Cleanup approved. It runs on the schedule from now on.') });
  const runM = useOrgMutation<undefined, ScreenshotCleanupRunDto>('POST', '/screenshot-cleanup/runs', { onSuccess: () => toast.success('Cleanup started. It runs in the background.') });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setConfirm(null);
  };
  const p = preview?.preview;
  const run = s.active_run;

  return (
    <Panel title="Preview and run" footer="A preview never deletes anything. The first deletion needs your approval of a preview; later scheduled runs use the saved policy.">
      <div className="flex flex-col gap-4 p-5">
        {/* Wrapping lines, not badges: badges never wrap and would overflow a phone screen. */}
        <div className="flex flex-col gap-1.5 text-sm" role="status">
          {s.approval.approved ? (
            <p className="flex items-start gap-1.5 text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Approved by {s.approval.approved_by_name ?? 'an administrator'} on {fmtDate(s.approval.approved_at)}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Not approved: nothing will be deleted until you preview and approve</span>
            </p>
          )}
          {run && (
            <p className="text-interactive">
              Cleanup running: {run.deleted.toLocaleString()} deleted{run.failed ? `, ${run.failed} failed` : ''}
            </p>
          )}
        </div>

        {s.can_manage && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<ScanSearch className="size-3.5" />} loading={previewM.isPending} onClick={() => void act(() => previewM.mutateAsync(undefined))}>
              Preview cleanup
            </Button>
            {s.approval.approved && (
              <Button variant="danger" icon={<Play className="size-3.5" />} disabled={!!run || runM.isPending} loading={runM.isPending} onClick={() => setConfirm('run')}>
                Run cleanup now
              </Button>
            )}
          </div>
        )}

        {p && preview && (
          <section aria-label="Preview result" className="rounded-md border border-border bg-surface-muted p-4">
            <h3 className="mb-2 text-sm font-semibold">Preview: what a cleanup would delete now</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Item label="Screenshots to delete" value={p.eligible.toLocaleString()} />
              <Item label="Storage to free" value={`about ${fmtBytes(p.eligible_bytes)}`} />
              <Item label="Captured before" value={fmtDateTime(preview.cutoff, s.effective_timezone)} />
              <Item label="Oldest" value={p.oldest_at ? fmtDateTime(p.oldest_at, s.effective_timezone) : '—'} />
              <Item label="Newest" value={p.newest_at ? fmtDateTime(p.newest_at, s.effective_timezone) : '—'} />
              <Item label="Left out (deletion keeps failing)" value={p.excluded.toLocaleString()} />
            </dl>
            <p className="mt-3 text-xs text-text-muted">Each run works out its own cutoff when it starts; screenshots are not deleted just because they appear in this preview.</p>
            {s.can_manage && !s.approval.approved && (
              <Button className="mt-3" variant="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setConfirm('approve')}>
                Approve cleanup
              </Button>
            )}
          </section>
        )}
      </div>
      <ConfirmDialog
        open={confirm === 'approve'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Approve screenshot cleanup?"
        description={`Screenshots older than ${s.retention_days} days will be deleted permanently, with their files, ${s.enabled ? 'at every scheduled run' : 'when you run a cleanup'}. This preview found ${p?.eligible.toLocaleString() ?? 0}. Deleted screenshots cannot be restored.`}
        confirmLabel="Approve"
        danger
        loading={approveM.isPending}
        onConfirm={() => preview && void act(() => approveM.mutateAsync({ preview_id: preview.id }))}
      />
      <ConfirmDialog
        open={confirm === 'run'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete expired screenshots now?"
        description={`Screenshots older than ${s.retention_days} days are deleted permanently, with their files. It runs in the background; you can leave this page.`}
        confirmLabel="Delete now"
        danger
        loading={runM.isPending}
        onConfirm={() => void act(() => runM.mutateAsync(undefined))}
      />
    </Panel>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

function HistoryPanel({ active }: { active: boolean }) {
  const q = useOrgQuery<ScreenshotCleanupRunDto[]>('/screenshot-cleanup/runs', { refetchInterval: active ? 3000 : false });
  return (
    <Panel title="Cleanup history">
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={4} cols={5} />
      ) : !q.data.length ? (
        <EmptyState icon={<Trash2 />} title="No cleanups yet" description="Previews and cleanup runs appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Cleanup history</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Deleted</th>
                <th className="px-4 py-2 text-right font-medium">Freed</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="tabular whitespace-nowrap px-4 py-2">{fmtDateTime(r.started_at)}</td>
                  <td className="px-4 py-2">
                    {TRIGGER[r.trigger]}
                    {r.requested_by_name && <span className="block text-xs text-text-muted">{r.requested_by_name}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </td>
                  <td className="tabular px-4 py-2 text-right">{r.preview ? `${r.preview.eligible.toLocaleString()} eligible` : r.deleted.toLocaleString()}</td>
                  <td className="tabular whitespace-nowrap px-4 py-2 text-right">{r.preview ? `~${fmtBytes(r.preview.eligible_bytes)}` : `~${fmtBytes(r.bytes_reclaimed)}`}</td>
                  <td className="max-w-72 px-4 py-2 text-xs text-text-muted">
                    {r.retention_days} days · before {fmtDate(r.cutoff)}
                    {r.failed > 0 && <span className="block text-danger">{r.failed} failed</span>}
                    {r.retries > 0 && <span className="block">{r.retries} retried</span>}
                    {r.error && <span className="block break-words">{r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
