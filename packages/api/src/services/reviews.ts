import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { memberships, performanceReviews, type Tx } from '@tallywork/db';
import { businessRule, can, forbidden, notFound, newId } from '@tallywork/domain';
import type { reviewInput } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit, emitFrom } from './events';
import { notify } from './notify';
import { memberNames } from './timer';
import { iso } from '../lib/http';

/**
 * Manager reviews. Confidential: only people with reviews:read over the member see them (managers of
 * the member's teams and admins). The member sees a review only when it is final and shared, and never
 * its private note; clients never see reviews at all.
 */
type Review = typeof performanceReviews.$inferSelect;

export interface ReviewDto {
  id: string;
  membership_id: string;
  reviewer: { id: string; name: string };
  period_start: string;
  period_end: string;
  quality_rating: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  recommendations: string | null;
  /** only for reviewers (never in the member's own view) */
  private_note?: string | null;
  shared_with_member: boolean;
  status: 'DRAFT' | 'FINAL';
  created_at: string;
  updated_at: string;
}

async function dtos(x: Pick<Ctx, 'tx'>, rows: Review[], withPrivate: boolean): Promise<ReviewDto[]> {
  const names = await memberNames(x, [...new Set(rows.map((r) => r.reviewerMembershipId))]);
  return rows.map((r) => ({
    id: r.id,
    membership_id: r.membershipId,
    reviewer: { id: r.reviewerMembershipId, name: names.get(r.reviewerMembershipId) ?? '' },
    period_start: r.periodStart,
    period_end: r.periodEnd,
    quality_rating: r.qualityRating,
    summary: r.summary,
    strengths: r.strengths,
    improvements: r.improvements,
    recommendations: r.recommendations,
    ...(withPrivate ? { private_note: r.privateNote } : {}),
    shared_with_member: r.sharedWithMember,
    status: r.status,
    created_at: iso(r.createdAt)!,
    updated_at: iso(r.updatedAt)!,
  }));
}

/** What the audit log keeps of a review: never the private note's text. */
const auditable = (r: Partial<z.infer<typeof reviewInput>>) => {
  const { private_note, ...rest } = r;
  return { ...rest, ...(private_note !== undefined ? { private_note_changed: true } : {}) };
};

async function assertMember(x: Ctx, membershipId: string) {
  const [m] = await x.tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, membershipId));
  if (!m || !can(x.actor, 'reviews:read', { ownerMembershipId: membershipId })) throw notFound('member');
}

export async function listReviews(x: Ctx, membershipId: string): Promise<ReviewDto[]> {
  await assertMember(x, membershipId);
  const rows = await x.tx.select().from(performanceReviews).where(and(eq(performanceReviews.membershipId, membershipId), isNull(performanceReviews.archivedAt))).orderBy(desc(performanceReviews.periodEnd), desc(performanceReviews.createdAt));
  return dtos(x, rows, true);
}

export async function createReview(x: Ctx, input: z.infer<typeof reviewInput>): Promise<ReviewDto> {
  await assertMember(x, input.membership_id);
  if (!can(x.actor, 'reviews:manage', { ownerMembershipId: input.membership_id })) throw forbidden();
  if (input.membership_id === x.actor.membershipId) throw forbidden('You cannot review yourself.');
  const [row] = await x.tx
    .insert(performanceReviews)
    .values({
      id: newId(),
      organizationId: x.org.id,
      membershipId: input.membership_id,
      reviewerMembershipId: x.actor.membershipId,
      periodStart: input.period_start,
      periodEnd: input.period_end,
      qualityRating: input.quality_rating ?? null,
      summary: input.summary ?? null,
      strengths: input.strengths ?? [],
      improvements: input.improvements ?? [],
      recommendations: input.recommendations ?? null,
      privateNote: input.private_note ?? null,
      sharedWithMember: input.shared_with_member ?? false,
      status: input.status ?? 'DRAFT',
    })
    .returning();
  await audit(x, { action: 'performance.review_created', targetType: 'performance_review', targetId: row!.id, after: auditable(input) });
  await emitFrom(x, 'performance.review.created', { review_id: row!.id, membership_id: row!.membershipId, status: row!.status });
  if (row!.status === 'FINAL' && row!.sharedWithMember) await notify(x.tx, x.deps, x.org.id, [row!.membershipId], { type: 'performance.review_shared', title: 'A performance review was shared with you', link: '/performance', payload: { review_id: row!.id } });
  return (await dtos(x, [row!], true))[0]!;
}

export async function updateReview(x: Ctx, id: string, input: Partial<z.infer<typeof reviewInput>>): Promise<ReviewDto> {
  const [r] = await x.tx.select().from(performanceReviews).where(and(eq(performanceReviews.id, id), isNull(performanceReviews.archivedAt)));
  if (!r || !can(x.actor, 'reviews:read', { ownerMembershipId: r.membershipId })) throw notFound('review');
  // The reviewer edits their own review; an admin (org scope) may correct any.
  if (!can(x.actor, 'reviews:manage', { ownerMembershipId: r.membershipId }) || (r.reviewerMembershipId !== x.actor.membershipId && x.actor.grants['reviews:manage'] !== 'org')) throw forbidden();
  if (input.membership_id && input.membership_id !== r.membershipId) throw businessRule('review_member_fixed', 'A review stays with the person it is about.');
  const start = input.period_start ?? r.periodStart;
  const end = input.period_end ?? r.periodEnd;
  if (end < start) throw businessRule('end_before_start', 'The period must end on or after it starts.');
  const patch: Partial<typeof performanceReviews.$inferInsert> = { updatedAt: x.deps.now(), periodStart: start, periodEnd: end };
  if (input.quality_rating !== undefined) patch.qualityRating = input.quality_rating;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.strengths !== undefined) patch.strengths = input.strengths;
  if (input.improvements !== undefined) patch.improvements = input.improvements;
  if (input.recommendations !== undefined) patch.recommendations = input.recommendations;
  if (input.private_note !== undefined) patch.privateNote = input.private_note;
  if (input.shared_with_member !== undefined) patch.sharedWithMember = input.shared_with_member;
  if (input.status !== undefined) patch.status = input.status;
  const [saved] = await x.tx.update(performanceReviews).set(patch).where(eq(performanceReviews.id, id)).returning();
  await audit(x, { action: 'performance.review_updated', targetType: 'performance_review', targetId: id, after: auditable(input) });
  const nowShared = saved!.status === 'FINAL' && saved!.sharedWithMember;
  if (nowShared && !(r.status === 'FINAL' && r.sharedWithMember)) await notify(x.tx, x.deps, x.org.id, [saved!.membershipId], { type: 'performance.review_shared', title: 'A performance review was shared with you', link: '/performance', payload: { review_id: id } });
  return (await dtos(x, [saved!], true))[0]!;
}

export async function archiveReview(x: Ctx, id: string): Promise<void> {
  const [r] = await x.tx.select().from(performanceReviews).where(and(eq(performanceReviews.id, id), isNull(performanceReviews.archivedAt)));
  if (!r || !can(x.actor, 'reviews:read', { ownerMembershipId: r.membershipId })) throw notFound('review');
  if (!can(x.actor, 'reviews:manage', { ownerMembershipId: r.membershipId }) || (r.reviewerMembershipId !== x.actor.membershipId && x.actor.grants['reviews:manage'] !== 'org')) throw forbidden();
  await x.tx.update(performanceReviews).set({ archivedAt: x.deps.now(), updatedAt: x.deps.now() }).where(eq(performanceReviews.id, id));
  await audit(x, { action: 'performance.review_archived', targetType: 'performance_review', targetId: id });
}

/** The member's own reviews: final and shared ones only, without the private note. */
export async function sharedReviewsFor(tx: Tx, membershipId: string): Promise<ReviewDto[]> {
  const rows = await tx
    .select()
    .from(performanceReviews)
    .where(and(eq(performanceReviews.membershipId, membershipId), eq(performanceReviews.status, 'FINAL'), eq(performanceReviews.sharedWithMember, true), isNull(performanceReviews.archivedAt)))
    .orderBy(desc(performanceReviews.periodEnd));
  return dtos({ tx }, rows, false);
}
