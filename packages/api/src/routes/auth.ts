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
import { businessRule } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { rateLimit } from '../middleware/rate-limit';
import { SESSION_COOKIE, requireUser, userId } from '../middleware/auth';
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

function meta(c: Context<AppEnv>) {
  return { ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: c.req.header('user-agent') ?? null };
}

async function startSession(c: Context<AppEnv>, uid: string) {
  const { token, expiresAt } = await createSession(c.var.deps, uid, meta(c));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.var.deps.config.env === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
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
    const token = await issueEmailToken(deps.db, uid, 'VERIFY_EMAIL', 60 * 24 * 3);
    await deps.mailer.send({
      to: input.email,
      subject: 'Confirm your Tallywork email',
      text: `Welcome to Tallywork!\n\nConfirm your email: ${deps.config.appUrl}/verify-email?token=${token}\n`,
    });
    await startSession(c, uid);
    return c.json({ user_id: uid, organization_id: org.organizationId }, 201);
  })

  .post('/login', rateLimit('login', 20, 900), async (c) => {
    const input = await body(c, loginInput);
    const { userId: uid } = await login(c.var.deps, input.email, input.password);
    await startSession(c, uid);
    return c.json(await getMe(c.var.deps.db, uid));
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
      await deps.mailer.send({ to: u.email, subject: 'Reset your Tallywork password', text: `Reset your password (valid for 1 hour): ${deps.config.appUrl}/reset-password?token=${token}\n` });
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
    return c.json({ ok: true });
  })

  .post('/invitations/accept', rateLimit('invite-accept', 20, 3600), async (c) => {
    const input = await body(c, acceptInviteInput);
    const p = c.var.principal;
    const r = await acceptInvitation(c.var.deps.db, { token: input.token, name: input.name ?? null, password: input.password ?? null, currentUserId: p?.type === 'user' ? p.userId : null });
    if (!p) await startSession(c, r.userId);
    return c.json({ organization_id: r.organizationId, membership_id: r.membershipId });
  });

export const meRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', async (c) => c.json(await getMe(c.var.deps.db, userId(c))))
  .post('/organizations', async (c) => {
    const input = await body(c, createOrgInput);
    const r = await createOrganization(c.var.deps.db, { name: input.name, timezone: input.timezone, currency: input.currency, ownerUserId: userId(c) });
    return c.json({ organization_id: r.organizationId, membership_id: r.membershipId }, 201);
  });
