import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC, type IpcChannel } from '../shared/ipc';
import { Agent } from './services/agent';

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
    width: 380,
    height: 640,
    minWidth: 340,
    minHeight: 560,
    show: false,
    title: 'Tallywork',
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#0f2240"/><g stroke="#e6ecf5" stroke-width="2.6" stroke-linecap="round"><path d="M9 8.5v15M13.3 8.5v15M17.6 8.5v15M21.9 8.5v15"/></g><circle cx="25" cy="25" r="5.5" fill="${color}" stroke="#0f2240" stroke-width="2"/></svg>`;
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
  const label = st.tracking.state === 'stopped' ? 'Not tracking' : `${st.tracking.state === 'paused' ? 'Paused' : 'Tracking'} · ${fmt(elapsed)}${project ? ` · ${project}` : ''}`;
  const key = `${st.tracking.state}|${label}|${st.phase}`;
  if (process.platform === 'darwin') tray.setTitle(st.tracking.state === 'stopped' ? '' : fmt(elapsed));
  tray.setToolTip(`Tallywork — ${label}`);
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setImage(trayIcon(st.tracking.state));
  const last = st.lastProject ? st.assignments.find((a) => a.project_id === st.lastProject!.projectId) : undefined;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      st.tracking.state === 'stopped'
        ? { label: last ? `Start “${last.project_name}”` : 'Start tracking…', enabled: st.phase === 'ready', click: () => (last ? void agent.start(last.project_id, st.lastProject!.taskId).catch(() => showWindow()) : showWindow()) }
        : { label: 'Stop tracking', click: () => void agent.stop() },
      { label: 'Open Tallywork', click: () => showWindow() },
      { label: 'Open dashboard in browser', click: () => void shell.openExternal(`${st.serverUrl}/`) },
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

/** Strict IPC: only known channels, only from our own renderer, validated payloads. */
function registerIpc(): void {
  const handlers: { [C in IpcChannel]: (payload: never) => unknown } = {
    'state:get': () => agent.state(),
    'auth:login': (p: { serverUrl?: string }) => agent.login(p.serverUrl),
    'auth:logout': () => agent.logout(),
    'timer:start': (p: { projectId: string; taskId: string | null }) => agent.start(p.projectId, p.taskId),
    'timer:stop': () => agent.stop(),
    'timer:pause': () => agent.pause('MANUAL'),
    'timer:resume': () => agent.resume(),
    'timer:switch': (p: { projectId: string; taskId: string | null }) => agent.start(p.projectId, p.taskId),
    'notes:set': (p: { note: string }) => agent.setNote(p.note),
    'idle:resolve': (p: { choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED'; projectId?: string; taskId?: string | null }) => agent.resolveIdle(p.choice, p.projectId, p.taskId),
    'policy:ack': () => agent.acknowledgePolicy(),
    'recovery:resolve': (p: { resume: boolean }) => agent.resolveRecovery(p.resume),
    'app:openWeb': (p: { path: string }) => shell.openExternal(`${agent.state().serverUrl}${p.path}`),
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

async function setupUpdater(): Promise<void> {
  if (!app.isPackaged || !process.env.TALLYWORK_UPDATE_URL) return;
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoInstallOnAppQuit = true;
  // Never interrupt an active session: download in the background, install on quit.
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 6 * 3600_000);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('app.tallywork.desktop');
  agent = new Agent(DEFAULT_SERVER, app.getVersion());
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
  updateTray();
  void setupUpdater();
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
