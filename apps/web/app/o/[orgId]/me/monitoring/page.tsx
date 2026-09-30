'use client';
import type { ReactNode } from 'react';
import { CircleCheck, CircleMinus, ShieldCheck } from 'lucide-react';
import type { ClientVisibilityDto, EffectivePolicyDto } from '@tallywork/contracts';
import { ErrorState, PageHeader, Panel, SkeletonRows, cx } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

function Item({ on, title, children }: { on: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {on ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-interactive" aria-hidden /> : <CircleMinus className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{title}</span>
          <span className={cx('text-xs font-semibold', on ? 'text-interactive' : 'text-text-muted')}>{on ? 'Yes' : 'No'}</span>
        </div>
        {children && <div className="mt-0.5 text-sm text-text-muted">{children}</div>}
      </div>
    </li>
  );
}

const hours = (s: number | null) => (s === null ? null : `${Math.round((s / 3600) * 10) / 10} hours`);

export default function MonitoringPage() {
  const org = useOrg();
  const q = useOrgQuery<EffectivePolicyDto>(`/workers/${org.membership.id}/effective-policy`);
  const v = useOrgQuery<ClientVisibilityDto>('/me/client-visibility');
  const p = q.data?.policy;

  return (
    <>
      <PageHeader title="What is monitored" description={`Exactly what ${org.organization.name} collects about your work in WorkPulse, based on the policy that applies to you right now.`} />
      {v.data && v.data.clients.length > 0 && (
        <p className="mb-4 rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning">
          {t('portal.visibility.web', { clients: v.data.clients.map((c) => `${c.client_name} (${[c.activity && t('portal.visibility.activity'), c.screenshots && t('portal.visibility.screenshots')].filter(Boolean).join(', ')})`).join('; ') })}
        </p>
      )}
      <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-surface px-4 py-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">When tracking is stopped, nothing is collected.</p>
          <p className="text-text-muted">Monitoring only happens while your timer is running. The desktop app always shows when it is tracking, and you are notified when these settings change. The desktop app asks you to review changes before it tracks again.</p>
        </div>
      </div>
      {q.error ? (
        <Panel>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Panel>
      ) : !p ? (
        <Panel>
          <SkeletonRows rows={8} cols={2} />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <Panel title="While you track time">
              <ul className="divide-y divide-border">
                <Item on title="Time on projects and tasks">
                  Start and stop times, and the project and task you chose.
                </Item>
                <Item on={p.activity.enabled} title="Activity levels">
                  {p.activity.enabled ? 'How many minutes had keyboard or mouse input, as counts per minute. Which keys you press, and what you type, are never recorded.' : 'Keyboard and mouse activity is not measured.'}
                </Item>
                <Item on={p.idle.enabled} title="Idle detection">
                  {p.idle.enabled
                    ? `After ${p.idle.thresholdMinutes} minutes without input, ${p.idle.behavior === 'prompt' ? 'you are asked whether to keep the idle time' : p.idle.behavior === 'pause' ? 'your timer pauses' : 'the time is kept and marked as idle'}.`
                    : 'Idle time is not detected.'}
                </Item>
                <Item on={p.screenshots.enabled && p.screenshots.perTenMinutes > 0} title="Screenshots">
                  {p.screenshots.enabled && p.screenshots.perTenMinutes > 0 ? (
                    <>
                      {p.screenshots.perTenMinutes} per 10 minutes{p.screenshots.blur ? ', blurred so text is unreadable' : ''}.{p.screenshots.notify ? ' You see a notice each time one is taken.' : ''}
                      {p.screenshots.workerCanDelete ? ` You can delete a screenshot${p.screenshots.deleteRemovesTime ? '; its 10 minutes of time are removed with it' : ''}.` : ' You cannot delete screenshots.'}
                    </>
                  ) : (
                    'No screenshots are taken.'
                  )}
                </Item>
                <Item on={p.apps.enabled} title="Applications">
                  {p.apps.enabled ? 'The name of the application in the foreground and how long it was used, not what you do inside it.' : 'Application names are not recorded.'}
                </Item>
                <Item on={p.urls.enabled} title="Websites">
                  {p.urls.enabled ? (
                    <>
                      {p.urls.mode === 'domain' ? 'Only the domain (for example, example.com), never the full address.' : 'The site address without query strings (for example, example.com/docs/page).'}
                      {p.urls.excludedDomains.length > 0 && ` Never recorded: ${p.urls.excludedDomains.join(', ')}.`}
                    </>
                  ) : (
                    'Websites are not recorded.'
                  )}
                </Item>
                <Item on={false} title="Location">
                  Location is never collected by the web or desktop app.
                </Item>
              </ul>
            </Panel>
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
            <Panel title="Limits and time rules">
              <ul className="divide-y divide-border">
                <Item on={p.limits.dailySeconds !== null || p.limits.weeklySeconds !== null} title="Tracking limits">
                  {p.limits.dailySeconds === null && p.limits.weeklySeconds === null
                    ? 'No daily or weekly limit.'
                    : [p.limits.dailySeconds !== null && `Up to ${hours(p.limits.dailySeconds)} per day`, p.limits.weeklySeconds !== null && `up to ${hours(p.limits.weeklySeconds)} per week`].filter(Boolean).join(', ') + '. Tracking stops at the limit.'}
                </Item>
                <Item on={p.manualTime.allowed} title="Manual time">
                  {p.manualTime.allowed ? `You can add time manually${p.manualTime.requiresApproval ? '; it needs approval' : ''}${p.manualTime.reasonRequired ? ' and a reason' : ''}.` : 'Adding time manually is turned off.'}
                </Item>
                <Item on={p.timeEdits.workerCanEdit} title="Editing your time">
                  {p.timeEdits.workerCanEdit ? `You can edit your own time entries${p.timeEdits.reasonRequired ? ' with a reason' : ''}. Every edit is logged.` : 'Only managers can edit time entries.'}
                </Item>
              </ul>
            </Panel>
            <Panel title="Who can see this data">
              <div className="flex flex-col gap-2 p-4 text-sm text-text-muted">
                <p>
                  <span className="font-medium text-text">You</span> can see everything collected about you on your Activity, Timesheet and Sessions pages.
                </p>
                <p>
                  <span className="font-medium text-text">Your managers</span> can see the data of the teams they manage, and <span className="font-medium text-text">organization admins</span> can see it for everyone in {org.organization.name}.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
