import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { mfaFactors, userSessions, users } from '@tallywork/db';
import { DomainError, businessRule, newId, notFound, validation } from '@tallywork/domain';
import type { Deps } from '../context';
import { decrypt, encrypt, sha256 } from '../lib/crypto';
import { sessionTtlFor } from './identity';
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp';

/**
 * Two-factor authentication with an authenticator app (TOTP) plus single-use recovery codes.
 * Users are global (not tenant-scoped), so this runs on the plain connection like login does.
 */
const purpose = (factorId: string) => `totp:${factorId}`;

export async function hasMfa(deps: Deps, userId: string): Promise<boolean> {
  const [f] = await deps.db.select({ id: mfaFactors.id }).from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  return !!f;
}

/** Start enrollment: a new secret, shown once as a QR code / key. Replaces any unfinished setup. */
export async function startTotpSetup(deps: Deps, userId: string) {
  if (await hasMfa(deps, userId)) throw businessRule('mfa_already_enabled', 'Two-factor authentication is already on. Turn it off first to set up a new device.');
  const [u] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw notFound('user');
  await deps.db.delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.verifiedAt)));
  const id = newId();
  const secret = newTotpSecret();
  await deps.db.insert(mfaFactors).values({ id, userId, type: 'TOTP', secretEnc: encrypt(deps.config.appSecret, secret, purpose(id)) });
  return { secret, otpauth_url: otpauthUrl(secret, u.email) };
}

/** Finish enrollment with a code from the app. Returns recovery codes (shown once) and trusts this session. */
export async function confirmTotpSetup(deps: Deps, userId: string, sessionId: string, code: string) {
  const [f] = await deps.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNull(mfaFactors.verifiedAt))).limit(1);
  if (!f) throw businessRule('mfa_setup_missing', 'Start the two-factor setup first');
  const step = verifyTotp(decrypt(deps.config.appSecret, f.secretEnc, purpose(f.id)), code.trim(), deps.now());
  if (step === null) throw validation('That code is not valid. Check the time on your phone and try the current code.', { errors: [{ field: 'code', message: 'Invalid code' }] });
  const codes = newRecoveryCodes();
  await deps.db.update(mfaFactors).set({ verifiedAt: deps.now(), lastUsedStep: step, recoveryCodeHashes: codes.map((c) => sha256(c)) }).where(eq(mfaFactors.id, f.id));
  await deps.db.update(userSessions).set({ mfaVerified: true, mfaPending: false }).where(eq(userSessions.id, sessionId));
  return { recovery_codes: codes, note: 'Store these recovery codes somewhere safe. Each works once if you lose your phone.' };
}

/** Check a TOTP code or a recovery code for the user's active factor; consumes what it uses. */
async function checkSecondFactor(deps: Deps, userId: string, code: string): Promise<boolean> {
  const [f] = await deps.db.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  if (!f) return false;
  const c = code.trim().toLowerCase();
  if (/^\d{6}$/.test(c)) {
    const step = verifyTotp(decrypt(deps.config.appSecret, f.secretEnc, purpose(f.id)), c, deps.now(), f.lastUsedStep);
    if (step === null) return false;
    // Conditional on the last step so two requests with the same code cannot both succeed.
    const [ok] = await deps.db.update(mfaFactors).set({ lastUsedStep: step }).where(and(eq(mfaFactors.id, f.id), f.lastUsedStep === null ? isNull(mfaFactors.lastUsedStep) : eq(mfaFactors.lastUsedStep, f.lastUsedStep))).returning({ id: mfaFactors.id });
    return !!ok;
  }
  const h = sha256(c);
  if (!f.recoveryCodeHashes.includes(h)) return false;
  await deps.db.update(mfaFactors).set({ recoveryCodeHashes: f.recoveryCodeHashes.filter((x) => x !== h) }).where(eq(mfaFactors.id, f.id));
  return true;
}

/** Second factor for sign-ins that do not use a web session (the desktop app). */
export async function verifySecondFactor(deps: Deps, userId: string, code: string): Promise<void> {
  if (!(await checkSecondFactor(deps, userId, code))) throw new DomainError('unauthenticated', 'invalid_mfa_code', 'That code is not valid');
}

/** Second step of sign-in: turns a pending session into a full one. */
export async function verifyLoginCode(deps: Deps, userId: string, sessionId: string, code: string) {
  if (!(await checkSecondFactor(deps, userId, code))) throw new DomainError('unauthenticated', 'invalid_mfa_code', 'That code is not valid');
  // The pending session only lasted minutes; from now on it gets the normal lifetime.
  const expiresAt = new Date(deps.now().getTime() + (await sessionTtlFor(deps, userId)) * 3600_000);
  await deps.db.update(userSessions).set({ mfaVerified: true, mfaPending: false, expiresAt }).where(eq(userSessions.id, sessionId));
}

/** Turning 2FA off needs a current code (or a recovery code); other sessions are signed out. */
export async function disableTotp(deps: Deps, userId: string, sessionId: string, code: string) {
  if (!(await checkSecondFactor(deps, userId, code))) throw validation('That code is not valid', { errors: [{ field: 'code', message: 'Invalid code' }] });
  await deps.db.delete(mfaFactors).where(eq(mfaFactors.userId, userId));
  await deps.db.update(userSessions).set({ revokedAt: deps.now() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), ne(userSessions.id, sessionId)));
  await deps.db.update(userSessions).set({ mfaVerified: false }).where(eq(userSessions.id, sessionId));
}

/** New set of recovery codes (the old ones stop working); needs a current code. */
export async function regenerateRecoveryCodes(deps: Deps, userId: string, code: string) {
  if (!(await checkSecondFactor(deps, userId, code))) throw validation('That code is not valid', { errors: [{ field: 'code', message: 'Invalid code' }] });
  const codes = newRecoveryCodes();
  await deps.db.update(mfaFactors).set({ recoveryCodeHashes: codes.map((c) => sha256(c)) }).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt)));
  return { recovery_codes: codes, note: 'Your previous recovery codes no longer work. Store these somewhere safe.' };
}

export async function recoveryCodesLeft(deps: Deps, userId: string): Promise<number | null> {
  const [f] = await deps.db.select({ c: mfaFactors.recoveryCodeHashes }).from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt))).limit(1);
  return f ? f.c.length : null;
}
