import { lookup } from 'node:dns';
import { lookup as lookupAsync } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { DomainError } from '@tallywork/domain';

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 address to 8 groups of 16 bits (handles `::` and a trailing dotted IPv4). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    s = s.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(Math.max(0, fill)).fill('0'), ...t];
  if (all.length !== 8) return null;
  const nums = all.map((g) => parseInt(g, 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

function isPrivateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true; // unparsable: refuse
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPrivateV4(v4(g[6]!, g[7]!)); // IPv4-mapped
  if (g.slice(0, 6).every((n) => n === 0)) return isPrivateV4(v4(g[6]!, g[7]!)); // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(v4(g[6]!, g[7]!)); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(v4(g[1]!, g[2]!)); // 6to4
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** Whether an IP address literal must never be contacted. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true;
}

function checkUrl(raw: string): URL {
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
  return url;
}

/** Reject URLs that resolve to private, loopback, link-local or metadata addresses (checked when saving). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = checkUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookupAsync(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new DomainError('validation', 'unresolvable_url', 'Webhook host could not be resolved');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new DomainError('validation', 'private_url', 'Webhook URLs must be publicly reachable');
  return url;
}

/**
 * DNS lookup used for the actual connection: every resolved address is checked, so a host that
 * resolves to a public address when the URL is saved but to a private one when we connect
 * (DNS rebinding) is refused at connect time.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(Object.assign(new Error('Webhook host resolves to a non-public address'), { code: 'EPRIVATE' }), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface PostResult {
  status: number;
  body: string;
}
export type HttpPost = (url: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<PostResult>;

/** POST to a public https URL: no redirects, connect-time address check, bounded time and response size. */
export const postToPublicUrl: HttpPost = (raw, headers, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const url = checkUrl(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivateAddress(host)) return reject(new Error('Webhook host is a non-public address'));
    const req = request(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, lookup: publicOnlyLookup, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (text.length < 1000) text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text.slice(0, 1000) }));
    });
    req.on('timeout', () => req.destroy(new Error('Webhook delivery timed out')));
    req.on('error', reject);
    req.end(body);
  });
