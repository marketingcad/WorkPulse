import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC, type IpcChannel, type IpcPayload } from '../shared/ipc';
import { Agent } from './services/agent';
import { readManagedConfig } from './services/managed-config';
import { loadAutoUpdater } from './services/updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER = process.env.TALLYWORK_SERVER ?? (app.isPackaged ? 'https://tallywork-alpha.vercel.app' : 'http://localhost:3000');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: Agent;
let quitting = false;

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function rendererUrl(): string {
  return process.env.ELECTRON_RENDERER_URL ?? `file://${path.join(__dirname, '../renderer/index.html')}`;
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    // Opens as a dashboard; the layout collapses to a compact timer when the window is made narrow.
    width: 1120,
    height: 760,
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: 'WorkPulse',
    backgroundColor: '#0f2240',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  w.once('ready-to-show', () => w.show());
  // Never navigate away from the app or open windows inside it.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault();
  });
  w.on('close', (e) => {
    // Closing the window keeps tracking running in the tray (transparent: tray shows state).
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  void w.loadURL(rendererUrl());
  return w;
}

function showWindow(): void {
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayIcon(state: 'stopped' | 'active' | 'paused'): Electron.NativeImage {
  const color = state === 'active' ? '#3fb27f' : state === 'paused' ? '#e3a33b' : '#93a3bd';
  // Brand mark (packages/ui/src/logo.tsx) with a status dot: green tracking, amber paused, grey stopped.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><clipPath id="i"><path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z"/></clipPath></defs><path d="M32 5.5 55 18.75v26.5L32 58.5 9 45.25v-26.5Z" fill="#1766FF" stroke="#1766FF" stroke-width="7" stroke-linejoin="round"/><path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z" fill="#0B2A66" stroke="#0B2A66" stroke-width="4" stroke-linejoin="round"/><path d="M9 41 22.5 26.5 32.5 41.5 41.5 28.5 56 37" fill="none" stroke="#fff" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#i)"/><circle cx="50" cy="50" r="11" fill="${color}" stroke="#0B2A66" stroke-width="4"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 });
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

let lastTrayKey = '';
function updateTray(): void {
  if (!tray) return;
  const st = agent.state();
  const running = st.tracking.segmentStartedAt ? (Date.now() - Date.parse(st.tracking.segmentStartedAt)) / 1000 : 0;
  const elapsed = st.tracking.baseSeconds + running;
  const project = st.assignments.find((a) => a.project_id === st.tracking.projectId)?.project_name;
  const label = st.tracking.state === 'stopped' ? 'Not clocked in' : `${st.tracking.state === 'paused' ? 'On break' : 'Clocked in'} · ${fmt(elapsed)}${project ? ` · ${project}` : ''}`;
  const key = `${st.tracking.state}|${label}|${st.phase}`;
  if (process.platform === 'darwin') tray.setTitle(st.tracking.state === 'stopped' ? '' : fmt(elapsed));
  tray.setToolTip(`WorkPulse — ${label}`);
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setImage(trayIcon(st.tracking.state));
  const last = st.lastProject ? st.assignments.find((a) => a.project_id === st.lastProject!.projectId) : undefined;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      st.tracking.state === 'stopped'
        ? { label: last ? `Clock in to “${last.project_name}”` : 'Clock in…', enabled: st.phase === 'ready', click: () => (last ? void agent.start(last.project_id, st.lastProject!.taskId).catch(() => showWindow()) : showWindow()) }
        : // The window asks for the end-of-day report before clocking out.
          { label: 'Clock out…', click: () => (showWindow(), win?.webContents.send('app:navigate', 'clockout')) },
      { label: 'Open WorkPulse', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => quit() },
    ]),
  );
}

async function quit(): Promise<void> {
  // Stop tracking and flush before exiting so no time is lost.
  quitting = true;
  if (agent.state().tracking.state !== 'stopped') await agent.stop();
  await agent.sync().catch(() => undefined);
  agent.dispose();
  app.quit();
}

/**
 * Fetch an own pay stub's PDF in main (the token never reaches the window), let the person
 * choose where to keep it, then open it in their PDF viewer. Nothing is written without that choice.
 */
async function savePayStub(id: string): Promise<{ saved: boolean }> {
  const { data, filename } = await agent.api.download(`/agent/me/pay-stubs/${id}/pdf`);
  const name = filename && /^pay-stub-\d{4}-\d{2}-\d{2}\.pdf$/.test(filename) ? filename : 'pay-stub.pdf';
  const opts = { title: 'Save pay stub', defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return { saved: false };
  await writeFile(r.filePath, data);
  void shell.openPath(r.filePath);
  return { saved: true };
}

/** Strict IPC: only known channels, only from our own renderer, validated payloads. */
function registerIpc(): void {
  const handlers: { [C in IpcChannel]: (payload: never) => unknown } = {
    'state:get': () => agent.state(),
    'auth:login': (p: { serverUrl?: string }) => agent.login(p.serverUrl),
    'auth:loginPassword': (p: IpcPayload<'auth:loginPassword'>) => agent.loginWithPassword(p),
    'auth:logout': () => agent.logout(),
    'timer:start': (p: { projectId: string; taskId: string | null }) => agent.start(p.projectId, p.taskId),
    'timer:stop': (p?: IpcPayload<'timer:stop'>) => agent.stop(new Date(), p?.report),
    'timer:pause': () => agent.pause('MANUAL'),
    'timer:resume': () => agent.resume(),
    'timer:break': (p: IpcPayload<'timer:break'>) => agent.takeBreak(p.breakTypeId, p.minutes ?? null),
    'timer:switch': (p: { projectId: string; taskId: string | null }) => agent.start(p.projectId, p.taskId),
    'notes:set': (p: { note: string }) => agent.setNote(p.note),
    'idle:resolve': (p: { choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED'; projectId?: string; taskId?: string | null }) => agent.resolveIdle(p.choice, p.projectId, p.taskId),
    'recovery:resolve': (p: { resume: boolean }) => agent.resolveRecovery(p.resume),
    'manualTime:request': (p: IpcPayload<'manualTime:request'>) => agent.requestManualTime(p),
    'me:get': (p: IpcPayload<'me:get'>) => {
      const q = new URLSearchParams();
      for (const k of ['from', 'to', 'date'] as const) if (p[k]) q.set(k, p[k]!);
      return agent.api.request('GET', `/agent/me/${p.resource}${q.size ? `?${q}` : ''}`);
    },
    'me:submitTimesheet': (p: IpcPayload<'me:submitTimesheet'>) => agent.api.request('POST', '/agent/me/timesheet/submit', p).then(async (r) => (await agent.refreshBootstrap(), r)),
    'me:requestTimeOff': (p: IpcPayload<'me:requestTimeOff'>) => agent.api.request('POST', '/agent/me/time-off', p),
    'me:readNotifications': (p: IpcPayload<'me:readNotifications'>) => agent.api.request('POST', '/agent/me/notifications/read', p),
    'me:savePayStub': (p: IpcPayload<'me:savePayStub'>) => savePayStub(p.id),
    'app:quit': () => quit(),
  };
  for (const channel of Object.keys(IPC) as IpcChannel[]) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const origin = event.senderFrame?.url ?? '';
      if (!win || event.sender !== win.webContents || !(origin.startsWith('file://') || (process.env.ELECTRON_RENDERER_URL && origin.startsWith(process.env.ELECTRON_RENDERER_URL)))) {
        throw new Error('Rejected IPC from unexpected sender');
      }
      const schema = IPC[channel];
      const parsed = schema.safeParse(payload ?? undefined);
      if (!parsed.success) throw new Error(`Invalid payload for ${channel}`);
      try {
        return await handlers[channel](parsed.data as never);
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : 'Action failed');
      }
    });
  }
}

/**
 * Updates come from the GitHub Releases feed baked in at build time (electron-builder.yml `publish`),
 * or from TALLYWORK_UPDATE_URL when set (a self-hosted mirror). Rollouts are staged two ways: the channel
 * (TALLYWORK_UPDATE_CHANNEL = beta | latest; beta machines get releases first) and electron-updater's
 * stagingPercentage in latest.yml, which offers a release to a growing share of machines
 * (docs/ops/runbooks.md, "Desktop release").
 */
async function setupUpdater(managedChannel?: 'latest' | 'beta'): Promise<void> {
  if (!app.isPackaged) return;
  const autoUpdater = await loadAutoUpdater();
  // Failures were silent before, which hid that no update check ever ran (up to 0.1.5).
  autoUpdater.logger = { info: (m: unknown) => console.log('[updater]', m), warn: (m: unknown) => console.warn('[updater]', m), error: (m: unknown) => console.error('[updater]', m) };
  if (process.env.TALLYWORK_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TALLYWORK_UPDATE_URL });
  const channel = managedChannel ?? (process.env.TALLYWORK_UPDATE_CHANNEL === 'beta' ? 'beta' : 'latest');
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.platform === 'darwin') {
    // The Mac build is not code-signed yet, and macOS only installs updates into signed apps.
    // Instead of downloading and failing, tell the person once per version and open the download page.
    autoUpdater.autoDownload = false;
    let offered: string | null = null;
    autoUpdater.on('update-available', (info) => {
      if (offered === info.version || !Notification.isSupported()) return;
      offered = info.version;
      const n = new Notification({ title: `WorkPulse ${info.version} is available`, body: 'Click to download the new version. Your tracked time is kept.' });
      n.on('click', () => void shell.openExternal(`${agent.state().serverUrl}/download`));
      n.show();
    });
  } else {
    // Downloaded in the background; it installs when the app quits, so tell the person once.
    let announced: string | null = null;
    autoUpdater.on('update-downloaded', (info) => {
      if (announced === info.version || !Notification.isSupported()) return;
      announced = info.version;
      new Notification({ title: `WorkPulse ${info.version} is ready`, body: 'It installs the next time you quit WorkPulse from the tray. Your tracked time is kept.' }).show();
    });
  }
  // Never interrupt an active session: download in the background, install on quit.
  const check = () => void autoUpdater.checkForUpdates().catch((e: unknown) => console.error('[updater] check failed:', e instanceof Error ? e.message : e));
  check();
  setInterval(check, 6 * 3600_000);
}

// Crash reports (for the crash-free-rate SLO) go to TALLYWORK_CRASH_URL when set; minidumps only, no screen contents.
if (process.env.TALLYWORK_CRASH_URL) crashReporter.start({ submitURL: process.env.TALLYWORK_CRASH_URL, uploadToServer: true, compress: true, ignoreSystemCrashHandler: true });

/** Linux desktops without a Secret Service keyring cannot keep the sign-in encrypted, and we never store it in plain text. */
function explainMissingKeyring(): void {
  dialog.showMessageBoxSync({
    type: 'error',
    title: 'WorkPulse',
    message: 'WorkPulse needs your desktop keyring',
    detail:
      'WorkPulse keeps your sign-in encrypted with the system keyring, and none is available.\n\n' +
      'Install and start one, then open WorkPulse again:\n' +
      '• GNOME, XFCE, Cinnamon, MATE and most others: sudo apt install gnome-keyring, then sign out and back in\n' +
      '• KDE Plasma: enable KDE Wallet in System Settings',
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('app.tallywork.desktop');
  if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
    explainMissingKeyring();
    app.exit(1);
    return;
  }
  const managed = await readManagedConfig();
  if (managed.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: managed.launchAtLogin });
  agent = new Agent(managed.serverUrl ?? DEFAULT_SERVER, app.getVersion(), managed.serverUrl ?? null);
  registerIpc();
  await agent.init();
  win = createWindow();
  tray = new Tray(trayIcon('stopped'));
  tray.on('click', () => showWindow());
  agent.on('state', (s) => {
    win?.webContents.send('state:changed', s);
    updateTray();
  });
  agent.on('show', () => showWindow());
  // A desktop notification was clicked: bring the app forward on the page it is about.
  agent.on('open', (view: string) => {
    showWindow();
    win?.webContents.send('app:navigate', view);
  });
  updateTray();
  setupUpdater(managed.updateChannel).catch((e: unknown) => console.error('[updater] could not start:', e instanceof Error ? e.message : e));
}).catch((e: unknown) => {
  // Without this, a failed start leaves an invisible process: no window, no tray icon.
  dialog.showErrorBox('WorkPulse could not start', e instanceof Error ? e.message : String(e));
  app.exit(1);
});

app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void quit();
  }
});
app.on('window-all-closed', () => {
  /* keep running in the tray */
});
