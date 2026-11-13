import type { MeDto } from '@tallywork/contracts';
import { sameOriginPath } from './redirect';

type Home = Pick<MeDto, 'organizations' | 'client_portals'>;

/**
 * Where a signed-in person belongs: the organization used last (or their first), a client's
 * dashboards for someone who only views clients, or the welcome page.
 */
export function homePath(me: Home, lastOrg: string | null): string {
  const org = me.organizations.find((o) => o.id === lastOrg) ?? me.organizations[0];
  if (org) return `/o/${org.id}`;
  const portals = me.client_portals ?? [];
  if (portals.length === 1) return `/portal/${portals[0]!.access_id}`;
  return portals.length ? '/portal' : '/welcome';
}

/**
 * Where to go after signing in, or when a signed-in person opens a sign-in page: `next` when it stays
 * on this site (and is not itself a sign-in page, which would send them round in a circle), else home.
 */
export function afterSignIn(me: Home, next: string | null, lastOrg: string | null): string {
  const target = sameOriginPath(next);
  const path = target?.split(/[?#]/)[0];
  if (target && path !== '/login' && path !== '/signup') return target;
  return homePath(me, lastOrg);
}

export function lastOrgId(): string | null {
  try {
    return localStorage.getItem('tw.lastOrg');
  } catch {
    return null;
  }
}

/**
 * The signed-in person, or null. Unlike `api('/me')`, a 401 here does not send the browser to the
 * sign-in page: this is asked from the sign-in page itself.
 */
export async function currentUser(): Promise<MeDto | null> {
  try {
    const res = await fetch('/api/v1/me', { credentials: 'same-origin' });
    if (res.ok) return (await res.json()) as MeDto;
    // An unread body keeps the request open, and the page never goes idle.
    await res.body?.cancel();
    return null;
  } catch {
    return null;
  }
}
