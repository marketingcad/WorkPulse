import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TUTORIAL_URL = `http://localhost:${process.env.TUTORIAL_WEB_PORT ?? 3200}`;
export const TUTORIAL_DESKTOP_URL = `http://localhost:${process.env.TUTORIAL_DESKTOP_PORT ?? 3201}`;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Per-run sign-ins and demo facts written by setup.ts (git-ignored, like e2e/.auth). */
export const TUTORIAL_AUTH_DIR = path.resolve(here, '../.auth/tutorial');
export const STATE = {
  admin: path.join(TUTORIAL_AUTH_DIR, 'admin.json'),
  manager: path.join(TUTORIAL_AUTH_DIR, 'manager.json'),
} as const;
export const TUTORIAL_DATA = path.join(TUTORIAL_AUTH_DIR, 'data.json');
/** Finished clips, one per scene, named after the scene (git-ignored). */
export const CLIPS_DIR = path.resolve(here, 'clips');

/**
 * The demo workspace's accounts (packages/api/src/seed.ts). The seed gives every account the public
 * local-demo password; the database lives in e2e/.tmp/tutorial and is replaced on every start.
 */
export const DEMO_PASSWORD = 'demo-password-123';
export const PEOPLE = {
  admin: { name: 'Avery Admin', email: 'admin@demo.tallywork.app' },
  /** Leads the Design team (TEAM_MANAGER). */
  manager: { name: 'Maya Chen', email: 'maya.chen@demo.tallywork.app' },
  /** A Design team member (WORKER): the desktop app scenes are recorded as her. */
  worker: { name: 'Ava Okafor', email: 'ava.okafor@demo.tallywork.app' },
} as const;
