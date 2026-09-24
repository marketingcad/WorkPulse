import type { Db, Tx } from '@tallywork/db';
import type { ActorContext, Grants, TrackingPolicy } from '@tallywork/domain';
import type { Config } from './config';
import type { Mailer } from './lib/mailer';
import type { Storage } from './lib/storage';

/** Infrastructure injected into the app (swapped for fakes in tests). */
export interface Deps {
  db: Db;
  config: Config;
  storage: Storage;
  mailer: Mailer;
  /** Run work after the response is sent (Next.js `after()` in production). */
  defer: (task: () => Promise<void>) => void;
  now: () => Date;
}

export type Principal =
  | { type: 'user'; userId: string; sessionId: string; mfaVerified: boolean }
  | { type: 'agent'; deviceId: string; membershipId: string; organizationId: string; userId: string }
  | { type: 'api_key'; keyId: string; organizationId: string; createdBy: string; scopes: string[] };

/** The resolved acting member inside an organization. */
export interface Actor extends ActorContext {
  assignedProjectIds: Set<string>;
  managedMembershipIds: Set<string>;
  organizationId: string;
  userId: string | null;
  principal: Principal;
  roleKey: string;
  isOwner: boolean;
  grants: Grants;
  managedTeamIds: string[];
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  weekStart: number;
  currency: string;
  payPeriod: import('@tallywork/domain').PayPeriodConfig;
  settings: import('@tallywork/db').OrgSettings;
}

export interface AppEnv {
  Variables: {
    deps: Deps;
    requestId: string;
    principal: Principal | null;
    tx: Tx;
    actor: Actor;
    org: OrgInfo;
    policyCache: Map<string, TrackingPolicy>;
  };
}
