import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createInterface } from 'node:readline';

/**
 * Where the active browser tab's URL comes from on Windows (macOS gets it from get-windows):
 *  1. The Tallywork browser extension (apps/extension) reports the active tab over a local HTTP bridge.
 *  2. Fallback: read the browser's address bar through Windows UI Automation.
 * While the extension is reporting for a browser it is authoritative — including "the focused
 * window is one I can't see" (incognito, devtools), in which case nothing is recorded and the
 * address-bar fallback is NOT used. Domain-only / excluded-domain policy is applied by the caller
 * (applyUrlPolicy) before anything is stored.
 */

/** The bridge listens on the first free port; the extension tries them in the same order. Keep in sync with apps/extension/background.js. */
export const BRIDGE_PORTS = [47816, 47817, 47818] as const;

/** Extension IDs allowed to talk to the bridge (fixed by the `key` in apps/extension/manifest.json). Store-published IDs can be added via TALLYWORK_EXTENSION_IDS. */
export const EXTENSION_IDS: readonly string[] = ['pmgcginlglleofaohoddeemkibphkcij', ...(process.env.TALLYWORK_EXTENSION_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];

/** An extension report older than this no longer counts (it re-reports on every change and every 30s). */
export const EXTENSION_FRESH_MS = 75_000;

export type BrowserKey = 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'firefox';

const BROWSER_EXES: Record<string, BrowserKey> = {
  'chrome.exe': 'chrome',
  'msedge.exe': 'edge',
  'brave.exe': 'brave',
  'vivaldi.exe': 'vivaldi',
  'opera.exe': 'opera',
  'firefox.exe': 'firefox',
};

export const BROWSER_NAMES: Record<BrowserKey, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera', firefox: 'Firefox' };

/** Which browser (if any) an executable path or file name belongs to. */
export function browserFromExe(exe: string | null | undefined): BrowserKey | null {
  if (!exe) return null;
  const file = exe.split(/[\\/]/).pop()!.toLowerCase();
  return BROWSER_EXES[file] ?? null;
}

/**
 * Turn address-bar text into a URL, or null when it isn't one. Browsers hide the scheme
 * ("github.com/org/repo"), so a host-looking value gets https://. Search terms and other
 * free text (spaces, no dot) are rejected.
 */
export function normalizeAddressBarText(text: string | null | undefined): string | null {
  const v = (text ?? '').trim();
  if (!v || /\s/.test(v) || v.length > 2048) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  if (/^(localhost|[^\s/:]+\.[^\s/:]+)(:\d+)?(\/|$|\?|#)/i.test(v)) return `https://${v}`;
  return null;
}

// ─── Extension bridge ────────────────────────────────────────────────────────

export interface ExtensionReport {
  browser: BrowserKey;
  /** a normal browser window the extension can see has focus */
  focused: boolean;
  /** the active tab's URL (null for non-web pages such as the new-tab page) */
  url: string | null;
  at: number;
}

/** Validate a report body from the extension; returns null for anything malformed. */
export function parseReport(body: unknown, now: number): ExtensionReport | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const browser = typeof b.browser === 'string' && (Object.values(BROWSER_EXES) as string[]).includes(b.browser) ? (b.browser as BrowserKey) : null;
  if (!browser || typeof b.focused !== 'boolean') return null;
  const url = typeof b.url === 'string' && b.url.length <= 2048 && /^https?:\/\//i.test(b.url) ? b.url : null;
  return { browser, focused: b.focused, url, at: now };
}

/**
 * Only our extension may use the bridge: its Origin must be chrome-extension://<allowed id>
 * (web pages cannot forge Origin), and the Host must be the loopback address we bound
 * (defeats DNS-rebinding attacks from web pages).
 */
export function bridgeRequestAllowed(req: { origin?: string | undefined; host?: string | undefined }, port: number, ids: readonly string[] = EXTENSION_IDS): boolean {
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(req.origin ?? '');
  if (!m || !ids.includes(m[1]!)) return false;
  return req.host === `127.0.0.1:${port}`;
}

/** What the extension (when fresh) says about this browser: a URL, "record nothing", or no opinion. */
export function extensionVerdict(report: ExtensionReport | undefined, now: number): { decided: true; url: string | null } | { decided: false } {
  if (!report || now - report.at > EXTENSION_FRESH_MS) return { decided: false };
  return { decided: true, url: report.focused ? report.url : null };
}

export interface BridgeStatus {
  tracking: boolean;
  urlsEnabled: boolean;
  mode: 'domain' | 'full';
}

/** Local HTTP bridge for the browser extension. Binds 127.0.0.1 only. */
export class ExtensionBridge {
  private server: Server | null = null;
  private readonly reports = new Map<BrowserKey, ExtensionReport>();
  port: number | null = null;

  constructor(private readonly status: () => BridgeStatus) {}

  async start(): Promise<void> {
    for (const port of BRIDGE_PORTS) {
      const server = createServer((req, res) => void this.handle(req, res, port));
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (ok) {
        this.server = server;
        this.port = port;
        return;
      }
    }
    console.warn('[urls] extension bridge: no free port, browser extension disabled');
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = null;
  }

  /** The latest report for a browser (fresh or not). */
  report(browser: BrowserKey): ExtensionReport | undefined {
    return this.reports.get(browser);
  }

  /** Browsers whose extension reported recently (shown in the agent's transparency panel). */
  connectedBrowsers(now = Date.now()): BrowserKey[] {
    return [...this.reports.values()].filter((r) => now - r.at <= EXTENSION_FRESH_MS).map((r) => r.browser);
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse, port: number): Promise<void> {
    const send = (code: number, body?: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (!bridgeRequestAllowed({ origin: req.headers.origin, host: req.headers.host }, port)) return send(403, { error: 'forbidden' });
    const s = this.status();
    const summary = { app: 'tallywork', tracking: s.tracking, urls_enabled: s.urlsEnabled, mode: s.mode };
    if (req.method === 'GET' && req.url === '/v1/status') return send(200, summary);
    if (req.method !== 'POST' || req.url !== '/v1/tab') return send(404, { error: 'not_found' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8192) return send(413, { error: 'too_large' });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: 'invalid_json' });
    }
    const report = parseReport(body, Date.now());
    if (!report) return send(400, { error: 'invalid_report' });
    this.reports.set(report.browser, report);
    send(200, summary);
  }
}

// ─── Address bar (Windows UI Automation) ────────────────────────────────────

/**
 * Long-lived PowerShell helper: for each line on stdin it reads the address bar of the
 * foreground window (the first Edit control in the window's UI Automation tree, which
 * is the toolbar's address bar in Chromium browsers and Firefox) and prints one JSON line.
 * `typing` is true while the address bar has keyboard focus (the text is not a visited URL yet).
 */
const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TwFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$A = [System.Windows.Automation.AutomationElement]
$edit = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $root = $A::FromHandle([TwFg]::GetForegroundWindow())
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $edit)
    $value = $null; $typing = $false
    if ($null -ne $el) {
      $vp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $value = $vp.Current.Value }
      $typing = $el.Current.HasKeyboardFocus
    }
    [Console]::Out.WriteLine((@{ id = $line; value = $value; typing = $typing } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $line; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
`;

const UIA_TIMEOUT_MS = 2_000;
const UIA_MAX_RESTARTS = 3;

export class AddressBarReader {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<boolean> | null = null;
  private readonly pending = new Map<string, (r: { value: string | null; typing: boolean } | null) => void>();
  private seq = 0;
  private restarts = 0;
  readonly available = process.platform === 'win32';

  private boot(): Promise<boolean> {
    if (!this.available || this.restarts > UIA_MAX_RESTARTS) return Promise.resolve(false);
    this.ready ??= new Promise<boolean>((resolve) => {
      const encoded = Buffer.from(UIA_SCRIPT, 'utf16le').toString('base64');
      const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
      this.proc = proc;
      const timer = setTimeout(() => resolve(false), 15_000);
      createInterface({ input: proc.stdout }).on('line', (line) => {
        let msg: { ready?: boolean; id?: string; value?: string | null; typing?: boolean; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) {
          clearTimeout(timer);
          resolve(true);
          return;
        }
        const done = msg.id ? this.pending.get(msg.id) : undefined;
        if (!done) return;
        this.pending.delete(msg.id!);
        done(msg.error ? null : { value: msg.value ?? null, typing: msg.typing === true });
      });
      proc.on('exit', () => {
        clearTimeout(timer);
        resolve(false);
        this.proc = null;
        this.ready = null;
        this.restarts++;
        for (const done of this.pending.values()) done(null);
        this.pending.clear();
      });
      proc.on('error', () => undefined);
    });
    return this.ready;
  }

  /** Read the foreground window's address bar. Null when unavailable, unreadable, or the user is typing in it. */
  async read(): Promise<string | null> {
    if (!(await this.boot()) || !this.proc) return null;
    const id = String(++this.seq);
    const result = await new Promise<{ value: string | null; typing: boolean } | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, UIA_TIMEOUT_MS);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.proc!.stdin.write(`${id}\n`);
    });
    if (!result || result.typing) return null;
    return normalizeAddressBarText(result.value);
  }

  stop(): void {
    this.restarts = UIA_MAX_RESTARTS + 1; // no restart after an intentional stop
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}

// ─── Resolver ────────────────────────────────────────────────────────────────

export type UrlSource = 'extension' | 'address_bar';

/** Resolves the active tab URL of the foreground browser (Windows). */
export class UrlResolver {
  readonly bridge: ExtensionBridge;
  readonly addressBar = new AddressBarReader();
  lastSource: UrlSource | null = null;

  constructor(status: () => BridgeStatus) {
    this.bridge = new ExtensionBridge(status);
  }

  get available(): boolean {
    return process.platform === 'win32';
  }

  async start(): Promise<void> {
    if (this.available) await this.bridge.start();
  }

  stop(): void {
    this.bridge.stop();
    this.addressBar.stop();
  }

  /** URL for the foreground window, given its executable. Null when it isn't a browser or nothing may be recorded. */
  async resolve(exe: string | null | undefined): Promise<{ url: string; browser: string; source: UrlSource } | null> {
    const browser = browserFromExe(exe);
    if (!browser) return null;
    const verdict = extensionVerdict(this.bridge.report(browser), Date.now());
    if (verdict.decided) {
      this.lastSource = 'extension';
      return verdict.url ? { url: verdict.url, browser: BROWSER_NAMES[browser], source: 'extension' } : null;
    }
    const url = await this.addressBar.read();
    this.lastSource = 'address_bar';
    return url ? { url, browser: BROWSER_NAMES[browser], source: 'address_bar' } : null;
  }
}
