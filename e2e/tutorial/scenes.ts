/**
 * The WorkPulse video tutorial, scene by scene: the single source for the recordings
 * (recordings/*.rec.ts look a scene up by id) and for the production package in
 * docs/video-tutorial (build-package.ts writes the script, voiceover, storyboard, subtitles and
 * chapter timestamps from it).
 *
 * Each chapter's words live in script/chNN-*.ts; its recording is recordings/NN-*.rec.ts. After
 * changing the words, run `pnpm tutorial:package`; after changing what is on screen, record again.
 */
import { ch01 } from './script/ch01-introduction';
import { ch02 } from './script/ch02-getting-started';
import { ch03 } from './script/ch03-finding-your-way';
import { ch04 } from './script/ch04-organization-setup';
import { ch05 } from './script/ch05-people';
import { ch06 } from './script/ch06-work';
import { ch07 } from './script/ch07-desktop';
import { ch08 } from './script/ch08-monitoring';
import { ch09 } from './script/ch09-time-approvals';
import { ch10 } from './script/ch10-schedules-time-off';
import { ch11 } from './script/ch11-money';
import { ch12 } from './script/ch12-reports';
import { ch13 } from './script/ch13-security-admin';
import { ch14 } from './script/ch14-manager-view';
import { ch15 } from './script/ch15-faq';
import { ch16 } from './script/ch16-wrap-up';

export type Persona = 'admin' | 'manager' | 'worker' | 'guest';

export interface Scene {
  /** chapter.scene, e.g. "03.2"; also the recording's test title and the clip's file name */
  id: string;
  title: string;
  /** who is signed in while the scene is recorded */
  persona: Persona;
  /** where it is recorded: the web app, the desktop app's window, or made in the editor (no recording) */
  app: 'web' | 'desktop' | 'edit';
  /** what the viewer sees */
  screen: string;
  /** what the presenter does, in order: clicks, typing, navigation */
  actions: string[];
  /** the voiceover, word for word */
  narration: string;
  /** on-screen text added in the editor */
  overlays: string[];
  /** zooms and highlights, by the moment they belong to */
  focus: string[];
  /** how the scene hands over to the next one */
  transition: string;
}

export interface Chapter {
  n: number;
  title: string;
  /** one line: what the viewer can do after this chapter */
  goal: string;
  scenes: Scene[];
}

/** Narration pace: 150 words a minute, a calm training-video speed. */
const WORDS_PER_SECOND = 2.5;

export function narrationSeconds(s: Pick<Scene, 'narration'>): number {
  const words = s.narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / WORDS_PER_SECOND);
}

/** The scene's length in the edit: its narration plus a short breath before the next one. */
export function sceneSeconds(s: Pick<Scene, 'narration'>): number {
  return narrationSeconds(s) + 2;
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function sceneById(id: string): Scene {
  for (const c of CHAPTERS) for (const s of c.scenes) if (s.id === id) return s;
  throw new Error(`No scene "${id}" in tutorial/scenes.ts (a recording's test title must be its scene id)`);
}

/** A chapter title card between chapters (not before the first), in seconds. */
export const CHAPTER_CARD_SECONDS = 3;

/** Publishing details for the video page (build-package.ts adds the chapter timestamps). */
export const VIDEO = {
  title: 'WorkPulse Complete Tutorial: Time Tracking, Timesheets, Payroll and Billing from Start to Finish',
  alternativeTitles: [
    'How to Use WorkPulse: The Complete Guide for Admins, Managers and Workers',
    'WorkPulse from A to Z: Set Up, Track Time, Approve, Invoice and Run Payroll',
  ],
  resolution: '1920 × 1080 (16:9)',
  language: 'English',
  description: [
    'Learn how to use WorkPulse from beginning to end. This complete tutorial follows one demo company, Northwind Creative, through the whole workflow: setting up the organization, inviting people, organizing clients, projects and tasks, tracking time with the desktop app, approving timesheets, invoicing clients, running payroll and reporting.',
    'Everything shown is the real application with demo data. Use the chapters below to jump to the part you need.',
    'Who is this for? Administrators and managers who run WorkPulse in the web app, and workers who track their time with the desktop app (Windows, macOS, Linux).',
  ],
  tags: ['WorkPulse', 'time tracking', 'timesheets', 'employee monitoring', 'payroll', 'invoicing', 'workforce management', 'desktop time tracker', 'tutorial', 'how to'],
  thumbnail: {
    concept: 'Split screen. Left two-thirds: the WorkPulse Overview (This month figures and Project budgets) on a laptop, slightly angled. Right third: the desktop app\'s timer card showing "Clocked in" and the Coffee and Lunch break buttons, overlapping the laptop like a floating window.',
    text: 'Large headline top left: "WorkPulse" in white on the brand indigo (#4B4FC4); second line: "Complete Tutorial" in bold yellow. Small badge bottom right: "Time • Approvals • Payroll".',
    style: 'Clean, high contrast, 1280 × 720 export, no more than five words of headline text, readable at phone size. Use a frame from clips 01.1 (Overview) and 07.3 (timer) rather than a mock-up.',
  },
};

export const CHAPTERS: Chapter[] = [ch01, ch02, ch03, ch04, ch05, ch06, ch07, ch08, ch09, ch10, ch11, ch12, ch13, ch14, ch15, ch16];
