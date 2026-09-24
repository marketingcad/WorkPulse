import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Encrypted persistence for the agent.
 * - A random 256-bit data key is wrapped with the OS keychain via safeStorage
 *   (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 * - Secrets (refresh token) and the offline event queue are AES-256-GCM encrypted
 *   with that data key. Nothing sensitive is stored in plaintext on disk.
 */
export class SecureStore {
  private readonly dir: string;
  private key: Buffer;

  constructor() {
    this.dir = path.join(app.getPath('userData'), 'secure');
    mkdirSync(this.dir, { recursive: true });
    this.key = this.loadOrCreateKey();
  }

  private loadOrCreateKey(): Buffer {
    const file = path.join(this.dir, 'key.bin');
    if (!safeStorage.isEncryptionAvailable()) {
      // Linux without a keyring: refuse to persist secrets unencrypted.
      throw new Error('OS encryption (keychain) is not available; cannot store credentials securely.');
    }
    if (existsSync(file)) return Buffer.from(safeStorage.decryptString(readFileSync(file)), 'base64');
    const key = randomBytes(32);
    writeFileSync(file, safeStorage.encryptString(key.toString('base64')), { mode: 0o600 });
    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  }

  encryptBuffer(data: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }

  decryptBuffer(buf: Buffer): Buffer {
    const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  }

  /** Atomically write an encrypted JSON document. */
  writeJson(name: string, value: unknown): void {
    const file = path.join(this.dir, `${name}.enc`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, this.encrypt(JSON.stringify(value)), { mode: 0o600 });
    renameSync(tmp, file);
  }

  readJson<T>(name: string): T | null {
    const file = path.join(this.dir, `${name}.enc`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(this.decrypt(readFileSync(file, 'utf8'))) as T;
    } catch {
      return null;
    }
  }

  get directory(): string {
    return this.dir;
  }
}
