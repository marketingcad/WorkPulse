/**
 * Renders the tutorial's animated elements (visuals/overlay.html) into short transparent clips, in
 * the Chromium that Playwright already provides: the element's animation clock is set for each frame
 * at 30 fps, the frame is captured with a transparent background, and the frames are piped into
 * ffmpeg as PNG in a MOV, which keeps the alpha channel.
 *
 * A clip depends only on what is drawn (kind, spec, size, length) and on the overlay page, never on
 * where it is placed, so identical elements are drawn once. Clips are cached in <work>/visuals.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

/** Bump when the drawing code outside overlay.html changes how clips look. */
const VERSION = 1;
const FPS = 30;
const PAGE = path.join(import.meta.dirname, 'overlay.html');

export interface ElementClip {
  kind: string;
  spec: Record<string, unknown>;
  w: number;
  h: number;
  /** seconds */
  duration: number;
}

let browser: Promise<Browser> | null = null;
let pageHash: string | null = null;

/**
 * Drawings in progress, by file. Scenes render in parallel, and two of them can need the same element
 * (the same ring on the same button): the second waits for the first instead of drawing it again into
 * the same `.part` file, which made one of them fail to rename it.
 */
const drawing = new Map<string, Promise<string>>();

/** The path of the element's clip, drawing it first unless it is cached. */
export async function renderElement(e: ElementClip, o: { ffmpeg: string; work: string; opaque?: boolean }): Promise<string> {
  pageHash ??= createHash('sha256').update(readFileSync(PAGE)).digest('hex').slice(0, 12);
  const key = createHash('sha256').update(JSON.stringify([VERSION, pageHash, e.kind, e.spec, e.w, e.h, e.duration])).digest('hex').slice(0, 16);
  const dir = path.join(o.work, 'visuals');
  const file = path.join(dir, `${e.kind}-${key}.mov`);
  if (existsSync(file)) return file;
  const pending = drawing.get(file);
  if (pending) return pending;
  const job = drawWithRetry(e, o, dir, file).finally(() => drawing.delete(file));
  drawing.set(file, job);
  return job;
}

/**
 * Draws the element, starting a fresh browser and trying again when the drawing browser stalls: after
 * hundreds of elements in a long render, a screenshot can hang (seen at 40 and 50 of 90 segments).
 */
async function drawWithRetry(e: ElementClip, o: { ffmpeg: string; work: string; opaque?: boolean }, dir: string, file: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const used = (browser ??= chromium.launch());
    try {
      return await draw(e, o, dir, file, await used);
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`[render] drawing ${path.basename(file)} failed (${err instanceof Error ? err.message.split('\n')[0] : err}); retrying with a new browser`);
      // Only the first job to notice replaces the browser; the others retry on the new one.
      if (browser === used) {
        browser = null;
        await (await used).close().catch(() => undefined);
      }
    }
  }
}

async function draw(e: ElementClip, o: { ffmpeg: string; work: string; opaque?: boolean }, dir: string, file: string, b: Browser): Promise<string> {
  mkdirSync(dir, { recursive: true });

  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(PAGE).href);
    await page.evaluate(([kind, spec, w, h, d]) => (window as any).mount(kind, spec, w, h, d), [e.kind, e.spec, e.w, e.h, e.duration] as const);
    const frames = Math.max(1, Math.round(e.duration * FPS));
    const part = `${file}.part.mov`;
    const ff = spawn(o.ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'png', '-pix_fmt', o.opaque ? 'rgb24' : 'rgba', part], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    const done = new Promise<void>((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not write ${path.basename(file)}: ${err}`)))));
    try {
      for (let f = 0; f < frames; f++) {
        await page.evaluate((ms) => (window as any).seek(ms), (f * 1000) / FPS);
        // A generous limit: the scenes' ffmpeg encodes run alongside and can take every core for a while.
        const png = await page.screenshot({ clip: { x: 0, y: 0, width: e.w, height: e.h }, omitBackground: !o.opaque, type: 'png', timeout: 90_000 });
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      }
    } catch (err) {
      // Stop this drawing's ffmpeg, so a retry can write the same .part file.
      ff.kill();
      await done.catch(() => undefined);
      throw err;
    }
    ff.stdin.end();
    await done;
    renameSync(part, file);
    return file;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Closes the shared browser at the end of a render. */
export async function closeRenderer(): Promise<void> {
  if (browser) await (await browser).close();
  browser = null;
}
