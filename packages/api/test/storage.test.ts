import { describe, expect, it, vi } from 'vitest';
import { createStorage, SupabaseStorage } from '../src/lib/storage';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Records every request and answers from a route table keyed by "METHOD path". */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    const path = new URL(url).pathname;
    const route = routes[`${method} ${path}`];
    return route ? route() : new Response('not stubbed', { status: 500 });
  }) as typeof fetch;
  return { impl, calls };
}

const URL_ = 'https://proj.supabase.co';
const bucketOk = () => new Response(JSON.stringify({ name: 'tallywork' }), { status: 200 });

describe('SupabaseStorage', () => {
  it('creates the private bucket once, then uploads with the service key and upsert', async () => {
    const { impl, calls } = stubFetch({
      'POST /storage/v1/bucket': bucketOk,
      'POST /storage/v1/object/tallywork/org/o1/screens/a%20b.jpg': () => new Response('{}', { status: 200 }),
    });
    const s = new SupabaseStorage(`${URL_}/`, 'service-key', 'tallywork', impl);
    await s.put('org/o1/screens/a b.jpg', Buffer.from('x'), 'image/jpeg');
    await s.put('org/o1/screens/a b.jpg', Buffer.from('y'), 'image/jpeg');

    expect(calls.filter((c) => c.url.endsWith('/bucket'))).toHaveLength(1);
    const bucket = JSON.parse(calls[0]!.body as string);
    expect(bucket).toMatchObject({ id: 'tallywork', public: false });
    const up = calls[1]!;
    expect(up.url).toBe(`${URL_}/storage/v1/object/tallywork/org/o1/screens/a%20b.jpg`);
    expect(up.headers).toMatchObject({ apikey: 'service-key', Authorization: 'Bearer service-key', 'Content-Type': 'image/jpeg', 'x-upsert': 'true' });
  });

  it('accepts JSON (personal data exports) in a new bucket', async () => {
    const { impl, calls } = stubFetch({ 'POST /storage/v1/bucket': bucketOk, 'POST /storage/v1/object/tallywork/k.json': () => new Response('{}', { status: 200 }) });
    await new SupabaseStorage(URL_, 'k', 'tallywork', impl).put('k.json', Buffer.from('{}'), 'application/json');
    expect(JSON.parse(calls[0]!.body as string).allowed_mime_types).toContain('application/json');
  });

  it('brings an existing bucket up to the current settings, so one created before JSON was allowed accepts it', async () => {
    const { impl, calls } = stubFetch({
      'POST /storage/v1/bucket': () => new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), { status: 400 }),
      'PUT /storage/v1/bucket/tallywork': () => new Response('{"message":"Successfully updated"}', { status: 200 }),
      'POST /storage/v1/object/tallywork/k': () => new Response('{}', { status: 200 }),
    });
    await expect(new SupabaseStorage(URL_, 'k', 'tallywork', impl).put('k', Buffer.from('x'), 'image/png')).resolves.toBeUndefined();
    const upd = calls.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(upd.body as string)).toMatchObject({ public: false, allowed_mime_types: expect.arrayContaining(['application/json', 'image/*']) });
  });

  it('still uploads when the existing bucket cannot be updated', async () => {
    const { impl } = stubFetch({
      'POST /storage/v1/bucket': () => new Response('{"message":"The resource already exists"}', { status: 409 }),
      'PUT /storage/v1/bucket/tallywork': () => new Response('denied', { status: 403 }),
      'POST /storage/v1/object/tallywork/k': () => new Response('{}', { status: 200 }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(new SupabaseStorage(URL_, 'k', 'tallywork', impl).put('k', Buffer.from('x'), 'image/png')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('returns null for a missing object and streams an existing one', async () => {
    const { impl } = stubFetch({
      'GET /storage/v1/object/authenticated/tallywork/missing': () => new Response('{"error":"not_found"}', { status: 400 }),
      'GET /storage/v1/object/authenticated/tallywork/there': () => new Response('hello', { status: 200, headers: { 'content-type': 'image/webp' } }),
    });
    const s = new SupabaseStorage(URL_, 'k', 'tallywork', impl);
    expect(await s.get('missing')).toBeNull();
    const obj = await s.get('there');
    expect(obj?.contentType).toBe('image/webp');
    expect(await new Response(obj!.body).text()).toBe('hello');
  });

  it('throws on server errors instead of reporting the object as missing', async () => {
    const { impl } = stubFetch({ 'GET /storage/v1/object/authenticated/tallywork/x': () => new Response('boom', { status: 503 }) });
    await expect(new SupabaseStorage(URL_, 'k', 'tallywork', impl).get('x')).rejects.toThrow(/503/);
  });

  it('deletes keys in batches of 1000', async () => {
    const { impl, calls } = stubFetch({ 'DELETE /storage/v1/object/tallywork': () => new Response('[]', { status: 200 }) });
    const keys = Array.from({ length: 1500 }, (_, i) => `org/o/${i}`);
    await new SupabaseStorage(URL_, 'k', 'tallywork', impl).delete(keys);
    expect(calls.map((c) => JSON.parse(c.body as string).prefixes.length)).toEqual([1000, 500]);
    await new SupabaseStorage(URL_, 'k', 'tallywork', impl).delete([]);
    expect(calls).toHaveLength(2);
  });

  it('returns an absolute signed upload URL scoped to the object', async () => {
    const { impl, calls } = stubFetch({
      'POST /storage/v1/bucket': bucketOk,
      'POST /storage/v1/object/upload/sign/tallywork/org/o1/s.jpg': () => new Response(JSON.stringify({ url: '/object/upload/sign/tallywork/org/o1/s.jpg?token=abc.def' }), { status: 200 }),
    });
    const t = await new SupabaseStorage(URL_, 'k', 'tallywork', impl).createUploadToken('org/o1/s.jpg');
    expect(t).toEqual({ method: 'supabase', token: 'abc.def', url: `${URL_}/storage/v1/object/upload/sign/tallywork/org/o1/s.jpg?token=abc.def` });
    expect(calls[1]!.headers).toMatchObject({ 'x-upsert': 'true' });
  });
});

describe('createStorage', () => {
  it('prefers Supabase when its URL and service key are set', () => {
    expect(createStorage({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: 'k', BLOB_READ_WRITE_TOKEN: 'b' }).kind).toBe('supabase');
    expect(createStorage({ SUPABASE_URL: URL_ }).kind).toBe('memory');
    expect(createStorage({ BLOB_READ_WRITE_TOKEN: 'b' }).kind).toBe('vercel-blob');
  });
});
