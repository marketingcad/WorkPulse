import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BRIDGE_PORTS, EXTENSION_IDS } from '../src/main/services/urls';

/**
 * The browser extension (apps/extension): plain Manifest V3 JavaScript with no build, so it is tested
 * here, next to the desktop side of the bridge it talks to (urls.test.ts). The real files run in a
 * sandbox with fakes for the browser APIs. What it must never do: report anything but the active
 * tab of a focused, normal, non-private window; report a page that is not http(s); talk to anything
 * but the desktop app on 127.0.0.1; or ask for more browser permissions than it needs.
 */
const dir = path.resolve(__dirname, '../../extension');
const source = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const manifest = JSON.parse(source('manifest.json'));
const portsIn = (code: string) => JSON.parse(/const PORTS = (\[[^\]]*\])/.exec(code)![1]!) as number[];

/** Chrome's extension ID: the first 32 hex characters of sha256(public key), mapped 0-f → a-p. */
const extensionId = (keyBase64: string) =>
  createHash('sha256')
    .update(Buffer.from(keyBase64, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

describe('manifest and bridge', () => {
  it('asks only for tabs and alarms, reaches only 127.0.0.1, and never runs in private windows', () => {
    expect(manifest.manifest_version).toBe(3);
    expect([...manifest.permissions].sort()).toEqual(['alarms', 'tabs']);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(manifest.incognito).toBe('not_allowed');
    expect(manifest.content_scripts).toBeUndefined(); // it never reads page contents
  });

  it('has the fixed ID the desktop app accepts, and uses the desktop app’s ports', () => {
    expect(EXTENSION_IDS).toContain(extensionId(manifest.key));
    expect(portsIn(source('background.js'))).toEqual([...BRIDGE_PORTS]);
    expect(portsIn(source('popup.js'))).toEqual([...BRIDGE_PORTS]);
  });
});

// ─── background.js ───────────────────────────────────────────────────────────

type Win = { id: number; focused: boolean; type: string; incognito: boolean } | null;
function loadBackground(opts: { win: Win; tabUrl?: string; listening?: number[]; brands?: string[] }) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const listeners: Record<string, (...a: unknown[]) => void> = {};
  const alarms: Array<{ name: string; info: unknown }> = [];
  const state = { ...opts, listening: opts.listening ?? [47816] };
  const on = (name: string) => ({ addListener: (fn: (...a: unknown[]) => void) => (listeners[name] = fn) });
  const chrome = {
    windows: { getLastFocused: async () => state.win, onFocusChanged: on('focus') },
    tabs: { query: async () => (state.tabUrl === undefined ? [] : [{ url: state.tabUrl }]), onActivated: on('activated'), onUpdated: on('updated') },
    alarms: { get: (_n: string, cb: (a: unknown) => void) => cb(undefined), create: (name: string, info: unknown) => alarms.push({ name, info }), onAlarm: on('alarm') },
    runtime: { onInstalled: on('installed'), onStartup: on('startup') },
  };
  const fetch = async (url: string, init: { body: string }) => {
    const port = Number(new URL(url).port);
    if (!state.listening.includes(port)) throw new TypeError('connection refused');
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const navigator = { userAgentData: { brands: (opts.brands ?? ['Google Chrome']).map((brand) => ({ brand })) } };
  vm.runInNewContext(source('background.js'), { chrome, fetch, navigator, URL, JSON, console });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fire = async (name: string, ...args: unknown[]) => {
    listeners[name]!(...args);
    for (let i = 0; i < 5; i++) await flush();
  };
  return { sent, alarms, state, fire };
}
const NORMAL: Win = { id: 1, focused: true, type: 'normal', incognito: false };

describe('background: what is reported', () => {
  it('should_report_the_active_tab_of_a_focused_window_to_the_desktop_app_on_127_0_0_1', async () => {
    const ext = loadBackground({ win: NORMAL, tabUrl: 'https://github.com/marketingcad/WorkPulse/pulls?q=open' });
    await ext.fire('activated');
    expect(ext.sent).toEqual([{ url: 'http://127.0.0.1:47816/v1/tab', body: { browser: 'chrome', focused: true, url: 'https://github.com/marketingcad/WorkPulse/pulls?q=open' } }]);
  });

  it.each(['chrome://settings', 'file:///C:/secret.txt', 'chrome-extension://abc/popup.html', 'about:blank'])('should_never_report_a_page_that_is_not_http_or_https: %s', async (tabUrl) => {
    const ext = loadBackground({ win: NORMAL, tabUrl });
    await ext.fire('activated');
    expect(ext.sent[0]!.body).toEqual({ browser: 'chrome', focused: true, url: null });
  });

  it.each([
    ['a private (incognito) window', { ...NORMAL!, incognito: true }],
    ['an unfocused window', { ...NORMAL!, focused: false }],
    ['a popup or DevTools window', { ...NORMAL!, type: 'devtools' }],
    ['no window at all', null],
  ] as const)('should_report_nothing_but_not_focused_for_%s', async (_name, win) => {
    const ext = loadBackground({ win, tabUrl: 'https://bank.example/account' });
    await ext.fire('focus');
    expect(ext.sent[0]!.body).toEqual({ browser: 'chrome', focused: false, url: null });
    expect(JSON.stringify(ext.sent)).not.toContain('bank.example');
  });

  it('should_name_the_browser_from_its_brand', async () => {
    const ext = loadBackground({ win: NORMAL, tabUrl: 'https://example.com/', brands: ['Microsoft Edge', 'Chromium'] });
    await ext.fire('activated');
    expect(ext.sent[0]!.body.browser).toBe('edge');
  });
});

describe('background: when it reports', () => {
  it('should_send_an_unchanged_tab_once_but_resend_it_on_the_30_second_heartbeat', async () => {
    const ext = loadBackground({ win: NORMAL, tabUrl: 'https://example.com/' });
    await ext.fire('installed');
    expect(ext.alarms).toEqual([{ name: 'tallywork-heartbeat', info: { periodInMinutes: 0.5 } }]);
    await ext.fire('activated');
    await ext.fire('updated', 1, { status: 'complete' }, { active: true });
    expect(ext.sent).toHaveLength(1); // installed sent it; the same state is not sent again
    await ext.fire('alarm', { name: 'tallywork-heartbeat' });
    expect(ext.sent).toHaveLength(2);
    ext.state.tabUrl = 'https://example.org/';
    await ext.fire('activated');
    expect(ext.sent.at(-1)!.body.url).toBe('https://example.org/');
  });

  it('should_ignore_updates_to_background_tabs', async () => {
    const ext = loadBackground({ win: NORMAL, tabUrl: 'https://example.com/' });
    await ext.fire('updated', 7, { url: 'https://other.example/' }, { active: false });
    expect(ext.sent).toEqual([]);
  });

  it('should_find_the_desktop_app_on_any_of_its_ports_and_try_again_after_it_stops', async () => {
    const ext = loadBackground({ win: NORMAL, tabUrl: 'https://example.com/', listening: [47818] });
    await ext.fire('activated');
    expect(ext.sent.map((s) => s.url)).toEqual(['http://127.0.0.1:47818/v1/tab']);
    // The app quits: nothing is delivered, and the next change is tried again on every port.
    ext.state.listening = [];
    ext.state.tabUrl = 'https://example.org/';
    await ext.fire('activated');
    ext.state.listening = [47816];
    await ext.fire('activated');
    expect(ext.sent.map((s) => s.url)).toEqual(['http://127.0.0.1:47818/v1/tab', 'http://127.0.0.1:47816/v1/tab']);
    expect(ext.sent.every((s) => s.url.startsWith('http://127.0.0.1:'))).toBe(true);
  });
});

// ─── popup.js ────────────────────────────────────────────────────────────────

async function runPopup(status: Record<string, unknown> | null) {
  const els: Record<string, { className: string; textContent: string }> = {};
  const document = { getElementById: (id: string) => (els[id] ??= { className: '', textContent: '' }) };
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    if (!status) throw new TypeError('connection refused');
    return { ok: true, json: async () => status };
  };
  vm.runInNewContext(source('popup.js'), { document, fetch, console });
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return { text: (id: string) => els[`${id}-text`]?.textContent, cls: (id: string) => els[id]?.className, asked };
}

describe('popup: what the person is told', () => {
  it('says when the desktop app is not running, and that nothing is recorded', async () => {
    const p = await runPopup(null);
    expect(p.text('app')).toBe('The Tallywork desktop app is not running on this computer.');
    expect(p.text('rec')).toBe('Nothing is recorded.');
    expect(p.asked.every((u) => u.startsWith('http://127.0.0.1:'))).toBe(true);
  });

  it.each([
    [{ urls_enabled: false, tracking: true, mode: 'full' }, 'Your organization does not record websites.'],
    [{ urls_enabled: true, tracking: false, mode: 'full' }, 'Timer is not running — nothing is recorded.'],
    [{ urls_enabled: true, tracking: true, mode: 'domain' }, 'Timer running — the website domain is recorded (e.g. github.com).'],
    [{ urls_enabled: true, tracking: true, mode: 'full' }, 'Timer running — the website address is recorded (without query strings).'],
  ])('when connected with %j it says: %s', async (status, says) => {
    const p = await runPopup(status);
    expect(p.text('app')).toBe('Connected to the Tallywork desktop app.');
    expect(p.text('rec')).toBe(says);
  });
});
