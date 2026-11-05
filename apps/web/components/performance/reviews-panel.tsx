'use client';
import { useState } from 'react';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Panel, SkeletonRows, cx, fmtDate, useToast } from '@tallywork/ui';
import { errorMessage, useOrgMutation } from '@/lib/api';
import { t } from './i18n';
import './messages/reviews';
import type { Review } from './types';

/** Manager feedback on a profile: reviews, with the private note clearly marked. Loaded with the reviews. */
export default function Reviews({ name, reviews, canWrite, onEdit }: { name: string; reviews: { data?: Review[]; error: unknown; refetch: () => unknown }; canWrite: boolean; onEdit: (r: Review) => void }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState<Review | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/performance/reviews/${b.id}`, { invalidate: ['/performance'] });
  const remove = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync({ id: deleting.id });
      toast.success(t('perf.rev.deleted'));
      setDeleting(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Panel bodyClassName="p-4" title={t('perf.rev.title')} actions={<span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="size-3" aria-hidden />{t('perf.rev.who')}</span>}>
      {reviews.error ? (
        <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
      ) : !reviews.data ? (
        <SkeletonRows rows={3} cols={1} />
      ) : reviews.data.length === 0 ? (
        <EmptyState title={t('perf.rev.empty')} description={t('perf.rev.emptyHint')} />
      ) : (
        <ul className="space-y-4">
          {reviews.data.map((r) => (
            <li key={r.id} className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Avatar name={r.reviewer.name} seed={r.reviewer.id} size={28} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{t('perf.rev.by', { period: `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`, name: r.reviewer.name })}</p>
                  <p className="text-xs text-text-muted">{fmtDate(r.updated_at)} · {r.shared_with_member ? t('perf.rev.shared', { name }) : t('perf.rev.notShared')}</p>
                </div>
                <Badge tone={r.status === 'FINAL' ? 'success' : 'neutral'}>{t(r.status === 'FINAL' ? 'perf.rev.final' : 'perf.rev.draft')}</Badge>
                {canWrite && (
                  <>
                    <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(r)}>
                      {t('perf.rev.edit')}
                    </Button>
                    <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(r)}>
                      {t('perf.rev.delete')}
                    </Button>
                  </>
                )}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-muted">{t('perf.rev.rating')}</dt>
                  <dd className="font-semibold">{r.quality_rating ? t('perf.rev.ratingValue', { n: r.quality_rating }) : t('perf.rev.noRating')}</dd>
                </div>
                {r.summary && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-text-muted">{t('perf.rev.summary')}</dt>
                    <dd>{r.summary}</dd>
                  </div>
                )}
                {r.strengths.length > 0 && (
                  <div>
                    <dt className="text-xs text-text-muted">{t('perf.rev.strengths')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">{r.strengths.map((x) => <Badge key={x} tone="success">{x}</Badge>)}</dd>
                  </div>
                )}
                {r.improvements.length > 0 && (
                  <div>
                    <dt className="text-xs text-text-muted">{t('perf.rev.improvements')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">{r.improvements.map((x) => <Badge key={x} tone="warning">{x}</Badge>)}</dd>
                  </div>
                )}
                {r.recommendations && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-text-muted">{t('perf.rev.plan')}</dt>
                    <dd>{r.recommendations}</dd>
                  </div>
                )}
              </dl>
              {r.private_note && (
                <div className={cx('rounded-md border border-dashed border-warning bg-warning-soft px-3 py-2 text-sm')}>
                  <p className="flex items-center gap-1 text-xs font-semibold">
                    <Lock className="size-3" aria-hidden />
                    {t('perf.rev.private', { name })}
                  </p>
                  <p className="mt-1">{r.private_note}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={t('perf.rev.deleteTitle')} description={t('perf.rev.deleteText')} confirmLabel={t('perf.rev.delete')} danger loading={del.isPending} onConfirm={remove} />
    </Panel>
  );
}
