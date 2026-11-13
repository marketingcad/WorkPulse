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

/** The path of the element's clip, drawing it first unless it is cached. */
export async function renderElement(e: ElementClip, o: { ffmpeg: string; work: string; opaque?: boolean }): Promise<string> {
  pageHash ??= createHash('sha256').update(readFileSync(PAGE)).digest('hex').slice(0, 12);
  const key = createHash('sha256').update(JSON.stringify([VERSION, pageHash, e.kind, e.spec, e.w, e.h, e.duration])).digest('hex').slice(0, 16);
  const dir = path.join(o.work, 'visuals');
  const file = path.join(dir, `${e.kind}-${key}.mov`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });

  browser ??= chromium.launch();
  const page = await (await browser).newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(PAGE).href);
    await page.evaluate(([kind, spec, w, h, d]) => (window as any).mount(kind, spec, w, h, d), [e.kind, e.spec, e.w, e.h, e.duration] as const);
    const frames = Math.max(1, Math.round(e.duration * FPS));
    const part = `${file}.part.mov`;
    const ff = spawn(o.ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'png', '-pix_fmt', o.opaque ? 'rgb24' : 'rgba', part], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    const done = new Promise<void>((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not write ${path.basename(file)}: ${err}`)))));
    for (let f = 0; f < frames; f++) {
      await page.evaluate((ms) => (window as any).seek(ms), (f * 1000) / FPS);
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: e.w, height: e.h }, omitBackground: !o.opaque, type: 'png' });
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    renameSync(part, file);
    return file;
  } finally {
    await page.close();
  }
}

/** Closes the shared browser at the end of a render. */
export async function closeRenderer(): Promise<void> {
  if (browser) await (await browser).close();
  browser = null;
}
