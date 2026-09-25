import { isIP } from 'node:net';

/** IPv4/IPv6 addresses as a bigint, plus their bit length. */
function toBig(ip: string): { v: bigint; bits: number } | null {
  const fam = isIP(ip);
  if (fam === 4) return { v: ip.split('.').reduce((a, o) => (a << 8n) | BigInt(Number(o)), 0n), bits: 32 };
  if (fam !== 6) return null;
  let s = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    s = s.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8) return null;
  return { v: groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g, 16)), 0n), bits: 128 };
}

/** An IPv4-mapped IPv6 address (::ffff:1.2.3.4) compared as IPv4. */
function normalize(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1]! : ip;
}

/** Parse `1.2.3.0/24`, `2001:db8::/32` or a single address; null when invalid. */
export function parseCidr(cidr: string): { base: bigint; bits: number; prefix: number } | null {
  const [addr, len] = cidr.trim().split('/') as [string, string | undefined];
  const ip = toBig(normalize(addr));
  if (!ip) return null;
  const prefix = len === undefined ? ip.bits : Number(len);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.bits || (len !== undefined && !/^\d+$/.test(len))) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(ip.bits - prefix);
  return { base: ip.v & mask, bits: ip.bits, prefix };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const c = parseCidr(cidr);
  const a = toBig(normalize(ip));
  if (!c || !a || a.bits !== c.bits) return false;
  const mask = c.prefix === 0 ? 0n : ((1n << BigInt(c.prefix)) - 1n) << BigInt(c.bits - c.prefix);
  return (a.v & mask) === c.base;
}

export function ipAllowed(ip: string | null, allowlist: string[] | undefined): boolean {
  if (!allowlist?.length) return true;
  return !!ip && allowlist.some((c) => ipInCidr(ip, c));
}

/**
 * The client address as seen by the platform. On Vercel, `x-vercel-forwarded-for` and
 * `x-real-ip` are set by the edge and cannot be supplied by the client.
 */
export function clientIp(header: (name: string) => string | undefined): string | null {
  const raw = header('x-vercel-forwarded-for') ?? header('x-real-ip') ?? header('x-forwarded-for');
  const ip = raw?.split(',')[0]?.trim();
  return ip && isIP(normalize(ip)) ? normalize(ip) : null;
}
