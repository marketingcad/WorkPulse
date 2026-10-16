import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { users } from '@tallywork/db';
import {
  acceptInviteInput,
  changePasswordInput,
  createOrgInput,
  forgotPasswordInput,
  loginInput,
  resetPasswordInput,
  signupInput,
} from '@tallywork/contracts';
import { DomainError, businessRule, validation } from '@tallywork/domain';
import { z } from 'zod';
import { confirmTotpSetup, disableTotp, hasMfa, recoveryCodesLeft, regenerateRecoveryCodes, startTotpSetup, verifyLoginCode } from '../services/mfa';
import type { AppEnv, Deps } from '../context';
import { body } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { rateLimit } from '../middleware/rate-limit';
import { SESSION_COOKIE, requireUser, sessionId, userId } from '../middleware/auth';
import {
  acceptInvitation,
  consumeEmailToken,
  createOrganization,
  createSession,
  createUser,
  findUserByEmail,
  getMe,
  issueEmailToken,
  login,
  markEmailVerified,
  resetPassword,
  revokeSession,
} from '../services/identity';
import { renderEmail } from '../lib/email';

function meta(c: Context<AppEnv>) {
  return { ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: c.req.header('user-agent') ?? null };
}

/**
 * Starts a session and sets its cookie. With `remember` off ("Remember me" unticked) the cookie has no
 * expiry, so the browser drops it when it closes; the session itself still ends at its usual time.
 */
export async function startUserSession(c: Context<AppEnv>, uid: string, mfaPending = false, remember = true) {
  const { token, expiresAt } = await createSession(c.var.deps, uid, meta(c), { mfaPending });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.var.deps.config.env === 'production',
    sameSite: 'Lax',
    path: '/',
    ...(remember ? { expires: expiresAt } : {}),
  });
}

async function sendVerificationEmail(deps: Deps, uid: string, email: string) {
  const token = await issueEmailToken(deps.db, uid, 'VERIFY_EMAIL', 60 * 24 * 3);
  await deps.mailer.send(
    renderEmail(
      {
        subject: 'Confirm your WorkPulse email',
        preheader: 'Confirm your email address to finish setting up your account.',
        heading: 'Confirm your email',
        paragraphs: ['Welcome to WorkPulse! Confirm that this is your email address to finish setting up your account.'],
        action: { label: 'Confirm email', url: `${deps.config.appUrl}/verify-email?token=${token}` },
        note: 'This link expires in 3 days.',
        reason: "You received this email because this address was used to create a WorkPulse account. If that wasn't you, you can ignore it.",
      },
      { appUrl: deps.config.appUrl, to: email },
    ),
  );
}

export const authRoutes = new Hono<AppEnv>()
  .post('/signup', rateLimit('signup', 10, 3600), async (c) => {
    const input = await body(c, signupInput);
    const { deps } = c.var;
    const uid = await createUser(deps.db, { name: input.name, email: input.email, password: input.password, verified: !deps.config.requireEmailVerification });
    const org = await createOrganization(deps.db, {
      name: input.organization_name ?? `${input.name.split(' ')[0]}'s Organization`,
      timezone: input.timezone ?? 'UTC',
      currency: 'USD',
      ownerUserId: uid,
    });
    await sendVerificationEmail(deps, uid, input.email);
    // With verification required, the account stays signed out until the emailed link is opened.
    if (deps.config.requireEmailVerification) return c.json({ user_id: uid, organization_id: org.organizationId, verification_required: true }, 201);
    await startUserSession(c, uid);
    return c.json({ user_id: uid, organization_id: org.organizationId }, 201);
  })

  .post('/verify-email/resend', rateLimit('verify-resend', 5, 3600), async (c) => {
    const { email } = await body(c, forgotPasswordInput);
    const { deps } = c.var;
    const u = await findUserByEmail(deps.db, email);
    // Always 202 so the endpoint does not reveal which emails have accounts.
    if (u && !u.emailVerifiedAt) await sendVerificationEmail(deps, u.id, u.email);
    return c.json({ ok: true }, 202);
  })

  .post('/login', rateLimit('login', 20, 900), async (c) => {
    const input = await body(c, loginInput);
    const { userId: uid } = await login(c.var.deps, input.email, input.password);
    // With two-factor on, the password only opens a short session that can do nothing but the second step.
    if (await hasMfa(c.var.deps, uid)) {
      await startUserSession(c, uid, true, input.remember);
      return c.json({ mfa_required: true });
    }
    await startUserSession(c, uid, false, input.remember);
    return c.json(await getMe(c.var.deps.db, uid));
  })
  .post('/mfa/verify', rateLimit('mfa-verify', 10, 900), async (c) => {
    const p = c.var.principal;
    if (!p || p.type !== 'user') throw new DomainError('unauthenticated', 'unauthenticated', 'Sign in with your password first');
    const { code } = await body(c, z.object({ code: z.string().trim().min(6).max(20) }));
    await verifyLoginCode(c.var.deps, p.userId, p.sessionId, code);
    return c.json(await getMe(c.var.deps.db, p.userId, true));
  })

  .post('/logout', async (c) => {
    const p = c.var.principal;
    if (p?.type === 'user') await revokeSession(c.var.deps.db, p.sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  })

  .post('/password/forgot', rateLimit('forgot', 5, 3600), async (c) => {
    const input = await body(c, forgotPasswordInput);
    const { deps } = c.var;
    const u = await findUserByEmail(deps.db, input.email);
    // Always 202 so the endpoint does not reveal which emails have accounts.
    if (u) {
      const token = await issueEmailToken(deps.db, u.id, 'RESET_PASSWORD', 60);
      await deps.mailer.send(
        renderEmail(
          {
            subject: 'Reset your WorkPulse password',
            preheader: 'Use this link within 1 hour to choose a new password.',
            heading: 'Reset your password',
            paragraphs: ['We received a request to reset the password for your WorkPulse account. Choose a new password with the button below.'],
            action: { label: 'Reset password', url: `${deps.config.appUrl}/reset-password?token=${token}` },
            note: "This link expires in 1 hour. If you didn't ask to reset your password, you can ignore this email; your password won't change.",
            reason: 'You received this email because a password reset was requested for this address.',
          },
          { appUrl: deps.config.appUrl, to: u.email },
        ),
      );
    }
    return c.json({ ok: true }, 202);
  })

  .post('/password/reset', rateLimit('reset', 10, 3600), async (c) => {
    const input = await body(c, resetPasswordInput);
    await resetPassword(c.var.deps.db, input.token, input.password);
    return c.json({ ok: true });
  })

  .post('/password/change', requireUser, async (c) => {
    const input = await body(c, changePasswordInput);
    const uid = userId(c);
    const db = c.var.deps.db;
    const [u] = await db.select().from(users).where(eq(users.id, uid));
    if (!u || !(await verifyPassword(u.passwordHash, input.current_password))) throw businessRule('invalid_password', 'Current password is incorrect');
    await db.update(users).set({ passwordHash: await hashPassword(input.new_password), updatedAt: new Date() }).where(eq(users.id, uid));
    return c.json({ ok: true });
  })

  .post('/verify-email', async (c) => {
    const { token } = await body(c, resetPasswordInput.pick({ token: true }));
    const uid = await consumeEmailToken(c.var.deps.db, token, 'VERIFY_EMAIL');
    await markEmailVerified(c.var.deps.db, uid);
    // The link proves control of the mailbox, so it completes sign-in — unless two-factor needs its own step.
    const signedIn = c.var.principal?.type === 'user' && c.var.principal.userId === uid;
    if (!signedIn && c.var.deps.config.requireEmailVerification && !(await hasMfa(c.var.deps, uid))) {
      await startUserSession(c, uid);
      return c.json({ ok: true, signed_in: true });
    }
    return c.json({ ok: true, signed_in: signedIn });
  })

  .post('/invitations/accept', rateLimit('invite-accept', 20, 3600), async (c) => {
    const input = await body(c, acceptInviteInput);
    const p = c.var.principal;
    const r = await acceptInvitation(c.var.deps.db, { token: input.token, name: input.name ?? null, password: input.password ?? null, currentUserId: p?.type === 'user' ? p.userId : null });
    if (!p) await startUserSession(c, r.userId);
    return c.json({ organization_id: r.organizationId, membership_id: r.membershipId, role_key: r.roleKey });
  });

export const meRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', async (c) => c.json(await getMe(c.var.deps.db, userId(c), await hasMfa(c.var.deps, userId(c)))))
  /** The person's own settings: display name and locale (languages and formats). */
  .patch('/', async (c) => {
    const i = await body(c, z.object({ name: z.string().trim().min(1).max(100).optional(), locale: z.string().max(35).optional() }));
    const patch: { name?: string; locale?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (i.name !== undefined) patch.name = i.name;
    if (i.locale !== undefined) {
      let canonical: string | undefined;
      try {
        canonical = Intl.getCanonicalLocales(i.locale)[0];
      } catch {
        canonical = undefined;
      }
      if (!canonical) throw validation('Not a valid language tag', { errors: [{ field: 'locale', message: 'Use a tag like en-US, fr-CA or de' }] });
      patch.locale = canonical;
    }
    await c.var.deps.db.update(users).set(patch).where(eq(users.id, userId(c)));
    return c.json(await getMe(c.var.deps.db, userId(c), await hasMfa(c.var.deps, userId(c))));
  })
  .get('/mfa', async (c) => {
    const p = c.var.principal as { mfaVerified?: boolean };
    return c.json({ enabled: await hasMfa(c.var.deps, userId(c)), session_verified: !!p.mfaVerified, recovery_codes_left: await recoveryCodesLeft(c.var.deps, userId(c)) });
  })
  .post('/mfa/recovery-codes', rateLimit('mfa-recovery', 10, 900), async (c) => {
    const { code } = await body(c, z.object({ code: z.string().trim().min(6).max(20) }));
    return c.json(await regenerateRecoveryCodes(c.var.deps, userId(c), code));
  })
  .post('/mfa/totp/setup', async (c) => c.json(await startTotpSetup(c.var.deps, userId(c))))
  .post('/mfa/totp/confirm', rateLimit('mfa-confirm', 10, 900), async (c) => {
    const { code } = await body(c, z.object({ code: z.string().trim().min(6).max(10) }));
    return c.json(await confirmTotpSetup(c.var.deps, userId(c), sessionId(c), code));
  })
  .post('/mfa/totp/disable', rateLimit('mfa-disable', 10, 900), async (c) => {
    const { code } = await body(c, z.object({ code: z.string().trim().min(6).max(20) }));
    await disableTotp(c.var.deps, userId(c), sessionId(c), code);
    return c.body(null, 204);
  })
  .post('/organizations', async (c) => {
    const input = await body(c, createOrgInput);
    const r = await createOrganization(c.var.deps.db, { name: input.name, timezone: input.timezone, currency: input.currency, ownerUserId: userId(c) });
    return c.json({ organization_id: r.organizationId, membership_id: r.membershipId }, 201);
  });
