// Starts an ISOLATED WorkPulse web app + API for the E2E suite (Playwright's `webServer` runs this).
//
// - Fresh in-memory PGlite database on every start: tests never touch apps/web/.data, Supabase or
//   any DATABASE_URL from your .env files, and leave nothing behind.
// - Email, file storage and other external services are switched off: mail is kept in memory and
//   files go to e2e/.tmp, even if apps/web/.env configures Resend, SMTP, Supabase or Vercel Blob.
// - A production build (`next build` + `next start`), the same code path as a deploy. A second
//   `next dev` cannot run while your own dev server is using apps/web, and this one doesn't need to.
//   Set E2E_SKIP_BUILD=1 to reuse the last build when only test files changed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'apps/web');
const tmp = path.join(root, 'e2e/.tmp');
const port = process.env.E2E_WEB_PORT ?? '3100';
const next = path.join(web, 'node_modules/next/dist/bin/next');

rmSync(path.join(tmp, 'blobs'), { recursive: true, force: true });
mkdirSync(path.join(tmp, 'blobs'), { recursive: true });

const env = {
  ...process.env,
  // Isolated data. Set explicitly so values in apps/web/.env* (which Next also loads) never win.
  DATABASE_URL: 'pglite://memory',
  POSTGRES_URL: '',
  LOCAL_STORAGE_DIR: path.join(tmp, 'blobs'),
  // No external services from a test run.
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  BLOB_READ_WRITE_TOKEN: '',
  RESEND_API_KEY: '',
  SMTP_HOST: '',
  REQUIRE_EMAIL_VERIFICATION: 'false',
  // A fixed, test-only secret: never reuse a real APP_SECRET here.
  APP_SECRET: 'e2e-only-secret-0123456789abcdef0123456789abcdef',
  APP_URL: `http://localhost:${port}`,
  CRON_SECRET: 'e2e-cron-secret',
  NEXT_TELEMETRY_DISABLED: '1',
  // Installer links for the /download page. Nothing is served here: download.spec intercepts them.
  DESKTOP_DOWNLOAD_URL_WINDOWS: `http://localhost:${port}/e2e-installers/Tallywork-Setup.exe`,
  DESKTOP_DOWNLOAD_URL_MACOS: `http://localhost:${port}/e2e-installers/Tallywork-mac.dmg`,
  DESKTOP_DOWNLOAD_URL_LINUX: `http://localhost:${port}/e2e-installers/Tallywork-linux.deb`,
  DESKTOP_DOWNLOAD_URL_LINUX_APPIMAGE: '',
};

if (process.env.E2E_SKIP_BUILD !== '1') {
  console.log('[e2e] building the web app (set E2E_SKIP_BUILD=1 to reuse the last build)…');
  const build = spawnSync(process.execPath, [next, 'build'], { cwd: web, env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log(`[e2e] starting the web app on http://localhost:${port} with an in-memory database`);
const server = spawn(process.execPath, [next, 'start', '--port', port], { cwd: web, env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
server.on('exit', (code) => process.exit(code ?? 0));
