import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A worker with three monitors: a 1080p screen, a 4K screen and a 1440p screen. Every screenshot
 * photographs all three at the same moment, as Screen 1, 2 and 3, with the organization's blur applied
 * to each on this computer before anything is sent, and a very large screen capped at 2560 × 1600.
 * Electron's screen, capturer and image APIs are replaced by fakes that record what was asked of them.
 */
const log = vi.hoisted(() => ({ requested: [] as Array<{ types: string[]; thumbnailSize: { width: number; height: number } }>, resized: [] as Array<{ tag: string; width: number }> }));

vi.mock('electron', () => {
  class FakeImage {
    constructor(
      readonly w: number,
      readonly h: number,
      readonly tag: string,
    ) {}
    getSize() {
      return { width: this.w, height: this.h };
    }
    resize({ width, height }: { width: number; height?: number }) {
      log.resized.push({ tag: this.tag, width });
      return new FakeImage(width, height ?? Math.round((this.h * width) / this.w), this.tag);
    }
    toJPEG(quality: number) {
      return Buffer.from(`${this.tag}:${this.w}x${this.h}:q${quality}`);
    }
  }
  const displays = [
    { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 2, size: { width: 3840, height: 2160 }, scaleFactor: 1 },
    { id: 3, size: { width: 2560, height: 1440 }, scaleFactor: 1 },
  ];
  return {
    Notification: class {
      show() {}
    },
    net: {},
    powerMonitor: { on: () => undefined },
    screen: { getAllDisplays: () => displays },
    desktopCapturer: {
      getSources: async (opts: { types: string[]; thumbnailSize: { width: number; height: number } }) => {
        log.requested.push(opts);
        // Each screen's picture, fitted within the requested size (the 4K screen comes back at 2560 × 1440).
        return displays.map((d, i) => {
          const k = Math.min(1, opts.thumbnailSize.width / d.size.width, opts.thumbnailSize.height / d.size.height);
          return { id: `screen:${d.id}:0`, name: `Screen ${i + 1}`, thumbnail: new FakeImage(Math.round(d.size.width * k), Math.round(d.size.height * k), `screen-${i + 1}`) };
        });
      },
    },
    nativeImage: {
      createFromBuffer: (buf: Buffer) => {
        const [tag, size] = buf.toString().split(':');
        const [w, h] = size!.split('x').map(Number);
        return new FakeImage(w!, h!, `blurred(${tag})`);
      },
    },
  };
});
vi.mock('../src/main/services/secure-store', () => ({
  SecureStore: class {
    readJson = () => null;
    writeJson = () => undefined;
  },
}));
const requests: Array<{ method: string; path: string; body?: { screenshot_id?: string } }> = [];
vi.mock('../src/main/services/api', () => ({
  ApiError: class extends Error {},
  AgentApi: class {
    signedIn = true;
    serverUrl = null;
    onSignedOut = () => undefined;
    async request(method: string, path: string, body?: { screenshot_id?: string }) {
      requests.push({ method, path, body });
      if (path === '/agent/screenshots/upload-intent') {
        const key = `shots/${body!.screenshot_id}.jpg`;
        return { method: 'api', storage_key: key, thumb_key: `${key}.thumb`, token: 't', thumb_token: 't', upload_url: `/api/v1/agent/screenshots/upload?key=${key}`, thumb_upload_url: `/api/v1/agent/screenshots/upload?key=${key}.thumb` };
      }
      return {};
    }
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => account ?? 'queue.log',
  OfflineQueue: class {
    full = false;
    events: unknown[] = [];
    push(e: unknown) {
      this.events.push(e);
    }
    get size() {
      return this.events.length;
    }
  },
}));

const { captureScreens } = await import('../src/main/services/monitors');
const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

beforeEach(() => {
  log.requested.length = 0;
  log.resized.length = 0;
  requests.length = 0;
});

describe('capturing three monitors', () => {
  it('should_photograph_every_screen_at_the_same_moment_as_screen_1_2_and_3', async () => {
    const shots = await captureScreens(false);
    expect(shots.map((s) => s.displayIndex)).toEqual([0, 1, 2]);
    expect(new Set(shots.map((s) => s.capturedAt)).size).toBe(1); // one moment for all screens
    expect(new Set(shots.map((s) => s.id)).size).toBe(3);
    expect(new Set(shots.map((s) => s.sha256)).size).toBe(3); // three different pictures
    expect(shots.map((s) => s.data.toString().split(':')[0])).toEqual(['screen-1', 'screen-2', 'screen-3']);
    expect(shots.every((s) => !s.blurred)).toBe(true);
  });

  it('should_cap_a_4k_screen_at_2560_by_1600', async () => {
    const shots = await captureScreens(false);
    expect(log.requested).toEqual([{ types: ['screen'], thumbnailSize: { width: 2560, height: 1600 } }]);
    expect(shots.map((s) => [s.width, s.height])).toEqual([
      [1920, 1080],
      [2560, 1440], // the 4K screen, scaled down
      [2560, 1440],
    ]);
  });

  it('should_blur_every_screen_on_this_computer_when_the_policy_says_so', async () => {
    const shots = await captureScreens(true);
    expect(shots.every((s) => s.blurred)).toBe(true);
    // Each screen was shrunk hard (a 24th of its width) and only then encoded: what leaves is the blur.
    for (const [i, s] of shots.entries()) {
      expect(log.resized).toContainEqual({ tag: `screen-${i + 1}`, width: Math.round(s.width / 24) });
      expect(s.data.toString()).toMatch(new RegExp(`^blurred\\(screen-${i + 1}\\)`));
    }
  });

  it('should_make_a_thumbnail_of_each_screen', async () => {
    const shots = await captureScreens(false);
    expect(shots.map((s) => s.thumb.toString().split(':')[1]!.split('x')[0])).toEqual(['320', '320', '320']);
  });
});

describe('the app sends every screen of a capture', () => {
  function runningAgent(blur: boolean, state: 'active' | 'paused' | null = 'active') {
    const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
    const a = agent as unknown as Record<string, unknown>;
    a.boot = { policy: { ...DEFAULT_POLICY, screenshots: { ...DEFAULT_POLICY.screenshots, enabled: true, blur, notify: false } } };
    a.session = state ? { id: 'session-1', state } : null;
    return agent;
  }
  const events = (agent: InstanceType<typeof Agent>) => (agent.queue as unknown as { events: Array<Record<string, unknown>> }).events;
  const take = (agent: InstanceType<typeof Agent>) => (agent as unknown as { takeScreenshots(): Promise<void> }).takeScreenshots();

  it('should_upload_three_pictures_and_record_them_as_screen_1_2_and_3_of_one_capture', async () => {
    const agent = runningAgent(false);
    await take(agent);
    const shots = events(agent).filter((e) => e.type === 'screenshot.captured');
    expect(shots.map((e) => e.display_index)).toEqual([0, 1, 2]);
    expect(new Set(shots.map((e) => e.captured_at)).size).toBe(1);
    expect(shots.every((e) => e.session_id === 'session-1' && e.blurred === false)).toBe(true);
    // Each screen asked for its own upload, and its picture and thumbnail were sent.
    const intents = requests.filter((r) => r.path === '/agent/screenshots/upload-intent');
    expect(intents.map((r) => r.body!.screenshot_id)).toEqual(shots.map((e) => e.screenshot_id));
    expect(shots.map((e) => e.storage_key)).toEqual(intents.map((r) => `shots/${r.body!.screenshot_id}.jpg`));
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(6);
  });

  it('should_mark_all_three_as_blurred_when_the_policy_blurs', async () => {
    const agent = runningAgent(true);
    await take(agent);
    expect(events(agent).filter((e) => e.type === 'screenshot.captured').map((e) => e.blurred)).toEqual([true, true, true]);
  });

  it.each([
    ['paused', 'paused'],
    ['not running', null],
  ] as const)('should_take_nothing_while_the_timer_is_%s', async (_name, state) => {
    const agent = runningAgent(false, state);
    await take(agent);
    expect(log.requested).toEqual([]);
    expect(requests).toEqual([]);
    expect(events(agent)).toEqual([]);
  });
});
