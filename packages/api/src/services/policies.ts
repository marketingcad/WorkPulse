import { and, asc, eq, inArray } from 'drizzle-orm';
import { teamMembers, teams, trackingPolicies, type Tx } from '@tallywork/db';
import { resolvePolicy, type PolicyLayer, type TrackingPolicy } from '@tallywork/domain';
import { sha256 } from '../lib/crypto';

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function policyHash(p: TrackingPolicy): string {
  return sha256(stableStringify(p)).slice(0, 16);
}

export async function policyLayers(tx: Tx, organizationId: string, membershipId: string): Promise<PolicyLayer[]> {
  const myTeams = await tx
    .select({ id: teamMembers.teamId, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.membershipId, membershipId))
    .orderBy(asc(teams.name));
  const scopeIds = [organizationId, membershipId, ...myTeams.map((t) => t.id)];
  const rows = await tx.select().from(trackingPolicies).where(and(eq(trackingPolicies.organizationId, organizationId), inArray(trackingPolicies.scopeId, scopeIds)));
  const teamOrder = new Map(myTeams.map((t, i) => [t.id, i]));
  return rows
    .filter((r) => r.scopeType !== 'TEAM' || teamOrder.has(r.scopeId))
    .sort((a, b) => (teamOrder.get(a.scopeId) ?? 0) - (teamOrder.get(b.scopeId) ?? 0))
    .map((r) => ({ scope: r.scopeType, scopeId: r.scopeId, doc: r.doc }));
}

export async function effectivePolicy(tx: Tx, organizationId: string, membershipId: string, cache?: Map<string, TrackingPolicy>): Promise<TrackingPolicy> {
  const hit = cache?.get(membershipId);
  if (hit) return hit;
  const p = resolvePolicy(await policyLayers(tx, organizationId, membershipId));
  cache?.set(membershipId, p);
  return p;
}
