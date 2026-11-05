'use client';
import { useId, useState } from 'react';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation } from '@/lib/api';
import { t } from './i18n';
import './messages/workers';
import './messages/reviews';
import type { Review } from './types';

interface Body {
  membership_id?: string;
  period_start: string;
  period_end: string;
  quality_rating: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  recommendations: string | null;
  private_note: string | null;
  shared_with_member: boolean;
  status: 'DRAFT' | 'FINAL';
}

const splitList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Write or edit a review of one person (`reviews:manage`). The private note is for reviewers only:
 * the API never sends it to the person, to a client or into the audit log. Loaded when opened.
 */
export default function ReviewDialog({ member, review, period, onClose }: { member: { id: string; name: string }; review: Review | null; period: { start: string; end: string }; onClose: () => void }) {
  const toast = useToast();
  const id = useId();
  const [from, setFrom] = useState(review?.period_start ?? period.start);
  const [to, setTo] = useState(review?.period_end ?? period.end);
  const [rating, setRating] = useState(review?.quality_rating ? String(review.quality_rating) : '');
  const [summary, setSummary] = useState(review?.summary ?? '');
  const [strengths, setStrengths] = useState(review?.strengths.join('\n') ?? '');
  const [improvements, setImprovements] = useState(review?.improvements.join('\n') ?? '');
  const [plan, setPlan] = useState(review?.recommendations ?? '');
  const [privateNote, setPrivateNote] = useState(review?.private_note ?? '');
  const [shared, setShared] = useState(review?.shared_with_member ?? false);
  const [status, setStatus] = useState<'DRAFT' | 'FINAL'>(review?.status ?? 'DRAFT');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const create = useOrgMutation<Body, Review>('POST', '/performance/reviews', { invalidate: ['/performance'] });
  // The id goes in the address only: the edit endpoint refuses fields it does not know.
  const update = useOrgMutation<Body, Review>('PATCH', `/performance/reviews/${review?.id ?? ''}`, { invalidate: ['/performance'] });

  const lists = { strengths: splitList(strengths), improvements: splitList(improvements) };
  const listBad = (l: string[]) => l.length > 12 || l.some((x) => x.length > 80);
  const periodBad = !from || !to || to < from;

  const submit = async () => {
    setTried(true);
    setErr(null);
    if (periodBad || listBad(lists.strengths) || listBad(lists.improvements)) return;
    const body: Body = {
      period_start: from,
      period_end: to,
      quality_rating: rating ? Number(rating) : null,
      summary: summary.trim() || null,
      strengths: lists.strengths,
      improvements: lists.improvements,
      recommendations: plan.trim() || null,
      private_note: privateNote.trim() || null,
      shared_with_member: shared,
      status,
    };
    try {
      if (review) await update.mutateAsync(body);
      else await create.mutateAsync({ ...body, membership_id: member.id });
      toast.success(t('perf.rev.saved'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={640}
      title={t(review ? 'perf.rev.dialogEdit' : 'perf.rev.dialogNew', { name: member.name })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || update.isPending}>
            {t('perf.rev.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('perf.rev.from')} htmlFor={`${id}-from`} required error={tried && periodBad ? t('perf.rev.periodInvalid') : (err?.field('period_start') ?? null)}>
          <Input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('perf.rev.to')} htmlFor={`${id}-to`} required error={err?.field('period_end') ?? null}>
          <Input id={`${id}-to`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('perf.rev.rating')} htmlFor={`${id}-rating`} hint={t('perf.rev.ratingHint')}>
          <Select id={`${id}-rating`} value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">{t('perf.rev.noRating')}</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {t('perf.rev.ratingValue', { n })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('perf.rev.statusLabel')} htmlFor={`${id}-status`}>
          <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'FINAL')}>
            <option value="DRAFT">{t('perf.rev.draft')}</option>
            <option value="FINAL">{t('perf.rev.final')}</option>
          </Select>
        </Field>
        <Field label={t('perf.rev.summary')} htmlFor={`${id}-summary`} className="sm:col-span-2">
          <Textarea id={`${id}-summary`} rows={2} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label={t('perf.rev.strengths')} htmlFor={`${id}-strengths`} hint={t('perf.rev.listHint')} error={tried && listBad(lists.strengths) ? t('perf.rev.listTooLong') : (err?.field('strengths') ?? null)}>
          <Textarea id={`${id}-strengths`} rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        </Field>
        <Field label={t('perf.rev.improvements')} htmlFor={`${id}-improvements`} hint={t('perf.rev.listHint')} error={tried && listBad(lists.improvements) ? t('perf.rev.listTooLong') : (err?.field('improvements') ?? null)}>
          <Textarea id={`${id}-improvements`} rows={3} value={improvements} onChange={(e) => setImprovements(e.target.value)} />
        </Field>
        <Field label={t('perf.rev.plan')} htmlFor={`${id}-plan`} className="sm:col-span-2">
          <Textarea id={`${id}-plan`} rows={2} maxLength={4000} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </Field>
        <div className="space-y-1 rounded-md border border-dashed border-warning bg-warning-soft p-3 sm:col-span-2">
          <Field label={t('perf.rev.privateLabel')} htmlFor={`${id}-private`} hint={t('perf.rev.privateHint', { name: member.name })}>
            <Textarea id={`${id}-private`} rows={2} maxLength={4000} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Checkbox label={t('perf.rev.shareLabel', { name: member.name })} checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <p className="ml-6 text-xs text-text-muted">{t('perf.rev.shareHint')}</p>
        </div>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
