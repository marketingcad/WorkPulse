import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30-second steps) — what every authenticator app supports. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP for one counter value. */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

export function totpCode(secretB32: string, at: Date): string {
  return hotp(base32Decode(secretB32), totpStep(at));
}

/**
 * The time step a code is valid for (the current one, or one step either side for clock drift),
 * or null. Steps at or before `lastUsedStep` are refused so a code cannot be replayed.
 */
export function verifyTotp(secretB32: string, code: string, at: Date, lastUsedStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const now = totpStep(at);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'Tallywork'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Ten single-use recovery codes like `k7p2-9xqm`. */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
