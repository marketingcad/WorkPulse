import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DomainError } from '@tallywork/domain';

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::') return true;
  if (l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd')) return true;
  const mapped = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateV4(mapped[1]!) : false;
}

/** Reject URLs that resolve to private, loopback, link-local or metadata addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError('validation', 'invalid_url', 'Invalid URL');
  }
  if (url.protocol !== 'https:') throw new DomainError('validation', 'insecure_url', 'Webhook URLs must use https');
  if (url.username || url.password) throw new DomainError('validation', 'invalid_url', 'Credentials in URLs are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new DomainError('validation', 'private_url', 'Webhook URLs must be publicly reachable');
  }
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new DomainError('validation', 'unresolvable_url', 'Webhook host could not be resolved');
  for (const a of addrs) {
    if ((a.family === 4 && isPrivateV4(a.address)) || (a.family === 6 && isPrivateV6(a.address))) {
      throw new DomainError('validation', 'private_url', 'Webhook URLs must be publicly reachable');
    }
  }
  return url;
}
