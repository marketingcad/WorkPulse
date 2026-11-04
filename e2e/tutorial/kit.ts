import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { narrationSeconds, sceneById, slug, type Scene } from './scenes';
import { openDesktop, WorkerDevice, type DesktopOptions } from './desktop';
import { CLIPS_DIR, STATE, TUTORIAL_DATA, TUTORIAL_DESKTOP_URL } from './env';
import type { TutorialData } from './setup';

/**
 * The recording kit: what a scene recording uses to look like a person presenting the app.
 *
 * - A visible cursor with a click ripple (headless video has no cursor).
 * - Eased mouse movement to each target, typing at a readable speed, smooth scrolling.
 * - `mark()` notes when and where to zoom or highlight, in video pixels, for the editor.
 * - The clip lasts at least as long as the scene's narration, so the voiceover fits.
 * - Each clip is saved as clips/<scene id>-<title>.webm with a .markers.json next to it.
 *
 * A recording is a Playwright test whose title is the scene id (see scenes.ts).
 */

export interface Marker {
  /** seconds from the start of the clip */
  at: number;
  label: string;
  /** the area to zoom to or highlight, in video pixels (1920×1080) */
  box?: { x: number; y: number; width: number; height: number };
}

const CURSOR_SCRIPT = `
(() => {
  if (window.__tutorialCursor) return;
  window.__tutorialCursor = true;
  const install = () => {
    const style = document.createElement('style');
    style.textContent = \`
      #tutorial-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none;
        transform: translate(-100px, -100px); transition: transform 0s; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .tutorial-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border-radius: 9999px; border: 3px solid rgba(75,79,196,.85); background: rgba(75,79,196,.18); animation: tutorial-ripple .55s ease-out forwards; }
      @keyframes tutorial-ripple { from { transform: scale(.4); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }\`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.2 19.3 L10.3 13 L16.5 13 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    addEventListener('mousemove', (e) => { cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'tutorial-ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

export class Director {
  readonly markers: Marker[] = [];
  private readonly clipStart = Date.now();
  private sceneStart = Date.now();
  private mouse = { x: 760, y: 430 };

  constructor(
    readonly page: Page,
    readonly scene: Scene,
    readonly data: TutorialData,
    private readonly device: () => Promise<WorkerDevice>,
  ) {}

  private seconds(): number {
    return Math.round((Date.now() - this.clipStart) / 100) / 10;
  }

  /** Opens a page of the demo organization (`/workers`) or any other path (`!/download`). */
  async go(to: string): Promise<void> {
    const url = to.startsWith('!') ? to.slice(1) : `/o/${this.data.orgId}${to}`;
    await this.page.goto(url);
    await this.settle();
    // A new document starts without the cursor; a move puts it back where it was.
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
  }

  /** Opens the desktop app's window, signed in as the demo worker (see desktop.ts). */
  async desktop(opts: DesktopOptions = {}): Promise<void> {
    await openDesktop(this.page, await this.device(), opts);
    await this.settle();
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
  }

  /** Puts the desktop window in a state the app reaches on its own, e.g. an idle prompt. */
  async desktopState(patch: Record<string, unknown>): Promise<void> {
    await this.page.evaluate((p) => (window as any).__tutorialSet(p), patch);
    await this.page.waitForTimeout(400);
  }

  /** Waits until the page has finished loading its data and stopped moving. */
  async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await this.page.waitForTimeout(400);
  }

  /** The point where the narration starts: everything before it is lead-in the editor trims. */
  begin(): void {
    this.sceneStart = Date.now();
    this.markers.push({ at: this.seconds(), label: 'scene start (trim before this)' });
  }

  /** A pause for the viewer to take something in. */
  async beat(ms = 1200): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Glides the cursor to the middle of `target` with an ease-in-out curve. */
  async point(target: Locator, opts: { hold?: number } = {}): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`cannot point at an element that is not visible: ${target}`);
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const distance = Math.hypot(to.x - this.mouse.x, to.y - this.mouse.y);
    const frames = Math.max(12, Math.min(40, Math.round(distance / 22)));
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(this.mouse.x + (to.x - this.mouse.x) * e, this.mouse.y + (to.y - this.mouse.y) * e);
      await this.page.waitForTimeout(12);
    }
    this.mouse = to;
    await this.page.waitForTimeout(opts.hold ?? 250);
  }

  /** Moves to `target` and clicks it, then lets the page react. */
  async click(target: Locator, opts: { settle?: boolean } = {}): Promise<void> {
    await this.point(target, { hold: 200 });
    await target.click();
    if (opts.settle !== false) await this.settle();
    else await this.page.waitForTimeout(350);
    // When the click opened another page, this puts the cursor back on it.
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
  }

  /** Clicks into a field and types at a readable speed (replacing what was there). */
  async type(target: Locator, text: string): Promise<void> {
    await this.point(target, { hold: 150 });
    await target.click();
    await target.fill('');
    await target.pressSequentially(text, { delay: 35 });
    await this.page.waitForTimeout(250);
  }

  /** Sets a date or time field directly, after pointing at it (these fields reformat typed keys). */
  async set(target: Locator, value: string): Promise<void> {
    await this.point(target, { hold: 150 });
    await target.fill(value);
    await this.page.waitForTimeout(500);
  }

  /** Picks an option of a native <select> after pointing at it. */
  async select(target: Locator, option: string | { label: string }): Promise<void> {
    await this.point(target, { hold: 150 });
    await target.selectOption(option);
    await this.page.waitForTimeout(500);
  }

  /** Picks the option of a native <select> whose text contains `text` (option labels often add details). */
  async choose(target: Locator, text: string): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const value = await target.evaluate((el, t) => {
      const option = Array.from((el as HTMLSelectElement).options).find((o) => o.text.includes(t));
      return option ? option.value : null;
    }, text);
    if (value === null) throw new Error(`no option containing "${text}" in ${target}`);
    await this.select(target, value);
  }

  /** Scrolls `target` smoothly to the middle of the screen. */
  async scrollTo(target: Locator): Promise<void> {
    await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await this.page.waitForTimeout(900);
  }

  /** Scrolls the page by `dy` CSS pixels, smoothly. */
  async scroll(dy: number): Promise<void> {
    await this.page.mouse.wheel(0, dy);
    await this.page.waitForTimeout(900);
  }

  /**
   * Notes a zoom or highlight for the editor: "at 12.4 s, zoom to the Approve button". With a
   * target, the box is where it is on screen, in video pixels.
   */
  async mark(label: string, target?: Locator): Promise<void> {
    const box = target ? await target.boundingBox() : null;
    this.markers.push({
      at: this.seconds(),
      label,
      ...(box ? { box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } } : {}),
    });
  }

  /** Holds the last frame until the narration has had time to finish. */
  async finish(): Promise<void> {
    const left = narrationSeconds(this.scene) * 1000 - (Date.now() - this.sceneStart);
    await this.page.waitForTimeout(Math.max(1500, left + 1000));
    this.markers.push({ at: this.seconds(), label: 'scene end (trim after this)' });
  }
}

interface Fixtures {
  d: Director;
  scene: Scene;
}

interface WorkerFixtures {
  /** The demo worker's desktop sign-in, made the first time a scene opens the desktop window. */
  device: () => Promise<WorkerDevice>;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  device: [
    async ({}, use) => {
      let signedIn: Promise<WorkerDevice> | null = null;
      await use(() => (signedIn ??= (async () => {
        const dev = new WorkerDevice();
        await dev.signIn();
        return dev;
      })()));
    },
    { scope: 'worker' },
  ],
  scene: async ({}, use, info) => use(sceneById(info.title)),
  // Each scene is recorded as the person the script says is presenting it.
  storageState: async ({}, use, info) => {
    const who = sceneById(info.title).persona;
    await use(who === 'admin' || who === 'manager' ? STATE[who] : { cookies: [], origins: [] });
  },
  d: async ({ page, scene, device }, use, info) => {
    await page.addInitScript(CURSOR_SCRIPT);
    const data = JSON.parse(readFileSync(TUTORIAL_DATA, 'utf8')) as TutorialData;
    const director = new Director(page, scene, data, device);
    await use(director);
    // Save the clip under the scene's name, only for a scene that recorded without errors. A failed
    // scene keeps its page open, so Playwright can attach the page snapshot to the error.
    const video = page.video();
    if (video && info.status === info.expectedStatus) {
      await page.close();
      mkdirSync(CLIPS_DIR, { recursive: true });
      const name = `${scene.id}-${slug(scene.title)}`;
      await video.saveAs(path.join(CLIPS_DIR, `${name}.webm`));
      writeFileSync(path.join(CLIPS_DIR, `${name}.markers.json`), JSON.stringify({ scene: scene.id, title: scene.title, narrationSeconds: narrationSeconds(scene), markers: director.markers }, null, 2));
    }
  },
});

/** A field's exact label, with or without the " *" that marks a required field. */
export function label(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}( \\*)?$`);
}

/** A choice in a segmented control, which renders as radios or as pressed buttons. */
export function choice(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('radio', { name, exact: true }).or(scope.getByRole('button', { name, exact: true })).first();
}

/**
 * For a recording file of the desktop app: opens the desktop window instead of the website, in
 * the time zone of the demo worker's computer (Ava works from Manila).
 */
export function useDesktopWindow(): void {
  test.use({ baseURL: TUTORIAL_DESKTOP_URL, timezoneId: 'Asia/Manila' });
}

export { expect };
