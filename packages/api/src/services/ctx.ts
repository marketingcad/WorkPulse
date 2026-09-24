import type { Context } from 'hono';
import type { Tx } from '@tallywork/db';
import type { TrackingPolicy } from '@tallywork/domain';
import type { Actor, AppEnv, Deps, OrgInfo } from '../context';

/** Everything a tenant-scoped service needs, detached from HTTP. */
export interface Ctx {
  tx: Tx;
  actor: Actor;
  org: OrgInfo;
  deps: Deps;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  policyCache: Map<string, TrackingPolicy>;
}

export function ctx(c: Context<AppEnv>): Ctx {
  return {
    tx: c.var.tx,
    actor: c.var.actor,
    org: c.var.org,
    deps: c.var.deps,
    requestId: c.var.requestId,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
    policyCache: c.var.policyCache,
  };
}

export function actorRef(x: Ctx): { actorType: 'user' | 'agent' | 'system' | 'api_key'; actorId: string | null } {
  const p = x.actor.principal;
  if (p.type === 'api_key') return { actorType: 'api_key', actorId: p.keyId };
  if (p.type === 'agent') return { actorType: 'agent', actorId: p.deviceId };
  return { actorType: 'user', actorId: x.actor.membershipId };
}
