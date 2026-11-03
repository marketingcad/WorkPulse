/**
 * Publishes the tutorial's chapter files (e2e/tutorial/video/chapters, written by `pnpm tutorial:render`)
 * to the app's storage, where the Help Center plays them for system admins. `pnpm tutorial:publish`.
 *
 * Storage is chosen from the environment the same way the app chooses it (packages/api createStorage):
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else BLOB_READ_WRITE_TOKEN, else LOCAL_STORAGE_DIR. With
 * none of them it refuses, since in-memory storage would publish nowhere. For the local dev server
 * (`pnpm dev`) use LOCAL_STORAGE_DIR=apps/web/.data/blobs.
 *
 * Order: every chapter file first, then manifest.json (so the Help Center never lists a chapter that
 * is not there yet), then the previous manifest's files that the new one no longer uses are removed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = path.join(import.meta.dirname, 'video', 'chapters');
const PREFIX = 'platform/tutorial';
/** The storage bucket's per-file limit (packages/api SupabaseStorage). */
const MAX_BYTES = 50 * 1024 * 1024;
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.jpg': 'image/jpeg' };

interface Manifest {
  chapters: Array<{ video: string; captions: string | null; poster: string | null }>;
}
const files = (m: Manifest) => m.chapters.flatMap((c) => [c.video, c.captions, c.poster]).filter((f): f is string => !!f);

const env = { ...process.env };
// pnpm runs this from e2e/: a relative folder means one from the repo root, like the docs say.
if (env.LOCAL_STORAGE_DIR && !path.isAbsolute(env.LOCAL_STORAGE_DIR)) env.LOCAL_STORAGE_DIR = path.resolve(import.meta.dirname, '../..', env.LOCAL_STORAGE_DIR);
if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) && !env.BLOB_READ_WRITE_TOKEN && !env.LOCAL_STORAGE_DIR) {
  throw new Error('No storage configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or BLOB_READ_WRITE_TOKEN, or LOCAL_STORAGE_DIR for a local server)');
}
// A placeholder or a key pasted with smart quotes would otherwise fail deep inside fetch ("Cannot convert argument to a ByteString").
for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BLOB_READ_WRITE_TOKEN'] as const) {
  const value = env[name];
  if (value && (!/^[\x21-\x7e]+$/.test(value) || value === '...')) throw new Error(`${name} is not a real value (it has spaces, quotes or symbols like "…"): copy it exactly from Vercel › Settings › Environment Variables`);
}
// Storage lives at {SUPABASE_URL}/storage/v1, so a URL copied with the REST path (…/rest/v1/) points nowhere.
if (env.SUPABASE_URL && !/^https:\/\/[^/]+\/?$/.test(env.SUPABASE_URL)) throw new Error('SUPABASE_URL must be the project URL only, like https://abcd1234.supabase.co (no /rest/v1/ or other path)');
if (!existsSync(path.join(DIR, 'manifest.json'))) throw new Error(`No chapter files in ${DIR}: run pnpm tutorial:render first`);

// @tallywork/api is a dependency of the web app, not of the e2e package.
const web = path.resolve(import.meta.dirname, '../../apps/web');
const fromWeb = createRequire(path.join(web, 'package.json'));
const { createStorage } = await import(pathToFileURL(fromWeb.resolve('@tallywork/api')).href);
const storage = createStorage(env);

const manifestJson = readFileSync(path.join(DIR, 'manifest.json'));
const next = JSON.parse(manifestJson.toString('utf8')) as Manifest;
for (const f of files(next)) {
  const size = statSync(path.join(DIR, f)).size;
  if (size > MAX_BYTES) throw new Error(`${f} is ${Math.round(size / 1048576)} MB, over the ${MAX_BYTES / 1048576} MB storage limit`);
}

const old = await storage.get(`${PREFIX}/manifest.json`);
const previous = old ? ((await new Response(old.body).json().catch(() => null)) as Manifest | null) : null;

console.log(`[publish] ${storage.kind} storage: ${next.chapters.length} chapters`);
for (const f of files(next)) {
  await storage.put(`${PREFIX}/${f}`, readFileSync(path.join(DIR, f)), TYPES[path.extname(f)]!);
  console.log(`[publish] ${f}`);
}
await storage.put(`${PREFIX}/manifest.json`, manifestJson, 'application/json');

const keep = new Set(files(next));
const stale = previous ? files(previous).filter((f) => !keep.has(f)) : [];
if (stale.length) await storage.delete(stale.map((f) => `${PREFIX}/${f}`));
console.log(`[publish] published${stale.length ? `; removed ${stale.length} file(s) of the previous version` : ''}`);
