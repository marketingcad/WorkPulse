import { and, eq, gt } from 'drizzle-orm';
import { clientPortalAccess, users, withSystem } from '@tallywork/db';
import { businessRule } from '@tallywork/domain';
import type { clientPortalAcceptInput } from '@tallywork/contracts';
import type { z } from 'zod';
import type { Deps } from '../context';
import { sha256 } from '../lib/crypto';
import { createUser, findUserByEmail } from './identity';

/** Accept a client portal invitation: links (or creates) the viewer's account. Never a membership. */
export async function acceptPortalInvitation(deps: Deps, input: z.infer<typeof clientPortalAcceptInput>, currentUserId: string | null) {
  const invalid = businessRule('invalid_invitation', 'This invitation is invalid or has expired');
  const inv = await withSystem(deps.db, async (tx) => {
    const [a] = await tx
      .select()
      .from(clientPortalAccess)
      .where(and(eq(clientPortalAccess.inviteTokenHash, sha256(input.token)), eq(clientPortalAccess.status, 'INVITED'), gt(clientPortalAccess.inviteExpiresAt, deps.now())))
      .limit(1);
    return a ?? null;
  });
  if (!inv) throw invalid;

  let userId = currentUserId;
  let created = false;
  if (userId) {
    const [me] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!me || me.email.toLowerCase() !== inv.email) throw businessRule('invitation_email_mismatch', `This invitation was sent to ${inv.email}`);
  } else if (await findUserByEmail(deps.db, inv.email)) {
    throw businessRule('login_required', 'Sign in with your existing account to open this dashboard');
  } else {
    if (!input.password) throw businessRule('password_required', 'Choose a password to create your account');
    // The emailed link proves the address, so the account starts verified.
    userId = await createUser(deps.db, { name: input.name ?? inv.name ?? inv.email.split('@')[0]!, email: inv.email, password: input.password, verified: true });
    created = true;
  }
  await withSystem(deps.db, (tx) =>
    tx.update(clientPortalAccess).set({ status: 'ACTIVE', userId, acceptedAt: deps.now(), inviteTokenHash: null, inviteExpiresAt: null }).where(eq(clientPortalAccess.id, inv.id)),
  );
  return { accessId: inv.id, userId: userId!, created };
}
