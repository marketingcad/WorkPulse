import { desktopCapturer, nativeImage, screen } from 'electron';
import { createHash } from 'node:crypto';
import { applyUrlPolicy, newId, type TrackingPolicy } from '@tallywork/domain';

/**
 * Linux Wayland sessions do not let apps observe global input or other apps' windows. The X11-based
 * hooks still load there, but only see programs running through XWayland, so they would record
 * partial data while looking healthy. On Wayland they are reported unavailable instead.
 */
export function isWaylandSession(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'linux') return false;
  if (env.XDG_SESSION_TYPE) return env.XDG_SESSION_TYPE === 'wayland';
  return !!env.WAYLAND_DISPLAY;
}

// ─── Activity (input FREQUENCY only) ─────────────────────────────────────────
export interface MinuteBucket {
  minute_start: string;
  keyboard: number;
  mouse: number;
  active_seconds: number;
  tracked_seconds: number;
}

/**
 * Counts input events per second while tracking is ACTIVE.
 * PRIVACY CONTRACT: the hook callbacks only increment counters. Key codes,
 * characters, and pointer positions are never read into persistent state.
 */
export class ActivityMonitor {
  private hook: { start(): void; stop(): void; on(ev: string, cb: () => void): void; removeAllListeners?(ev?: string): void } | null = null;
  private running = false;
  private kb = 0;
  private mouse = 0;
  private lastMouseCount = 0;
  private activeSecs = new Set<number>();
  private minuteStart = 0;
  private trackedFrom = 0;
  private readonly minutes: MinuteBucket[] = [];
  /** Activity % of recent closed minutes, kept for the worker's own chart (never synced; the queue has the buckets). */
  private readonly history: Array<{ minute: string; pct: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  lastInputAt = Date.now();
  available = false;

  async init(): Promise<void> {
    if (isWaylandSession()) return; // stays unavailable: see isWaylandSession
    try {
      const mod = (await import('uiohook-napi')) as unknown as { uIOhook: ActivityMonitor['hook'] };
      this.hook = mod.uIOhook;
      const markKey = () => {
        this.kb++;
        this.mark();
      };
      const markMouse = () => {
        const now = Date.now();
        // Sample movement to at most 10 counts/second so mouse motion does not dwarf typing.
        if (now - this.lastMouseCount >= 100) {
          this.mouse++;
          this.lastMouseCount = now;
        }
        this.mark();
      };
      this.hook!.on('keydown', markKey);
      this.hook!.on('mousedown', markMouse);
      this.hook!.on('mousemove', markMouse);
      this.hook!.on('wheel', markMouse);
      this.available = true;
    } catch {
      this.available = false; // e.g. Wayland, or missing macOS Input Monitoring permission
    }
  }

  private mark(): void {
    if (!this.running) return;
    const now = Date.now();
    this.lastInputAt = now;
    this.activeSecs.add(Math.floor(now / 1000));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = Date.now();
    this.trackedFrom = now;
    this.minuteStart = Math.floor(now / 60_000) * 60_000;
    this.lastInputAt = now;
    if (this.available) this.hook?.start();
    this.timer = setInterval(() => this.rollMinute(false), 5_000);
  }

  /** Stop listening entirely (nothing is observed while not tracking). */
  stop(): MinuteBucket[] {
    if (!this.running) return this.drain();
    this.rollMinute(true);
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.available) this.hook?.stop();
    return this.drain();
  }

  /** Close the bucket for [minuteStart, end) and advance to the next minute. */
  private closeBucket(end: number): void {
    const from = Math.max(this.minuteStart, this.trackedFrom);
    const tracked = Math.max(0, Math.min(60, Math.round((end - from) / 1000)));
    if (tracked > 0) {
      const lo = Math.floor(this.minuteStart / 1000);
      const active = [...this.activeSecs].filter((s) => s >= lo && s < lo + 60).length;
      const bucket = {
        minute_start: new Date(this.minuteStart).toISOString(),
        keyboard: this.kb,
        mouse: this.mouse,
        active_seconds: Math.min(active, tracked),
        tracked_seconds: tracked,
      };
      this.minutes.push(bucket);
      const last = this.history[this.history.length - 1];
      const entry = { minute: bucket.minute_start, pct: Math.round((bucket.active_seconds / tracked) * 100) };
      // A minute split by pause/resume closes twice; keep one (the latest) entry per minute.
      if (last?.minute === entry.minute) this.history[this.history.length - 1] = entry;
      else this.history.push(entry);
      if (this.history.length > HISTORY_MINUTES) this.history.splice(0, this.history.length - HISTORY_MINUTES);
    }
    this.kb = 0;
    this.mouse = 0;
    const next = this.minuteStart + 60_000;
    this.activeSecs = new Set([...this.activeSecs].filter((s) => s >= Math.floor(next / 1000)));
    this.minuteStart = next;
    this.trackedFrom = next;
  }

  private rollMinute(force: boolean): void {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    // Close every completed minute (a delayed timer may have skipped some; cap at 1h).
    let guard = 0;
    while (this.minuteStart < currentMinute && guard++ < 60) this.closeBucket(this.minuteStart + 60_000);
    if (this.minuteStart < currentMinute) {
      this.minuteStart = currentMinute;
      this.trackedFrom = currentMinute;
    }
    if (force) {
      this.closeBucket(now);
      this.minuteStart = currentMinute;
      this.trackedFrom = now;
    }
  }

  drain(): MinuteBucket[] {
    return this.minutes.splice(0, this.minutes.length);
  }

  /** Activity % of the most recent closed minute (survives the sync queue draining the buckets). */
  lastPct(): number | null {
    return this.history[this.history.length - 1]?.pct ?? null;
  }

  /** The last hour of per-minute activity %, oldest first. */
  recent(): Array<{ minute: string; pct: number }> {
    return this.history.slice();
  }
}

const HISTORY_MINUTES = 60;

// ─── Apps & URLs ─────────────────────────────────────────────────────────────
export interface AppSpan {
  span_id: string;
  app_name: string;
  app_id: string | null;
  started_at: string;
  ended_at: string;
}
export interface UrlSpan {
  span_id: string;
  domain: string;
  url: string | null;
  browser: string | null;
  started_at: string;
  ended_at: string;
}

interface Current {
  app: string;
  appId: string | null;
  domain: string | null;
  url: string | null;
  since: number;
}

/** Foreground app (and browser domain where the OS exposes it) sampled every 2s. */
export class AppTracker {
  private activeWindow: (() => Promise<{ owner?: { name?: string; path?: string; bundleId?: string }; url?: string; title?: string } | undefined>) | null = null;
  private current: Current | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly apps: AppSpan[] = [];
  private readonly urls: UrlSpan[] = [];
  private sampling = false;
  available = false;
  urlsAvailable = process.platform === 'darwin';
  /**
   * @param resolveUrl active-tab URL for the foreground browser when the OS doesn't expose it
   *   (Windows: browser extension, else the address bar). Called only when URL tracking is enabled.
   */
  constructor(
    private policy: () => TrackingPolicy | null,
    private readonly resolveUrl?: { available: boolean; resolve(exe: string | null): Promise<{ url: string } | null> },
  ) {
    if (resolveUrl?.available) this.urlsAvailable = true;
  }

  async init(): Promise<void> {
    if (isWaylandSession()) return; // stays unavailable: see isWaylandSession
    try {
      const mod = (await import('get-windows')) as unknown as { activeWindow: AppTracker['activeWindow'] };
      this.activeWindow = mod.activeWindow;
      this.available = typeof this.activeWindow === 'function';
    } catch {
      this.available = false;
    }
  }

  start(): void {
    if (this.timer || !this.available) return;
    this.timer = setInterval(() => void this.sample(), 2_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.close(Date.now());
  }

  private close(at: number): void {
    const c = this.current;
    if (!c || at - c.since < 1000) {
      this.current = null;
      return;
    }
    const s = new Date(c.since).toISOString();
    const e = new Date(at).toISOString();
    const p = this.policy();
    if (p?.apps.enabled) this.apps.push({ span_id: newId(), app_name: c.app.slice(0, 200), app_id: c.appId?.slice(0, 300) ?? null, started_at: s, ended_at: e });
    if (p?.urls.enabled && c.domain) this.urls.push({ span_id: newId(), domain: c.domain, url: c.url, browser: c.app.slice(0, 60), started_at: s, ended_at: e });
    this.current = null;
  }

  private async sample(): Promise<void> {
    if (!this.activeWindow || this.sampling) return;
    this.sampling = true;
    try {
      await this.sampleOnce();
    } finally {
      this.sampling = false;
    }
  }

  private async sampleOnce(): Promise<void> {
    let w: Awaited<ReturnType<NonNullable<AppTracker['activeWindow']>>>;
    try {
      w = await this.activeWindow!();
    } catch {
      return;
    }
    const app = w?.owner?.name ?? 'Unknown';
    const appId = w?.owner?.bundleId ?? (w?.owner?.path ? w.owner.path.split(/[\\/]/).pop() ?? null : null);
    const p = this.policy();
    let rawUrl = w?.url ?? null;
    if (!rawUrl && p?.urls.enabled && this.resolveUrl?.available) rawUrl = (await this.resolveUrl.resolve(w?.owner?.path ?? null).catch(() => null))?.url ?? null;
    // The sample time is taken after the (possibly slow) URL lookup so spans don't overlap.
    const now = Date.now();
    // Domain-only (or excluded) is decided HERE, on the device, before anything is stored.
    const trimmed = rawUrl && p ? applyUrlPolicy(rawUrl, p.urls) : null;
    const c = this.current;
    if (!c || c.app !== app || c.domain !== (trimmed?.domain ?? null)) {
      this.close(now);
      this.current = { app, appId, domain: trimmed?.domain ?? null, url: trimmed?.url ?? null, since: now };
    }
  }

  /** What is being recorded right now (already reduced by policy): shown to the worker for transparency. */
  now(): { app: string | null; domain: string | null } | null {
    const c = this.current;
    const p = this.policy();
    if (!this.timer || !c || !p) return null;
    return { app: p.apps.enabled ? c.app : null, domain: p.urls.enabled ? c.domain : null };
  }

  drain(): { apps: AppSpan[]; urls: UrlSpan[] } {
    this.close(Date.now());
    if (this.timer && this.current === null) this.current = null;
    return { apps: this.apps.splice(0), urls: this.urls.splice(0) };
  }
}

// ─── Screenshots ─────────────────────────────────────────────────────────────
export interface Shot {
  id: string;
  capturedAt: string;
  displayIndex: number;
  data: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: string;
  blurred: boolean;
}

/** Capture every display; optionally pixelate (blur) BEFORE anything leaves the device. */
export async function captureScreens(blur: boolean): Promise<Shot[]> {
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)), 1280);
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)), 800);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.min(maxW, 2560), height: Math.min(maxH, 1600) } });
  const at = new Date().toISOString();
  return sources.map((s, i) => {
    let img = s.thumbnail;
    const { width, height } = img.getSize();
    if (blur) {
      // Pixelation blur: downscale hard, then upscale. Text becomes unreadable.
      const small = img.resize({ width: Math.max(16, Math.round(width / 24)), quality: 'good' });
      img = nativeImage.createFromBuffer(small.resize({ width, height, quality: 'good' }).toJPEG(60));
    }
    const data = img.toJPEG(70);
    const thumb = img.resize({ width: 320, quality: 'good' }).toJPEG(65);
    return { id: newId(), capturedAt: at, displayIndex: i, data, thumb, width, height, sha256: createHash('sha256').update(data).digest('hex'), blurred: blur };
  });
}

/** Random capture times within each 10-minute slot (n per slot). */
const SHOT_SLOT_MS = 10 * 60_000;
const MIN_SHOT_DELAY_MS = 1000;

/**
 * Capture delays for the rest of the CURRENT 10-minute slot: the slot is split into
 * `perTenMinutes` equal parts and one capture lands at a random moment in each part
 * that has not ended yet (a partial part only uses its remaining time). A session
 * started mid-slot therefore still gets screenshots for that slot.
 */
export function nextShotDelays(perTenMinutes: number, fromMs = Date.now()): number[] {
  if (perTenMinutes <= 0) return [];
  const slotStart = Math.floor(fromMs / SHOT_SLOT_MS) * SHOT_SLOT_MS;
  const sub = SHOT_SLOT_MS / perTenMinutes;
  const out: number[] = [];
  for (let i = 0; i < perTenMinutes; i++) {
    const start = Math.max(slotStart + i * sub, fromMs + MIN_SHOT_DELAY_MS);
    const end = slotStart + (i + 1) * sub;
    if (end <= start) continue;
    out.push(start + Math.random() * (end - start) - fromMs);
  }
  return out;
}

/** Milliseconds until the next 10-minute slot boundary (when the next plan is made). */
export function msUntilNextShotSlot(fromMs = Date.now()): number {
  return Math.floor(fromMs / SHOT_SLOT_MS) * SHOT_SLOT_MS + SHOT_SLOT_MS - fromMs;
}
