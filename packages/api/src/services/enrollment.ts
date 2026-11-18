/**
 * Enrollment tokens for managed desktop installs. IT puts a token in the desktop app's managed settings
 * (Windows policy, macOS profile, Linux config file). At sign-in it pins the computer to this
 * organization and pre-approves the device. It never signs anyone in: the person still signs in with
 * their own account, two-factor and the sign-in rate limit apply as usual.
 *
 * The secret is shown once, at creation, and stored only as a SHA-256 hash. It is never logged, never
 * put in an audit row and never listed. Revoking stops new enrollments; enrolled devices keep working.
 */
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { deviceEnrollmentTokens, withSystem, type Tx } from '@tallywork/db';
import { DomainError, forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { EnrollmentTokenCreatedDto, EnrollmentTokenDto, enrollmentTokenInput } from '@tallywork/contracts';
import type { Deps } from '../context';
import { randomToken, sha256 } from '../lib/crypto';
import type { Ctx } from './ctx';
import { audit } from './events';
import { memberNames } from './timer';
import { iso } from '../lib/http';

export const ENROLLMENT_TOKEN_PREFIX = 'wpe_';

export const enrollmentInvalid = () => new DomainError('unauthenticated', 'enrollment_invalid', 'This computer’s enrollment token is no longer valid. Ask your IT team.');
export const enrollmentOtherOrg = () => new DomainError('forbidden', 'enrollment_other_org', 'This computer is set up for another organization. Ask your IT team.');

/** Approving devices is organization-wide; so is deciding which computers join without approval. */
function assertManager(x: Ctx) {
  if (x.actor.grants['devices:manage'] !== 'org') throw forbidden();
}

type Row = typeof deviceEnrollmentTokens.$inferSelect;

function status(r: Row, now: Date): EnrollmentTokenDto['status'] {
  if (r.revokedAt) return 'REVOKED';
  if (r.expiresAt && r.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

async function toDtos(x: Ctx, rows: Row[]): Promise<EnrollmentTokenDto[]> {
  const names = await memberNames(x, [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))]);
  const now = x.deps.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    status: status(r, now),
    created_by_name: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    created_at: r.createdAt.toISOString(),
    expires_at: iso(r.expiresAt),
    revoked_at: iso(r.revokedAt),
    last_used_at: iso(r.lastUsedAt),
    use_count: r.useCount,
  }));
}

export async function listEnrollmentTokens(x: Ctx): Promise<EnrollmentTokenDto[]> {
  assertManager(x);
  const rows = await x.tx.select().from(deviceEnrollmentTokens).orderBy(desc(deviceEnrollmentTokens.createdAt), desc(deviceEnrollmentTokens.id));
  return toDtos(x, rows);
}

export async function createEnrollmentToken(x: Ctx, input: z.infer<typeof enrollmentTokenInput>): Promise<EnrollmentTokenCreatedDto> {
  assertManager(x);
  const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
  if (expiresAt && expiresAt <= x.deps.now()) throw validation('The expiry is in the past', { errors: [{ field: 'expires_at', message: 'Choose a date in the future, or no expiry' }] });
  // 32 random bytes, base64url: 43 characters after the prefix.
  const secret = randomToken(32);
  const token = `${ENROLLMENT_TOKEN_PREFIX}${secret}`;
  const id = newId();
  const [row] = await x.tx
    .insert(deviceEnrollmentTokens)
    .values({ id, organizationId: x.org.id, name: input.name, tokenHash: sha256(token), prefix: secret.slice(0, 8), createdBy: x.actor.membershipId, expiresAt })
    .returning();
  // The audit row names the token; it never holds the secret or its hash.
  await audit(x, { action: 'device.enrollment_token_created', targetType: 'enrollment_token', targetId: id, after: { name: input.name, prefix: row!.prefix, expires_at: iso(expiresAt) } });
  const [dto] = await toDtos(x, [row!]);
  return { ...dto!, token };
}

export async function revokeEnrollmentToken(x: Ctx, id: string): Promise<void> {
  assertManager(x);
  const [row] = await x.tx.select().from(deviceEnrollmentTokens).where(eq(deviceEnrollmentTokens.id, id));
  if (!row) throw notFound('enrollment_token');
  if (row.revokedAt) return;
  await x.tx.update(deviceEnrollmentTokens).set({ revokedAt: x.deps.now() }).where(eq(deviceEnrollmentTokens.id, id));
  await audit(x, { action: 'device.enrollment_token_revoked', targetType: 'enrollment_token', targetId: id, before: { name: row.name, prefix: row.prefix } });
}

/**
 * Which organization a token belongs to. Runs before any tenant is known (the token is what names the
 * organization), so it reads under the system context, by hash only. Unknown, revoked or expired:
 * refused, never a silent fallback to an ordinary sign-in.
 */
export async function resolveEnrollmentToken(deps: Deps, token: string): Promise<{ id: string; organizationId: string }> {
  const [row] = await withSystem(deps.db, (tx) =>
    tx.select({ id: deviceEnrollmentTokens.id, organizationId: deviceEnrollmentTokens.organizationId, revokedAt: deviceEnrollmentTokens.revokedAt, expiresAt: deviceEnrollmentTokens.expiresAt }).from(deviceEnrollmentTokens).where(eq(deviceEnrollmentTokens.tokenHash, sha256(token))).limit(1),
  );
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= deps.now())) throw enrollmentInvalid();
  return { id: row.id, organizationId: row.organizationId };
}

/**
 * Record a use inside the device's tenant transaction, only while the token is still valid: a token
 * revoked between the check and the insert refuses the enrollment instead of letting it through.
 */
export async function claimEnrollmentToken(tx: Tx, deps: Deps, id: string): Promise<void> {
  const now = deps.now();
  const [used] = await tx
    .update(deviceEnrollmentTokens)
    .set({ lastUsedAt: now, useCount: sql`${deviceEnrollmentTokens.useCount} + 1` })
    .where(and(eq(deviceEnrollmentTokens.id, id), isNull(deviceEnrollmentTokens.revokedAt), or(isNull(deviceEnrollmentTokens.expiresAt), gt(deviceEnrollmentTokens.expiresAt, now))))
    .returning({ id: deviceEnrollmentTokens.id });
  if (!used) throw enrollmentInvalid();
}
