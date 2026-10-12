import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_URL = `http://localhost:${process.env.E2E_WEB_PORT ?? 3100}`;
export const DESKTOP_URL = `http://localhost:${process.env.E2E_DESKTOP_PORT ?? 3101}`;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Per-run state written by global-setup (git-ignored). */
export const AUTH_DIR = path.resolve(here, '../.auth');
export const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json');
export const WORKER_STATE = path.join(AUTH_DIR, 'worker.json');
export const DATA_FILE = path.join(AUTH_DIR, 'data.json');

/** Every account the suite creates uses this password (test-only data in a throwaway database). */
export const PASSWORD = 'e2e-correct-horse-battery';
