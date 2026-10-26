import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { memberships, mfaFactors, rateLimitBuckets, userSessions, users } from '@tallywork/db';
import { DomainError, businessRule, forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { Deps } from '../context';
import { decrypt, encrypt, sha256, verifyPassword } from '../lib/crypto';
import { renderEmail } from '../lib/email';
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp';
import type { Ctx } from './ctx';
import { audit } from './events';

/**
 * Two-factor authentication with an authenticator app (TOTP) plus single-use recovery codes.
 * Users are global (not tenant-scoped), so this runs on the plain connection like login does.
 *
 * Rules: every change (turn on, replace, turn off, new recovery codes) asks for the password, and
 * all but the first setup also for a current code or a recovery code. Wrong codes count per account
 * (web and desktop alike) and lock the second step for a while. An unfinished setup expires.
 */
const purpose = (factorId: string) => `totp:${factorId}`;

/** An unfinished setup can be confirmed for this long. */
export const SETUP_TTL_MS = 15 * 60_000;
/** Wrong codes allowed per account in the window before the second step locks. */
export const MAX_CODE_FAILURES = 10;
export const CODE_FAILURE_WINDOW_MS = 15 * 60_000;

export async function hasMfa(deps: Deps, userId: string): Promise<boolean> {
  const [f] = await deps.db.select({ id: mfaFactors.id }).from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  return !!f;
}

async function requirePassword(deps: Deps, userId: string, password: string): Promise<{ email: string }> {
  const [u] = await deps.db.select({ email: users.email, hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u) throw notFound('user');
  if (!(await verifyPassword(u.hash, password))) throw validation('Your password is incorrect', { errors: [{ field: 'password', message: 'Incorrect password' }] });
  return { email: u.email };
}

// ─── Wrong-code lockout (per account) ────────────────────────────────────────
const failKey = (userId: string) => `mfa-fail:${userId}`;

async function assertNotLocked(deps: Deps, userId: string): Promise<void> {
  const [b] = await deps.db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, failKey(userId)));
  if (b && b.count >= MAX_CODE_FAILURES && deps.now().getTime() - b.windowStart.getTime() < CODE_FAILURE_WINDOW_MS) {
    throw new DomainError('rate_limited', 'mfa_locked', 'Too many wrong codes. Wait 15 minutes, then try again.');
  }
}

async function recordFailure(deps: Deps, userId: string): Promise<void> {
  const now = deps.now();
  const windowStart = new Date(now.getTime() - CODE_FAILURE_WINDOW_MS);
  // A new window starts with the first failure after the previous one ran out.
  await deps.db
    .insert(rateLimitBuckets)
    .values({ key: failKey(userId), count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        count: sql`case when ${rateLimitBuckets.windowStart} < ${windowStart} then 1 else ${rateLimitBuckets.count} + 1 end`,
        windowStart: sql`case when ${rateLimitBuckets.windowStart} < ${windowStart} then ${now} else ${rateLimitBuckets.windowStart} end`,
      },
    });
}

/**
 * Check a TOTP code or a recovery code for the user's active factor, and use it up: a TOTP step and a
 * recovery code each work once, also when two requests send the same one at the same moment.
 */
async function checkSecondFactor(deps: Deps, userId: string, code: string): Promise<boolean> {
  await assertNotLocked(deps, userId);
  const ok = await useSecondFactor(deps, userId, code.trim().toLowerCase());
  if (ok) await deps.db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, failKey(userId)));
  else await recordFailure(deps, userId);
  return ok;
}

async function useSecondFactor(deps: Deps, userId: string, c: string): Promise<boolean> {
  const [f] = await deps.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  if (!f) return false;
  if (/^\d{6}$/.test(c)) {
    const step = verifyTotp(decrypt(deps.config.appSecret, f.secretEnc, purpose(f.id)), c, deps.now(), f.lastUsedStep);
    if (step === null) return false;
    // Conditional on the last step so two requests with the same code cannot both succeed.
    const [ok] = await deps.db.update(mfaFactors).set({ lastUsedStep: step }).where(and(eq(mfaFactors.id, f.id), f.lastUsedStep === null ? isNull(mfaFactors.lastUsedStep) : eq(mfaFactors.lastUsedStep, f.lastUsedStep))).returning({ id: mfaFactors.id });
    return !!ok;
  }
  // Removed in one conditional update: only one request can take a given recovery code.
  const h = sha256(c);
  const [ok] = await deps.db
    .update(mfaFactors)
    .set({ recoveryCodeHashes: sql`${mfaFactors.recoveryCodeHashes} - ${h}::text` })
    .where(and(eq(mfaFactors.id, f.id), sql`${mfaFactors.recoveryCodeHashes} @> jsonb_build_array(${h}::text)`))
    .returning({ id: mfaFactors.id });
  return !!ok;
}

async function requireSecondFactor(deps: Deps, userId: string, code: string, field = 'code'): Promise<void> {
  if (!(await checkSecondFactor(deps, userId, code))) throw validation('That code is not valid', { errors: [{ field, message: 'Invalid code' }] });
}

async function notifyChange(deps: Deps, email: string, what: string) {
  await deps.mailer
    .send(
      renderEmail(
        {
          subject: 'Your WorkPulse two-factor settings changed',
          preheader: what,
          heading: 'Two-factor authentication changed',
          paragraphs: [what, 'If this was you, there is nothing to do. If it was not, reset your password now and contact your organization’s owner.'],
          reason: 'You received this email because the security settings of your WorkPulse account changed.',
        },
        { appUrl: deps.config.appUrl, to: email },
      ),
    )
    .catch((e: unknown) => console.warn(JSON.stringify({ level: 'warn', msg: 'mfa change email failed', error: e instanceof Error ? e.message : String(e) })));
}

// ─── Setup, replace, cancel ──────────────────────────────────────────────────

/**
 * Start setup: a new secret, shown once as a QR code and a key. Asks for the password; when two-factor
 * is already on (replacing the app) also for a current code or a recovery code. The current app keeps
 * working until the new one is confirmed. Replaces any unfinished setup.
 */
export async function startTotpSetup(deps: Deps, userId: string, input: { password: string; code?: string }) {
  const { email } = await requirePassword(deps, userId, input.password);
  if (await hasMfa(deps, userId)) {
    if (!input.code) throw validation('Enter a code from your current authenticator app, or a recovery code', { errors: [{ field: 'code', message: 'Required to replace your app' }] });
    await requireSecondFactor(deps, userId, input.code);
  }
  await deps.db.delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.verifiedAt)));
  const id = newId();
  const secret = newTotpSecret();
  await deps.db.insert(mfaFactors).values({ id, userId, type: 'TOTP', secretEnc: encrypt(deps.config.appSecret, secret, purpose(id)), createdAt: deps.now() });
  const url = otpauthUrl(secret, email);
  // Made here, never by an outside service: the QR code holds the secret.
  const qr_svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, otpauth_url: url, qr_svg };
}

/** Drop an unfinished setup; two-factor stays as it was. */
export async function cancelTotpSetup(deps: Deps, userId: string): Promise<void> {
  await deps.db.delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.verifiedAt)));
}

/**
 * Finish setup with a code from the new app. Returns recovery codes (shown once) and marks this session
 * verified. When replacing, the previous app stops working only now.
 */
export async function confirmTotpSetup(deps: Deps, userId: string, sessionId: string, code: string) {
  const [f] = await deps.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.verifiedAt))).limit(1);
  if (!f || deps.now().getTime() - f.createdAt.getTime() > SETUP_TTL_MS) {
    if (f) await cancelTotpSetup(deps, userId);
    throw businessRule('mfa_setup_missing', 'This setup expired. Start again to get a new QR code.');
  }
  await assertNotLocked(deps, userId);
  const step = verifyTotp(decrypt(deps.config.appSecret, f.secretEnc, purpose(f.id)), code.trim(), deps.now());
  if (step === null) {
    await recordFailure(deps, userId);
    throw validation('That code is not valid. Check the time on your phone and try the current code.', { errors: [{ field: 'code', message: 'Invalid code' }] });
  }
  const codes = newRecoveryCodes();
  const replaced = await deps.db.transaction(async (tx) => {
    // One change at a time per person: a second confirm waits here and then finds no pending setup.
    await tx.execute(sql`select 1 from ${users} where ${users.id} = ${userId} for update`);
    const [still] = await tx.select({ id: mfaFactors.id }).from(mfaFactors).where(and(eq(mfaFactors.id, f.id), isNull(mfaFactors.verifiedAt)));
    if (!still) throw businessRule('mfa_setup_missing', 'This setup was already finished');
    const old = await tx.delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).returning({ id: mfaFactors.id });
    await tx.update(mfaFactors).set({ verifiedAt: deps.now(), lastUsedStep: step, recoveryCodeHashes: codes.map((c) => sha256(c)) }).where(eq(mfaFactors.id, f.id));
    await tx.update(userSessions).set({ mfaVerified: true, mfaPending: false }).where(eq(userSessions.id, sessionId));
    return old.length > 0;
  });
  await deps.db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, failKey(userId)));
  const [u] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (u) await notifyChange(deps, u.email, replaced ? 'Two-factor authentication now uses a new authenticator app. The previous app no longer works.' : 'Two-factor authentication was turned on for your account.');
  return { recovery_codes: codes, note: 'Store these recovery codes somewhere safe. Each works once if you lose your phone.' };
}

// ─── Sign-in ─────────────────────────────────────────────────────────────────

/** Second factor for sign-ins that do not use a web session (the desktop app). */
export async function verifySecondFactor(deps: Deps, userId: string, code: string): Promise<void> {
  if (!(await checkSecondFactor(deps, userId, code))) throw new DomainError('unauthenticated', 'invalid_mfa_code', 'That code is not valid');
}

/** Second step of web sign-in. The caller replaces the pending session with a new, verified one. */
export async function verifyLoginCode(deps: Deps, userId: string, code: string): Promise<void> {
  if (!(await checkSecondFactor(deps, userId, code))) throw new DomainError('unauthenticated', 'invalid_mfa_code', 'That code is not valid');
}

// ─── Turn off, recovery codes ────────────────────────────────────────────────

/** Turning 2FA off needs the password and a current code (or a recovery code); other sessions are signed out. */
export async function disableTotp(deps: Deps, userId: string, sessionId: string, input: { password: string; code: string }) {
  const { email } = await requirePassword(deps, userId, input.password);
  await requireSecondFactor(deps, userId, input.code);
  await deps.db.transaction(async (tx) => {
    await tx.delete(mfaFactors).where(eq(mfaFactors.userId, userId));
    await tx.update(userSessions).set({ revokedAt: deps.now() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), ne(userSessions.id, sessionId)));
    await tx.update(userSessions).set({ mfaVerified: false }).where(eq(userSessions.id, sessionId));
  });
  await notifyChange(deps, email, 'Two-factor authentication was turned off for your account. Your other sessions were signed out.');
}

/** New set of recovery codes (the old ones stop working); needs the password and a current code. */
export async function regenerateRecoveryCodes(deps: Deps, userId: string, input: { password: string; code: string }) {
  const { email } = await requirePassword(deps, userId, input.password);
  await requireSecondFactor(deps, userId, input.code);
  const codes = newRecoveryCodes();
  await deps.db.update(mfaFactors).set({ recoveryCodeHashes: codes.map((c) => sha256(c)) }).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt)));
  await notifyChange(deps, email, 'You created new two-factor recovery codes. The previous codes no longer work.');
  return { recovery_codes: codes, note: 'Your previous recovery codes no longer work. Store these somewhere safe.' };
}

export async function recoveryCodesLeft(deps: Deps, userId: string): Promise<number | null> {
  const [f] = await deps.db.select({ c: mfaFactors.recoveryCodeHashes }).from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  return f ? f.c.length : null;
}

// ─── Owner reset (lost phone and recovery codes) ─────────────────────────────

/**
 * Whether the person is an active member of any other organization. Row-level security hides other
 * organizations' memberships inside this request's transaction, so the check lifts it for this one
 * yes/no query (the same transaction: a second connection would wait on this one) and restores it.
 */
async function belongsElsewhere(x: Ctx, userId: string): Promise<boolean> {
  await x.tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
  try {
    const [r] = await x.tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'ACTIVE'), ne(memberships.organizationId, x.org.id))).limit(1);
    return !!r;
  } finally {
    await x.tx.execute(sql`select set_config('app.bypass_rls', 'off', true)`);
  }
}

/**
 * An organization owner resets a member's two-factor when the member lost both their phone and their
 * recovery codes. Only for members whose only organization is this one (two-factor is a personal
 * setting: one organization's owner must not change it for an account other organizations rely on).
 * Needs the owner's password; signs the member out everywhere, emails them and is audited.
 */
export async function ownerResetMfa(x: Ctx, membershipId: string, ownerPassword: string) {
  const p = x.actor.principal;
  if (!x.actor.isOwner || p.type !== 'user') throw forbidden('Only the organization’s owner can reset two-factor authentication');
  // Everything on the request's own transaction (the user tables are not tenant-scoped).
  const deps: Deps = { ...x.deps, db: x.tx as unknown as Deps['db'] };
  await requirePassword(deps, p.userId, ownerPassword);
  const [m] = await x.tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, membershipId));
  if (!m) throw notFound('member');
  if (m.userId === p.userId) throw businessRule('mfa_reset_self', 'Use one of your recovery codes to sign in, then set up two-factor again from your profile');
  if (await belongsElsewhere(x, m.userId)) throw businessRule('mfa_reset_other_orgs', 'This person also belongs to other organizations, so their two-factor cannot be reset from here. They need one of their recovery codes.');
  if (!(await hasMfa(deps, m.userId))) throw businessRule('mfa_not_enabled', 'Two-factor authentication is not on for this person');
  await x.tx.delete(mfaFactors).where(eq(mfaFactors.userId, m.userId));
  await x.tx.update(userSessions).set({ revokedAt: x.deps.now() }).where(and(eq(userSessions.userId, m.userId), isNull(userSessions.revokedAt)));
  await x.tx.delete(rateLimitBuckets).where(inArray(rateLimitBuckets.key, [failKey(m.userId)]));
  await audit(x, { action: 'member.mfa_reset', targetType: 'membership', targetId: membershipId });
  const [u] = await x.tx.select({ email: users.email }).from(users).where(eq(users.id, m.userId));
  if (u) await notifyChange(x.deps, u.email, `${x.org.name}’s owner reset two-factor authentication for your account, and you were signed out everywhere. Sign in with your password and set it up again.`);
}
