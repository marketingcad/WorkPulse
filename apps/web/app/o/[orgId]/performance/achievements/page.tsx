'use client';
import { Suspense, lazy, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, ArchiveRestore, Hand, Plus, Sparkles, Zap } from 'lucide-react';
import type { AchievementAwardDto } from '@tallywork/contracts';
import { ACHIEVEMENT_CATEGORIES } from '@tallywork/domain';
import { Badge, Button, Checkbox, DataTable, EmptyState, ErrorState, PageHeader, Panel, PermissionState, PersonCell, SkeletonRows, Tabs, cx, fmtDate, useToast, type Column } from '@tallywork/ui';
import { errorMessage, qs, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/components/performance/i18n';
import '@/components/performance/messages/achievements';
import { HexBadge, tierSoft, tierText, type Tier } from '@/components/performance/ui';
import type { AchievementDefinition, Appreciation } from '@/components/performance/types';

// Forms load on demand, with their own strings: not part of the page's first load (the 250 KB budget).
const CreateAchievementDialog = lazy(() => import('@/components/performance/create-achievement-dialog'));
const RevokeDialog = lazy(() => import('@/components/performance/revoke-dialog'));
const RecognizeForm = lazy(() => import('@/components/performance/recognize-form').then((m) => ({ default: m.RecognizeForm })));

const TIERS: Tier[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
type Category = (typeof ACHIEVEMENT_CATEGORIES)[number];

/**
 * Achievements & recognition: the catalog (built-in and custom), the awards people have, and client
 * appreciation waiting for approval. Recognition is given here with a reason; the server decides who
 * may give what to whom.
 */
export default function AchievementsPage() {
  const org = useOrg();
  const toast = useToast();
  const scope = org.grants['achievements:read'];
  const allowed = scope === 'team' || scope === 'org';
  const canManage = org.can('achievements:manage');
  const canAward = org.can('achievements:award');
  // The "client sent appreciation" notification links here with ?tab=appreciation.
  const asked = useSearchParams().get('tab');
  const [tab, setTab] = useState(asked === 'appreciation' || asked === 'waiting' ? 'waiting' : asked === 'awarded' ? 'awarded' : 'catalog');
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AchievementAwardDto | null>(null);

  const defsQ = useOrgQuery<AchievementDefinition[]>(allowed ? `/performance/achievements${qs({ archived: showArchived ? 'true' : undefined })}` : null);
  const awardsQ = useOrgQuery<AchievementAwardDto[]>(allowed && tab === 'awarded' ? '/performance/awards?limit=200' : null);
  const waitingQ = useOrgQuery<Appreciation[]>(allowed && canAward ? '/performance/appreciations?status=PENDING' : null);
  const archive = useOrgMutation<{ id: string; action: 'archive' | 'restore' }>('POST', (b) => `/performance/achievements/${b.id}/${b.action}`, { invalidate: ['/performance'] });
  const decide = useOrgMutation<{ id: string; action: 'approve' | 'decline' }>('POST', (b) => `/performance/appreciations/${b.id}/${b.action}`, { invalidate: ['/performance'] });

  if (!allowed) return <PermissionState />;

  const defs = defsQ.data ?? [];
  const shown = defs.filter((d) => category === 'ALL' || d.category === category);
  const usedCategories = ACHIEVEMENT_CATEGORIES.filter((c) => defs.some((d) => d.category === c));
  const waiting = waitingQ.data ?? [];

  const setArchived = async (d: AchievementDefinition, archived: boolean) => {
    try {
      await archive.mutateAsync({ id: d.id, action: archived ? 'archive' : 'restore' });
      toast.success(t(archived ? 'perf.ach.archivedToast' : 'perf.ach.restoredToast', { name: d.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const decideOn = async (a: Appreciation, approve: boolean) => {
    try {
      await decide.mutateAsync({ id: a.id, action: approve ? 'approve' : 'decline' });
      toast.success(t(approve ? 'perf.ach.waiting.approved' : 'perf.ach.waiting.declined'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const tabs = [
    { value: 'catalog', label: t('perf.ach.tab.catalog'), count: defsQ.data ? shown.length : undefined },
    { value: 'awarded', label: t('perf.ach.tab.awarded') },
    ...(canAward ? [{ value: 'waiting', label: t('perf.ach.tab.waiting'), count: waitingQ.data ? waiting.length : undefined }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('perf.ach.title')}
        description={t('perf.ach.description')}
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('perf.ach.create')}
            </Button>
          )
        }
      />

      <div className={cx('grid items-start gap-4', canAward && 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
        <Tabs value={tab} onValueChange={setTab} items={tabs}>
          {tab === 'catalog' &&
            (defsQ.error ? (
              <ErrorState error={defsQ.error} onRetry={() => defsQ.refetch()} />
            ) : !defsQ.data ? (
              <div role="status" aria-label={t('perf.loading')}>
                <SkeletonRows rows={6} cols={3} />
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('perf.ach.categoryFilter')}>
                  {(['ALL', ...usedCategories] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                      className={cx('h-8 rounded-full border px-3 text-sm font-medium', category === c ? 'border-text bg-text text-surface' : 'border-border bg-surface text-text-muted hover:text-text')}
                    >
                      {c === 'ALL' ? t('perf.ach.allCategories') : t(`perf.ach.category.${c}`)}
                    </button>
                  ))}
                  {canManage && <Checkbox className="ml-auto" label={t('perf.ach.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
                </div>
                {shown.length === 0 ? (
                  <EmptyState title={t('perf.ach.empty')} description={t('perf.ach.emptyHint')} />
                ) : (
                  <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
                    {shown.map((d) => (
                      <AchievementCard key={d.id} d={d} canManage={canManage} busy={archive.isPending} onArchive={(a) => setArchived(d, a)} />
                    ))}
                  </ul>
                )}
              </div>
            ))}

          {tab === 'awarded' &&
            (awardsQ.error ? (
              <ErrorState error={awardsQ.error} onRetry={() => awardsQ.refetch()} />
            ) : (
              <div className="pt-2">
                <AwardsTable awards={awardsQ.data} canAward={canAward} onRevoke={setRevoking} />
              </div>
            ))}

          {tab === 'waiting' &&
            (waitingQ.error ? (
              <ErrorState error={waitingQ.error} onRetry={() => waitingQ.refetch()} />
            ) : !waitingQ.data ? (
              <div role="status" aria-label={t('perf.loading')}>
                <SkeletonRows rows={3} cols={2} />
              </div>
            ) : waiting.length === 0 ? (
              <EmptyState title={t('perf.ach.waiting.empty')} description={t('perf.ach.waiting.emptyHint')} />
            ) : (
              <ul className="space-y-3 pt-2">
                {waiting.map((a) => (
                  <li key={a.id} className="space-y-3 rounded-md border border-border bg-surface p-4 shadow-card">
                    <div>
                      <p className="text-sm font-semibold">{a.client.name}</p>
                      <p className="text-xs text-text-muted">{t('perf.ach.waiting.for', { who: a.member?.name ?? t('perf.ach.waiting.forTeam'), project: a.project.name })}</p>
                    </div>
                    <blockquote className="rounded-md bg-surface-sunken px-3 py-2 text-sm">“{a.message}”</blockquote>
                    <p className="text-xs text-text-muted">{t('perf.ach.waiting.hidden')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => decideOn(a, true)} loading={decide.isPending && decide.variables?.id === a.id && decide.variables.action === 'approve'}>
                        {t('perf.ach.waiting.approve')}
                      </Button>
                      <Button onClick={() => decideOn(a, false)} loading={decide.isPending && decide.variables?.id === a.id && decide.variables.action === 'decline'}>
                        {t('perf.ach.waiting.decline')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </Tabs>

        {canAward && (
          <Panel bodyClassName="p-4" title={t('perf.ach.recognize')} actions={<Badge tone="secondary">{t('perf.ach.mode.MANUAL')}</Badge>}>
            {defsQ.data ? (
              <Suspense fallback={<SkeletonRows rows={4} cols={1} />}>
                <RecognizeForm definitions={defsQ.data} />
              </Suspense>
            ) : (
              <SkeletonRows rows={4} cols={1} />
            )}
          </Panel>
        )}
      </div>

      {creating && (
        <Suspense fallback={null}>
          <CreateAchievementDialog onClose={() => setCreating(false)} />
        </Suspense>
      )}
      {revoking && (
        <Suspense fallback={null}>
          <RevokeDialog award={revoking} onClose={() => setRevoking(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** One achievement: its badge, how it is earned, its levels and how often it has been earned. */
function AchievementCard({ d, canManage, busy, onArchive }: { d: AchievementDefinition; canManage: boolean; busy: boolean; onArchive: (archived: boolean) => void }) {
  const levels = d.mode === 'AUTOMATIC' && d.thresholds?.length ? d.thresholds : null;
  const top: Tier = levels ? TIERS[Math.min(levels.length, 4) - 1]! : d.key === 'client_hero' || d.key === 'outstanding_contributor' ? 'PLATINUM' : 'GOLD';
  const unit = (n: number) => (d.metric ? t(`perf.ach.unit.${d.metric}`, { n }) : String(n));
  return (
    <li className={cx('flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card', d.archived && 'border-dashed')}>
      <div className="flex items-start gap-3">
        <HexBadge icon={d.icon} tier={top} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">{d.name}</h3>
          <p className="text-xs text-text-muted">{t(`perf.ach.category.${d.category}`)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={d.mode === 'AUTOMATIC' ? 'info' : 'secondary'} icon={d.mode === 'AUTOMATIC' ? <Zap className="size-3" /> : <Hand className="size-3" />}>
              {t(`perf.ach.mode.${d.mode}`)}
            </Badge>
            {d.custom && <Badge>{t('perf.ach.custom')}</Badge>}
            {d.archived && <Badge tone="warning">{t('perf.ach.archived')}</Badge>}
            {d.key === 'client_hero' && <Badge tone="brand" icon={<Sparkles className="size-3" />}>{t('perf.ach.byClient')}</Badge>}
          </div>
        </div>
      </div>
      <p className="text-sm text-text-muted">{d.description}</p>
      <div className="text-xs text-text-muted">{t(`perf.ach.recurrence.${d.recurrence}`)}</div>
      {levels ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={t('perf.ach.levels')}>
          {TIERS.map((tier, i) => (
            <li key={tier} className={cx('rounded-sm px-2 py-1.5', levels[i] !== undefined ? tierSoft(tier) : 'border border-dashed border-border')}>
              <span className={cx('block text-2xs font-bold uppercase tracking-wide', levels[i] !== undefined ? tierText(tier) : 'text-text-muted')}>{t(`perf.tier.${tier.toLowerCase()}`)}</span>
              <span className="block text-2xs text-text-muted tabular">{levels[i] !== undefined ? unit(levels[i]!) : '—'}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={cx('rounded-sm px-2 py-1.5 text-2xs font-bold uppercase tracking-wide', tierSoft(top), tierText(top))}>{t('perf.ach.oneLevel')}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-text-muted">
        <span className="tabular">
          {t('perf.ach.earned', { count: d.earned_count })}
          {d.earned_count > 0 && <> · {t('perf.ach.people', { count: d.people_count })}</>}
        </span>
        {d.last_awarded_at && <span>{t('perf.ach.last', { date: fmtDate(d.last_awarded_at) })}</span>}
        {canManage && d.custom && (
          <Button size="xs" variant="ghost" disabled={busy} icon={d.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} onClick={() => onArchive(!d.archived)} aria-label={`${t(d.archived ? 'perf.ach.restore' : 'perf.ach.archive')} ${d.name}`}>
            {t(d.archived ? 'perf.ach.restore' : 'perf.ach.archive')}
          </Button>
        )}
      </div>
    </li>
  );
}

function AwardsTable({ awards, canAward, onRevoke }: { awards: AchievementAwardDto[] | undefined; canAward: boolean; onRevoke: (a: AchievementAwardDto) => void }) {
  const columns: Column<AchievementAwardDto>[] = [
    {
      key: 'achievement',
      header: t('perf.ach.awards.col.achievement'),
      priority: 'primary',
      value: (a) => a.name,
      cell: (a) => (
        <span className="flex items-center gap-2">
          <HexBadge icon={a.icon} tier={(a.tier as Tier | null) ?? 'GOLD'} size={26} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{a.name}</span>
            {a.tier && <span className={cx('block text-xs', tierText(a.tier as Tier))}>{t(`perf.tier.${a.tier.toLowerCase()}`)}</span>}
          </span>
        </span>
      ),
    },
    { key: 'recipient', header: t('perf.ach.awards.col.recipient'), priority: 'secondary', value: (a) => a.recipient.name, cell: (a) => <PersonCell name={a.recipient.name} seed={a.recipient.id} sub={a.recipient.type === 'TEAM' ? t('perf.ach.awards.team') : undefined} /> },
    {
      key: 'source',
      header: t('perf.ach.awards.col.source'),
      value: (a) => a.source,
      cell: (a) => (
        <span className="text-sm">
          {t(`perf.recognition.source.${a.source}`)}
          {a.awarded_by && <span className="block text-xs text-text-muted">{t('perf.ach.awards.by', { name: a.awarded_by })}</span>}
          {a.visibility === 'PRIVATE' && <Badge className="mt-0.5">{t('perf.ach.awards.private')}</Badge>}
        </span>
      ),
    },
    { key: 'reason', header: t('perf.ach.awards.col.reason'), value: (a) => a.reason ?? '', cell: (a) => <span className="line-clamp-2 text-sm text-text-muted">{a.reason ?? '—'}</span> },
    { key: 'date', header: t('perf.ach.awards.col.date'), align: 'right', value: (a) => a.created_at, cell: (a) => <span className="tabular text-sm">{fmtDate(a.created_at)}</span> },
    ...(canAward
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            cell: (a: AchievementAwardDto) => (
              <Button size="xs" variant="ghost" onClick={() => onRevoke(a)} aria-label={`${t('perf.ach.awards.revoke')}: ${a.name}, ${a.recipient.name}`}>
                {t('perf.ach.awards.revoke')}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      rows={awards}
      loading={!awards}
      columns={columns}
      rowKey={(a) => a.id}
      searchable
      initialSort={{ key: 'date', dir: 'desc' }}
      empty={<EmptyState title={t('perf.ach.awards.empty')} description={t('perf.ach.awards.emptyHint')} />}
    />
  );
}
