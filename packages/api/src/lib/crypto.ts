import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// argon2id, OWASP-recommended parameters (m=19MiB, t=2, p=1) tuned for serverless CPU budgets.
const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** A dummy hash to keep login timing constant for unknown emails. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

function key(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`${purpose}:${secret}`).digest();
}

/** AES-256-GCM field encryption (webhook secrets, TOTP secrets). */
export function encrypt(secret: string, plaintext: string, purpose = 'field'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, purpose), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function decrypt(secret: string, payload: string, purpose = 'field'): string {
  const [v, iv, enc, tag] = payload.split('.');
  if (v !== 'v1' || !iv || !enc || !tag) throw new Error('Invalid encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Compact signed token: base64url(json).signature — used for short-lived device
 * access tokens and media URLs. Not a JWT on purpose (no alg negotiation).
 */
export function signToken(secret: string, purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, p: purpose, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(secret, `${purpose}.${body}`)}`;
}

export function verifyToken<T extends Record<string, unknown>>(secret: string, purpose: string, token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(secret, `${purpose}.${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { p: string; exp: number };
    if (data.p !== purpose || typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

/** PKCE S256 check. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return safeEqual(computed, challenge);
}
