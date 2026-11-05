'use client';
import { Suspense, lazy, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, Pencil, Plus, Target } from 'lucide-react';
import type { GoalDto, TeamDto } from '@tallywork/contracts';
import type { GoalSubject } from '@tallywork/domain';
import { addDaysToDate, periodBounds } from '@tallywork/domain';
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, ErrorState, FilterBar, KpiStrip, PageHeader, Panel, PermissionState, SegmentedControl, Select, SkeletonRows, cx, fmtDate, fmtDateTime, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/goals';

// The form loads on demand, with its own strings (the 250 KB first-load budget).
const GoalDialog = lazy(() => import('@/components/performance/goal-dialog'));

type Status = GoalDto['status'];
type Detail = GoalDto & { created_by_name: string | null; created_at: string | null; can_manage: boolean; history: Array<{ value: number; source: string; by: string | null; at: string | null }> };
const SUBJECTS: Array<GoalSubject | 'ALL'> = ['ALL', 'MEMBER', 'TEAM', 'PROJECT', 'ORG'];
const SOURCES = ['created', 'recalculation', 'task', 'milestone', 'timesheet', 'daily'];

const fmtValue = (g: Pick<GoalDto, 'metric'>, v: number) => (g.metric === 'APPROVED_HOURS' ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
function progressText(g: GoalDto) {
  if (g.metric === 'APPROVED_HOURS') return t('perf.g.progressHours', { current: fmtValue(g, g.current), target: fmtValue(g, g.target) });
  if (g.metric === 'ON_TIME_PCT') return t('perf.g.progressPct', { current: fmtValue(g, g.current), target: fmtValue(g, g.target) });
  return t('perf.g.progress', { current: fmtValue(g, g.current), target: fmtValue(g, g.target) });
}
function statusBadge(g: GoalDto) {
  if (g.status === 'ACTIVE' && g.pace) return <Badge tone={g.pace === 'AT_RISK' ? 'warning' : g.pace === 'AHEAD' ? 'success' : 'info'}>{t(`perf.g.pace.${g.pace}`)}</Badge>;
  return <Badge tone={g.status === 'COMPLETED' ? 'success' : g.status === 'MISSED' ? 'danger' : 'neutral'}>{t(`perf.g.status.${g.status}`)}</Badge>;
}

function Progress({ g, className }: { g: GoalDto; className?: string }) {
  const pct = Math.max(0, Math.min(100, g.progress_pct));
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-surface-sunken', className)} role="img" aria-label={t('perf.g.progressLabel', { pct: Math.round(g.progress_pct) })}>
      <div className={cx('h-full rounded-full', g.status === 'COMPLETED' ? 'bg-success' : g.status === 'MISSED' ? 'bg-danger' : g.pace === 'AT_RISK' ? 'bg-warning' : 'bg-interactive')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Goals & challenges: goals for people, teams, projects and the organization, each measured from
 * real work. Admins and managers; the API lists only goals the viewer may read, and decides whom
 * they may set goals for.
 */
export default function GoalsPage() {
  const org = useOrg();
  const scope = org.grants['goals:read'];
  const allowed = scope === 'team' || scope === 'org';
  const canManage = !!org.grants['goals:manage'] && org.grants['goals:manage'] !== 'own';
  // "New goal" links (the overview, a person's profile) open the form here: ?new=1[&member=<id>].
  const search = useSearchParams();
  const presetMember = search.get('member');
  const [subject, setSubject] = useState<GoalSubject | 'ALL'>('ALL');
  const [status, setStatus] = useState<Status | 'AT_RISK' | ''>('');
  const [teamId, setTeamId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<GoalDto | 'new' | null>(() => (canManage && search.get('new') === '1' ? 'new' : null));
  const teamsQ = useOrgQuery<TeamDto[]>(allowed && org.can('teams:read') ? '/teams' : null);
  // "At risk" is an active goal behind its pace: asked as ACTIVE, then narrowed here.
  const q = useOrgQuery<GoalDto[]>(allowed ? `/performance/goals${qs({ subject_type: teamId ? 'TEAM' : subject === 'ALL' ? undefined : subject, team_id: teamId || undefined, status: status === 'AT_RISK' ? 'ACTIVE' : status || undefined })}` : null);
  const goals = status === 'AT_RISK' ? q.data?.filter((g) => g.pace === 'AT_RISK') : q.data;
  // The summary counts every status (archived goals are left out by the API unless asked for).
  const allQ = useOrgQuery<GoalDto[]>(allowed ? '/performance/goals' : null);

  if (!allowed) return <PermissionState />;
  const today = todayIn(org.organization.timezone);
  const month = periodBounds('MONTH', today);
  const all = allQ.data ?? [];
  const challenges = all.filter((g) => g.subject_type === 'TEAM' && g.status === 'ACTIVE').sort((a, b) => b.progress_pct - a.progress_pct).slice(0, 4);
  const filtered = subject !== 'ALL' || status !== '' || teamId !== '';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('perf.g.title')}
        description={t('perf.g.description')}
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('perf.g.new')}
            </Button>
          )
        }
      />

      {allQ.data && (
        <KpiStrip
          minItemWidth={150}
          items={[
            { label: t('perf.g.kpi.active'), value: <span className="tabular">{all.filter((g) => g.status === 'ACTIVE').length}</span> },
            { label: t('perf.g.kpi.atRisk'), value: <span className="tabular">{all.filter((g) => g.status === 'ACTIVE' && g.pace === 'AT_RISK').length}</span> },
            { label: t('perf.g.kpi.completed'), value: <span className="tabular">{all.filter((g) => g.status === 'COMPLETED').length}</span> },
            { label: t('perf.g.kpi.missed'), value: <span className="tabular">{all.filter((g) => g.status === 'MISSED').length}</span> },
          ]}
        />
      )}

      {challenges.length >= 2 && (
        <Panel bodyClassName="p-4" title={t('perf.g.challenges')} actions={<span className="text-xs text-text-muted">{t('perf.g.challengesHint')}</span>}>
          <ol className="space-y-3">
            {challenges.map((g, i) => (
              <li key={g.id}>
                <button type="button" onClick={() => setOpen(g.id)} className="w-full space-y-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-interactive">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="w-5 font-semibold tabular text-text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{g.subject_name}</span>
                    <span className="truncate text-xs text-text-muted">{g.title}</span>
                    <span className="w-12 text-right font-semibold tabular">{Math.round(g.progress_pct)}%</span>
                  </span>
                  <Progress g={g} className="ml-7" />
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <FilterBar className="flex-wrap">
        <SegmentedControl label={t('perf.g.filter.subject')} value={subject} onChange={setSubject} options={SUBJECTS.map((s) => ({ value: s, label: t(`perf.g.subject.${s}`) }))} />
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="goal-status" className="text-text-muted">
            {t('perf.g.filter.status')}
          </label>
          <Select id="goal-status" value={status} onChange={(e) => setStatus(e.target.value as Status | 'AT_RISK' | '')} className="w-40">
            <option value="">{t('perf.g.status.ANY')}</option>
            {(['ACTIVE', 'AT_RISK', 'COMPLETED', 'MISSED', 'ARCHIVED'] as const).map((s) => (
              <option key={s} value={s}>
                {s === 'AT_RISK' ? t('perf.g.pace.AT_RISK') : t(`perf.g.status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {teamsQ.data && teamsQ.data.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="goal-team" className="text-text-muted">
              {t('perf.g.filter.team')}
            </label>
            <Select id="goal-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-44">
              <option value="">{t('perf.g.filter.allTeams')}</option>
              {teamsQ.data
                .filter((x) => !x.archived_at)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </FilterBar>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div role="status" aria-label={t('perf.loading')}>
          <SkeletonRows rows={6} cols={3} />
        </div>
      ) : goals!.length === 0 ? (
        <EmptyState
          icon={<Target className="size-5" />}
          title={t(filtered ? 'perf.g.emptyFiltered' : 'perf.g.empty')}
          description={filtered ? undefined : t('perf.g.emptyHint')}
          action={
            !filtered && canManage ? (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                {t('perf.g.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {goals!.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setOpen(g.id)} className="flex h-full w-full flex-col gap-3 rounded-md border border-border bg-surface p-4 text-left shadow-card hover:border-border-strong focus-visible:outline-2 focus-visible:outline-interactive">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{g.title}</span>
                    <span className="block text-xs text-text-muted">
                      {t(`perf.g.subjectOne.${g.subject_type}`)} · {g.subject_name}
                    </span>
                  </span>
                  {statusBadge(g)}
                </span>
                <span className="space-y-1">
                  <span className="flex justify-between text-sm">
                    <span className="font-medium tabular">{progressText(g)}</span>
                    <span className="text-text-muted tabular">{Math.round(g.progress_pct)}%</span>
                  </span>
                  <Progress g={g} />
                </span>
                <span className="mt-auto text-xs text-text-muted">
                  {t(`perf.g.source.${g.metric}`)}
                  <span className="block">{t('perf.g.dates', { start: fmtDate(g.start_date), end: fmtDate(g.end_date) })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <GoalDrawer id={open} onClose={() => setOpen(null)} onEdit={(g) => setEditing(g)} />
      {editing && (
        <Suspense fallback={null}>
          <GoalDialog goal={editing === 'new' ? null : editing} presetMember={editing === 'new' ? presetMember : null} defaults={{ start: today, end: month.end > today ? month.end : addDaysToDate(today, 30) }} onClose={() => setEditing(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** One goal: where its progress comes from, every change to it, and (for its managers) edit and archive. */
function GoalDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (g: GoalDto) => void }) {
  const toast = useToast();
  const [archiving, setArchiving] = useState(false);
  const q = useOrgQuery<Detail>(id ? `/performance/goals/${id}` : null, { retry: false });
  const archive = useOrgMutation<{ archived: boolean }, GoalDto>('PATCH', `/performance/goals/${id ?? ''}`, { invalidate: ['/performance'] });
  const g = q.data;
  const doArchive = async () => {
    try {
      await archive.mutateAsync({ archived: true });
      toast.success(t('perf.g.detail.archived'));
      setArchiving(false);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <Drawer
        open={!!id}
        onOpenChange={(o) => !o && onClose()}
        title={g?.title ?? t('perf.g.title')}
        subtitle={g ? `${t(`perf.g.subjectOne.${g.subject_type}`)} · ${g.subject_name}` : undefined}
        actions={
          g?.can_manage && g.status !== 'ARCHIVED' ? (
            <>
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => (onClose(), onEdit(g))}>
                {t('perf.g.detail.edit')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Archive className="size-3.5" />} onClick={() => setArchiving(true)}>
                {t('perf.g.detail.archive')}
              </Button>
            </>
          ) : undefined
        }
      >
        {q.error ? (
          q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t('perf.g.detail.notFound')} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !g ? (
          <SkeletonRows rows={5} cols={1} />
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold tabular">{progressText(g)}</span>
                {statusBadge(g)}
              </div>
              <Progress g={g} />
              <p className="text-xs text-text-muted">
                {t(`perf.g.metric.${g.metric}`)} · {t(`perf.g.source.${g.metric}`)}
              </p>
              <p className="text-xs text-text-muted">{t('perf.g.dates', { start: fmtDate(g.start_date), end: fmtDate(g.end_date) })}</p>
              {g.created_by_name && g.created_at && <p className="text-xs text-text-muted">{t('perf.g.detail.setBy', { name: g.created_by_name, date: fmtDate(g.created_at) })}</p>}
            </div>
            {g.description && (
              <section>
                <h3 className="text-sm font-semibold">{t('perf.g.detail.description')}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{g.description}</p>
              </section>
            )}
            <section>
              <h3 className="text-sm font-semibold">{t('perf.g.detail.history')}</h3>
              {g.history.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">{t('perf.g.detail.historyEmpty')}</p>
              ) : (
                <ol className="mt-2 space-y-2 border-l border-border pl-4">
                  {g.history.map((h, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium tabular">{fmtValue(g, h.value)}</span>
                      <span className="text-text-muted"> · {SOURCES.includes(h.source) ? t(`perf.g.detail.source.${h.source}`) : h.source}</span>
                      {h.at && <span className="block text-xs text-text-muted">{fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title={t('perf.g.detail.archiveTitle')} description={t('perf.g.detail.archiveText')} confirmLabel={t('perf.g.detail.archive')} danger loading={archive.isPending} onConfirm={doArchive} />
    </>
  );
}
