import { z } from 'zod';
import type { HelpTutorialDto } from '@tallywork/contracts';
import { notFound } from '@tallywork/domain';
import type { Deps } from '../context';
import type { ByteRange, StoredObject } from '../lib/storage';

/**
 * The Help Center's video tutorial: one set of files for every organization, outside any `org/`
 * prefix, written by `pnpm tutorial:publish` (e2e/tutorial). A manifest lists the chapters; each
 * chapter is its own video (under the storage upload limit) with captions and a poster.
 */
export const TUTORIAL_PREFIX = 'platform/tutorial';

const FILE = /^[a-z0-9][a-z0-9-]{0,80}\.(mp4|vtt|jpg)$/;
const TYPES = { mp4: 'video/mp4', vtt: 'text/vtt; charset=utf-8', jpg: 'image/jpeg' } as const;

const fileName = z.string().regex(FILE);
const manifest = z.object({
  title: z.string().min(1).max(200),
  chapters: z
    .array(z.object({ n: z.number().int().min(1), title: z.string().min(1).max(200), seconds: z.number().min(0), video: fileName, captions: fileName.nullable(), poster: fileName.nullable() }))
    .min(1)
    .max(100),
});

/** The published tutorial, or null when none is published (or its manifest is unreadable). */
export async function helpTutorial(deps: Deps): Promise<HelpTutorialDto | null> {
  const obj = await deps.storage.get(`${TUTORIAL_PREFIX}/manifest.json`);
  if (!obj) return null;
  const parsed = manifest.safeParse(await new Response(obj.body).json().catch(() => null));
  if (!parsed.success) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'help tutorial manifest is invalid', error: parsed.error.message.slice(0, 300) }));
    return null;
  }
  return { title: parsed.data.title, chapters: parsed.data.chapters.map(({ n, title, seconds, video, captions, poster }) => ({ n, title, seconds, video, captions, poster })) };
}

/** One tutorial file, whole or the requested bytes. Only video, caption and poster names are served. */
export async function helpTutorialFile(deps: Deps, name: string, range?: ByteRange): Promise<StoredObject> {
  const m = FILE.exec(name);
  if (!m) throw notFound('file');
  const obj = await deps.storage.get(`${TUTORIAL_PREFIX}/${name}`, range);
  if (!obj) throw notFound('file');
  return { ...obj, contentType: TYPES[m[1] as keyof typeof TYPES] };
}

/** `bytes=500-` or `bytes=500-999` from a Range header; anything else (suffix or multiple ranges) reads the whole file. */
export function parseRange(header: string | undefined): ByteRange | undefined {
  const m = header ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null;
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  if (!Number.isSafeInteger(start) || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) return undefined;
  return { start, end };
}
