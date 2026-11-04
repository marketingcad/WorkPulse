import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The deployed site under test. Defaults to production; point LIVE_URL at a preview to check one before promoting it. */
export const LIVE_URL = (process.env.LIVE_URL ?? 'https://tallywork-alpha.vercel.app').replace(/\/$/, '');
export const LIVE_ORIGIN = new URL(LIVE_URL).origin;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Written by live/auth.setup.ts (git-ignored with the rest of e2e/.auth). */
export const LIVE_STATE = path.resolve(here, '../.auth/live.json');
export const LIVE_DATA = path.resolve(here, '../.auth/live-data.json');

export interface LiveData {
  orgId: string;
}
