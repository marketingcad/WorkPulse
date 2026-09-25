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
  /** Token the desktop agent uses to upload one object directly. `url` is set when the upload goes to a pre-signed URL. */
  createUploadToken(key: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
}

export interface UploadTarget {
  token: string;
  method: 'vercel-blob' | 'supabase' | 'api';
  url?: string;
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

/**
 * Supabase Storage over its REST API, using a private bucket and the service-role key
 * (server only; the key never leaves the API). The agent uploads through signed
 * upload URLs scoped to a single object path. Supabase signed upload URLs have a
 * fixed 2-hour lifetime and no per-object size cap, so the bucket's
 * file_size_limit and allowed MIME types are the upload guard.
 */
export class SupabaseStorage implements Storage {
  readonly kind = 'supabase';
  private readonly base: string;
  private bucketReady: Promise<void> | null = null;

  constructor(
    url: string,
    private readonly key: string,
    private readonly bucket = 'tallywork',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${url.replace(/\/$/, '')}/storage/v1`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  private objectPath(key: string): string {
    return `${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async fail(res: Response, op: string): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase Storage ${op} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  /** Create the private bucket on first use; an existing bucket is left untouched. */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const res = await this.fetchImpl(`${this.base}/bucket`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: this.bucket,
          name: this.bucket,
          public: false,
          file_size_limit: 50 * 1024 * 1024,
          allowed_mime_types: ['image/*', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        }),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      if (res.status === 409 || /already exists|duplicate/i.test(text)) return;
      throw new Error(`Supabase Storage bucket setup failed (${res.status}): ${text.slice(0, 200)}`);
    })().catch((e) => {
      this.bucketReady = null;
      throw e;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer | ReadableStream | Blob, contentType: string): Promise<void> {
    await this.ensureBucket();
    const data = Buffer.isBuffer(body) ? new Uint8Array(body) : body instanceof Blob ? body : new Uint8Array(await new Response(body).arrayBuffer());
    const res = await this.fetchImpl(`${this.base}/object/${this.objectPath(key)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
      body: data,
    });
    if (!res.ok) await this.fail(res, 'upload');
  }

  async get(key: string) {
    const res = await this.fetchImpl(`${this.base}/object/authenticated/${this.objectPath(key)}`, { headers: this.headers() });
    // Supabase reports a missing object as 400 or 404.
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok || !res.body) return this.fail(res, 'download');
    return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const res = await this.fetchImpl(`${this.base}/object/${encodeURIComponent(this.bucket)}`, {
        method: 'DELETE',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: keys.slice(i, i + 1000) }),
      });
      if (!res.ok) await this.fail(res, 'delete');
    }
  }

  async createUploadToken(key: string): Promise<UploadTarget> {
    await this.ensureBucket();
    const res = await this.fetchImpl(`${this.base}/object/upload/sign/${this.objectPath(key)}`, {
      method: 'POST',
      headers: this.headers({ 'x-upsert': 'true' }),
    });
    if (!res.ok) await this.fail(res, 'sign upload');
    const { url } = (await res.json()) as { url: string };
    const signed = new URL(`${this.base}${url}`);
    return { token: signed.searchParams.get('token') ?? '', method: 'supabase', url: signed.toString() };
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
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_STORAGE_BUCKET || 'tallywork');
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) return new VercelBlobStorage(token);
  if (env.LOCAL_STORAGE_DIR) return new FileStorage(env.LOCAL_STORAGE_DIR);
  return new MemoryStorage();
}
