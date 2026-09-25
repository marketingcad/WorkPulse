import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ desktopCapturer: {}, nativeImage: {}, screen: {} }));
const { browserFromExe, bridgeRequestAllowed, extensionVerdict, EXTENSION_FRESH_MS, EXTENSION_IDS, ExtensionBridge, normalizeAddressBarText, parseReport } = await import('../src/main/services/urls');
const { AppTracker } = await import('../src/main/services/monitors');
const { DEFAULT_POLICY, mergePolicy } = await import('@tallywork/domain');

const EXT = `chrome-extension://${EXTENSION_IDS[0]}`;

describe('browser detection', () => {
  it('maps browser executables (any case, full path) and ignores other apps', () => {
    expect(browserFromExe(String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`)).toBe('chrome');
    expect(browserFromExe('C:/Program Files (x86)/Microsoft/Edge/Application/MSEDGE.EXE')).toBe('edge');
    expect(browserFromExe('brave.exe')).toBe('brave');
    expect(browserFromExe(String.raw`C:\Windows\explorer.exe`)).toBeNull();
    expect(browserFromExe(null)).toBeNull();
  });
});

describe('address bar text', () => {
  it('adds https:// to the host-only form browsers display', () => {
    expect(normalizeAddressBarText('github.com/anthropics/claude-code')).toBe('https://github.com/anthropics/claude-code');
    expect(normalizeAddressBarText('localhost:3000/o/1')).toBe('https://localhost:3000/o/1');
    expect(normalizeAddressBarText('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1');
  });
  it('rejects search terms and free text', () => {
    expect(normalizeAddressBarText('how to center a div')).toBeNull();
    expect(normalizeAddressBarText('tallywork')).toBeNull();
    expect(normalizeAddressBarText('')).toBeNull();
    expect(normalizeAddressBarText(null)).toBeNull();
  });
});

describe('extension reports', () => {
  it('accepts well-formed reports and drops non-web URLs', () => {
    expect(parseReport({ browser: 'edge', focused: true, url: 'https://example.com/x' }, 5)).toEqual({ browser: 'edge', focused: true, url: 'https://example.com/x', at: 5 });
    expect(parseReport({ browser: 'chrome', focused: true, url: 'chrome://settings' }, 5)?.url).toBeNull();
    expect(parseReport({ browser: 'netscape', focused: true, url: null }, 5)).toBeNull();
    expect(parseReport({ browser: 'chrome', url: 'https://a.com' }, 5)).toBeNull();
    expect(parseReport('nope', 5)).toBeNull();
  });

  it('a fresh report decides; "not focused" means record nothing (no address-bar fallback)', () => {
    const now = 1_000_000;
    expect(extensionVerdict({ browser: 'chrome', focused: true, url: 'https://a.com', at: now - 1000 }, now)).toEqual({ decided: true, url: 'https://a.com' });
    expect(extensionVerdict({ browser: 'chrome', focused: false, url: 'https://a.com', at: now - 1000 }, now)).toEqual({ decided: true, url: null });
    expect(extensionVerdict({ browser: 'chrome', focused: true, url: 'https://a.com', at: now - EXTENSION_FRESH_MS - 1 }, now)).toEqual({ decided: false });
    expect(extensionVerdict(undefined, now)).toEqual({ decided: false });
  });
});

describe('bridge access control', () => {
  it('only our extension, only on the loopback host we bound', () => {
    expect(bridgeRequestAllowed({ origin: EXT, host: '127.0.0.1:47816' }, 47816)).toBe(true);
    expect(bridgeRequestAllowed({ origin: 'https://evil.example', host: '127.0.0.1:47816' }, 47816)).toBe(false);
    expect(bridgeRequestAllowed({ origin: `chrome-extension://${'a'.repeat(32)}`, host: '127.0.0.1:47816' }, 47816)).toBe(false);
    expect(bridgeRequestAllowed({ origin: undefined, host: '127.0.0.1:47816' }, 47816)).toBe(false);
    // DNS rebinding: a web page resolving evil.example to 127.0.0.1 sends Host: evil.example
    expect(bridgeRequestAllowed({ origin: EXT, host: 'evil.example:47816' }, 47816)).toBe(false);
  });
});

describe('extension bridge server', () => {
  let bridge: InstanceType<typeof ExtensionBridge> | null = null;
  afterEach(() => bridge?.stop());

  it('stores reports from the extension and rejects everyone else', async () => {
    bridge = new ExtensionBridge(() => ({ tracking: true, urlsEnabled: true, mode: 'domain' }));
    await bridge.start();
    expect(bridge.port).not.toBeNull();
    const url = `http://127.0.0.1:${bridge.port}`;

    // fetch() won't let us set Origin, so talk raw HTTP like the browser does.
    const { request } = await import('node:http');
    const call = (path: string, origin: string | null, body?: unknown) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => {
        const req = request(`${url}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' } }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode!, json: data ? JSON.parse(data) : null }));
        });
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
      });

    const ok = await call('/v1/tab', EXT, { browser: 'chrome', focused: true, url: 'https://github.com/x' });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ app: 'tallywork', tracking: true, urls_enabled: true, mode: 'domain' });
    expect(bridge.report('chrome')).toMatchObject({ focused: true, url: 'https://github.com/x' });
    expect(bridge.connectedBrowsers()).toEqual(['chrome']);

    expect((await call('/v1/status', EXT)).status).toBe(200);
    expect((await call('/v1/tab', 'https://evil.example', { browser: 'chrome', focused: true, url: 'https://phish.example' })).status).toBe(403);
    expect((await call('/v1/tab', null, { browser: 'chrome', focused: true, url: 'https://phish.example' })).status).toBe(403);
    expect((await call('/v1/tab', EXT, { browser: 'chrome' })).status).toBe(400);
    expect(bridge.report('chrome')?.url).toBe('https://github.com/x');
  });
});

describe('AppTracker URL spans on Windows-style foreground windows (no URL from the OS)', () => {
  it('uses the resolver, then trims to the domain on the device', async () => {
    vi.useFakeTimers();
    const policy = mergePolicy(DEFAULT_POLICY, { urls: { enabled: true, mode: 'domain', excludedDomains: ['bank.example'] } });
    const urls = ['https://github.com/anthropics/claude-code?tab=readme', 'https://www.bank.example/accounts', null];
    let i = 0;
    const resolver = { available: true, resolve: vi.fn(async () => (urls[i] ? { url: urls[i]! } : null)) };
    const t = new AppTracker(() => policy, resolver);
    expect(t.urlsAvailable).toBe(true);
    (t as any).activeWindow = async () => ({ owner: { name: 'Google Chrome', path: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe` } });
    (t as any).available = true;

    vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
    await (t as any).sample(); // github (tracked)
    vi.setSystemTime(new Date('2026-09-25T10:00:30Z'));
    i = 1;
    await (t as any).sample(); // excluded domain → no URL
    vi.setSystemTime(new Date('2026-09-25T10:01:00Z'));
    i = 2;
    await (t as any).sample(); // nothing to record
    vi.setSystemTime(new Date('2026-09-25T10:01:10Z'));
    const { urls: spans, apps } = t.drain();
    vi.useRealTimers();

    expect(resolver.resolve).toHaveBeenCalledWith(String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ domain: 'github.com', url: null, browser: 'Google Chrome', started_at: '2026-09-25T10:00:00.000Z', ended_at: '2026-09-25T10:00:30.000Z' });
    expect(apps.map((a) => a.app_name)).toEqual(['Google Chrome', 'Google Chrome']);
  });

  it('never asks for a URL when URL tracking is off', async () => {
    const resolver = { available: true, resolve: vi.fn(async () => ({ url: 'https://a.com' })) };
    const t = new AppTracker(() => DEFAULT_POLICY, resolver);
    (t as any).activeWindow = async () => ({ owner: { name: 'Google Chrome', path: 'chrome.exe' } });
    await (t as any).sample();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
