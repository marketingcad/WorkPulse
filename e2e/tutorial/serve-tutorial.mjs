// Starts an ISOLATED WorkPulse server with realistic demo data, for recording the video tutorial
// (playwright.tutorial.config.ts runs this). See tutorial/README.md.
//
// - A fresh file-backed PGlite database in e2e/.tmp/tutorial, deleted and re-seeded on every start
//   with the demo workspace (packages/api/src/seed.ts: "Northwind Creative (Demo)", 30 people,
//   10 clients, two weeks of tracked time, screenshots, timesheets, invoices). Never apps/web/.data,
//   never Supabase, never a DATABASE_URL from your .env files.
// - Email, file storage and other external services are switched off, as in scripts/serve-web.mjs.
// - Port 3200, so it runs next to `pnpm dev` (:3000) and the E2E servers (:3100/:3101).
// - Reuses the production build made by scripts/serve-web.mjs when there is one; set
//   TUTORIAL_BUILD=1 to rebuild first (after changing the app).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'apps/web');
const tmp = path.join(root, 'e2e/.tmp/tutorial');
const port = process.env.TUTORIAL_WEB_PORT ?? '3200';
const next = path.join(web, 'node_modules/next/dist/bin/next');
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');

rmSync(tmp, { recursive: true, force: true });
mkdirSync(path.join(tmp, 'blobs'), { recursive: true });

const env = {
  ...process.env,
  DATABASE_URL: `pglite://${path.join(tmp, 'pglite').replaceAll('\\', '/')}`,
  POSTGRES_URL: '',
  LOCAL_STORAGE_DIR: path.join(tmp, 'blobs'),
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  BLOB_READ_WRITE_TOKEN: '',
  RESEND_API_KEY: '',
  SMTP_HOST: '',
  REQUIRE_EMAIL_VERIFICATION: 'false',
  // A fixed, recording-only secret: never reuse a real APP_SECRET here.
  APP_SECRET: 'tutorial-only-secret-0123456789abcdef0123456789ab',
  APP_URL: `http://localhost:${port}`,
  CRON_SECRET: 'tutorial-cron-secret',
  NEXT_TELEMETRY_DISABLED: '1',
  DESKTOP_DOWNLOAD_URL_WINDOWS: `http://localhost:${port}/tutorial-installers/Tallywork-Setup.exe`,
  DESKTOP_DOWNLOAD_URL_MACOS: `http://localhost:${port}/tutorial-installers/Tallywork-mac.dmg`,
  DESKTOP_DOWNLOAD_URL_LINUX: `http://localhost:${port}/tutorial-installers/Tallywork-linux.deb`,
  DESKTOP_DOWNLOAD_URL_LINUX_APPIMAGE: '',
  // The seed's demo password; the database is local and deleted on the next start.
  SEED_PASSWORD: '',
  // Screenshots for the last five days, so the Activity scene finds some even after a weekend.
  SEED_SCREENSHOT_DAYS: '5',
};

if (process.env.TUTORIAL_BUILD === '1' || !existsSync(path.join(web, '.next/BUILD_ID'))) {
  console.log('[tutorial] building the web app…');
  const build = spawnSync(process.execPath, [next, 'build'], { cwd: web, env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log('[tutorial] seeding the demo workspace (takes a few minutes)…');
// tsx without --env-file, so nothing from apps/web/.env can point the seed at a real database.
const seed = spawnSync(process.execPath, [tsx, 'scripts/seed.ts'], { cwd: web, env, stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const extras = spawnSync(process.execPath, [tsx, path.join(root, 'e2e/tutorial/seed-extras.ts')], { cwd: web, env, stdio: 'inherit' });
if (extras.status !== 0) process.exit(extras.status ?? 1);

console.log(`[tutorial] starting the web app on http://localhost:${port}`);
const server = spawn(process.execPath, [next, 'start', '--port', port], { cwd: web, env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
server.on('exit', (code) => process.exit(code ?? 0));
