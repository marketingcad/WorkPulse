import { del, get, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

/**
 * Object storage abstraction. Keys are always prefixed `org/{orgId}/...`.
 * Private objects are never served directly; the API streams them after an
 * authorization check.
 */
export interface Storage {
  readonly kind: string;
  put(key: string, body: Buffer | ReadableStream | Blob, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string } | null>;
  delete(keys: string[]): Promise<void>;
  /** Token the desktop agent uses to upload one object directly. */
  createUploadToken(key: string, contentType: string, maxBytes: number): Promise<{ token: string; method: 'vercel-blob' | 'api' }>;
}

export class VercelBlobStorage implements Storage {
  readonly kind = 'vercel-blob';
  constructor(private readonly token: string) {}

  async put(key: string, body: Buffer | ReadableStream | Blob, contentType: string): Promise<void> {
    await put(key, body, { access: 'private', contentType, token: this.token, addRandomSuffix: false, allowOverwrite: true });
  }

  async get(key: string) {
    const res = await get(key, { access: 'private', token: this.token });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return { body: res.stream, contentType: res.blob.contentType ?? 'application/octet-stream' };
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500), { token: this.token });
  }

  async createUploadToken(key: string, contentType: string, maxBytes: number) {
    const token = await generateClientTokenFromReadWriteToken({
      token: this.token,
      pathname: key,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: maxBytes,
      validUntil: Date.now() + 10 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { token, method: 'vercel-blob' as const };
  }
}

/** In-memory storage for tests and zero-config local development. */
export class MemoryStorage implements Storage {
  readonly kind = 'memory';
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async put(key: string, body: Buffer | ReadableStream | Blob, contentType: string): Promise<void> {
    let data: Buffer;
    if (Buffer.isBuffer(body)) data = body;
    else if (body instanceof Blob) data = Buffer.from(await body.arrayBuffer());
    else data = Buffer.from(await new Response(body).arrayBuffer());
    this.objects.set(key, { data, contentType });
  }

  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { body: new Response(new Uint8Array(o.data)).body!, contentType: o.contentType };
  }

  async delete(keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k);
  }

  async createUploadToken() {
    // Local dev: the agent uploads through the API route instead.
    return { token: '', method: 'api' as const };
  }
}

/** Local filesystem storage for zero-config development (persists across restarts). */
export class FileStorage implements Storage {
  readonly kind = 'file';
  constructor(private readonly root: string) {}

  private path(key: string) {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return `${this.root}/${safe}`;
  }

  async put(key: string, body: Buffer | ReadableStream | Blob, contentType: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const p = this.path(key);
    await fs.mkdir(p.slice(0, p.lastIndexOf('/')), { recursive: true });
    const data = Buffer.isBuffer(body) ? body : body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(await new Response(body).arrayBuffer());
    await fs.writeFile(p, data);
    await fs.writeFile(`${p}.type`, contentType);
  }

  async get(key: string) {
    const fs = await import('node:fs/promises');
    try {
      const data = await fs.readFile(this.path(key));
      const contentType = await fs.readFile(`${this.path(key)}.type`, 'utf8').catch(() => 'application/octet-stream');
      return { body: new Response(new Uint8Array(data)).body!, contentType };
    } catch {
      return null;
    }
  }

  async delete(keys: string[]): Promise<void> {
    const fs = await import('node:fs/promises');
    for (const k of keys) {
      await fs.rm(this.path(k), { force: true });
      await fs.rm(`${this.path(k)}.type`, { force: true });
    }
  }

  async createUploadToken() {
    return { token: '', method: 'api' as const };
  }
}

export function createStorage(env: Record<string, string | undefined> = process.env): Storage {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) return new VercelBlobStorage(token);
  if (env.LOCAL_STORAGE_DIR) return new FileStorage(env.LOCAL_STORAGE_DIR);
  return new MemoryStorage();
}
