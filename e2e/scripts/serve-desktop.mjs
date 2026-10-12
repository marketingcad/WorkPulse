// Serves the desktop app's window (the Electron renderer) to the browser for the E2E suite.
//
// The renderer is plain React that talks to the main process only through `window.tallywork`
// (src/preload). The tests replace that bridge with one that calls the same /api/v1/agent/me/*
// endpoints with a real device token (see fixtures/desktop-bridge.ts), so the page, its states and
// the API are real. What is NOT covered here is the Electron main process itself (IPC validation,
// the save dialog); its contract is unit-tested in apps/desktop/test.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktop = path.join(root, 'apps/desktop');
const out = path.join(desktop, 'out/renderer');
const port = Number(process.env.E2E_DESKTOP_PORT ?? 3101);

if (process.env.E2E_SKIP_BUILD !== '1' || !existsSync(path.join(out, 'index.html'))) {
  console.log('[e2e] building the desktop app window…');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const vite = path.join(desktop, 'node_modules/electron-vite/bin/electron-vite.js');
  const build = spawnSync(process.execPath, [vite, 'build'], { cwd: desktop, env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = path.normalize(path.join(out, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(out) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`[e2e] desktop window served on http://localhost:${port}`));
