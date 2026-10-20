import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_PRESETS } from '@tallywork/domain';
import { HELP_ARTICLES, HELP_CATEGORIES, NAV_GUIDE } from '../components/help/content';
import { searchArticles } from '../components/help/search';
import { TOUR_STEPS, placeCard, visibleSteps } from '../components/help/tour-steps';
import { NAV, filterNav } from '../components/shell/nav';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const orgPages = path.join(web, 'app/o/[orgId]');
const asSearchable = HELP_ARTICLES.map((a) => ({ ...a, body: [...(a.steps ?? []), ...(a.points ?? []), a.tip ?? ''] }));

describe('help search', () => {
  it('finds guides by words in any order, as the start of a word, title matches first', () => {
    const hits = searchArticles(asSearchable, 'approve timesh').map((a) => a.id);
    expect(hits[0]).toBe('approve-timesheets');
    expect(searchArticles(asSearchable, 'invo').map((a) => a.id)).toContain('invoice');
    expect(searchArticles(asSearchable, 'LUNCH break').map((a) => a.id)[0]).toBe('project-breaks');
  });

  it('every word must match; nonsense finds nothing; an empty search shows everything', () => {
    expect(searchArticles(asSearchable, 'invoice zzzqqq')).toEqual([]);
    expect(searchArticles(asSearchable, '   ')).toHaveLength(HELP_ARTICLES.length);
  });
});

describe('help content matches the app', () => {
  it('has unique guide ids, real categories, and no empty category', () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of HELP_ARTICLES) expect(HELP_CATEGORIES.map((c) => c.id)).toContain(a.category);
    for (const c of HELP_CATEGORIES) expect(HELP_ARTICLES.some((a) => a.category === c.id), c.id).toBe(true);
  });

  it('every link opens a page that exists', () => {
    for (const a of HELP_ARTICLES)
      for (const l of a.links ?? []) {
        const route = l.href.split(/[?#]/)[0]!;
        expect(existsSync(path.join(orgPages, route, 'page.tsx')), `${a.id} → ${l.href}`).toBe(true);
      }
  });

  it('every “Help” link on a page points to a guide that exists', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.tsx')) files.push(p);
      }
    };
    walk(orgPages);
    const used = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/HelpLink article=(?:"([^"]+)"|\{[^}]*?'([^']+)'[^}]*?'([^']+)'\})/g)].flatMap((m) => [m[1], m[2], m[3]].filter(Boolean) as string[]));
    expect(used.length).toBeGreaterThanOrEqual(5);
    for (const id of used) expect(HELP_ARTICLES.map((a) => a.id), id).toContain(id);
  });

  it('“Finding your way” describes every menu item', () => {
    for (const item of NAV.flatMap((g) => g.items)) expect(NAV_GUIDE[item.label], item.label).toBeTruthy();
  });

  it('Help is in everyone’s menu, even a role with almost no access', () => {
    const can = () => false;
    const labels = filterNav(can, {}, false).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('nav.item.help');
    const admin = filterNav((p) => !!ROLE_PRESETS.SYSTEM_ADMIN[p], ROLE_PRESETS.SYSTEM_ADMIN, true).flatMap((g) => g.items.map((i) => i.href));
    expect(admin).toContain('/help');
  });
});

describe('product tour', () => {
  it('keeps centred steps and only the steps whose element is on screen, in order', () => {
    const onScreen = new Set(['nav.group.time', 'notifications', 'nav.item.help']);
    expect(visibleSteps(TOUR_STEPS, (t) => onScreen.has(t)).map((s) => s.id)).toEqual(['welcome', 'time', 'notifications', 'help']);
    // A phone: no sidebar, but the menu button.
    const phone = new Set(['nav-menu', 'overview-customize', 'notifications', 'account-menu']);
    expect(visibleSteps(TOUR_STEPS, (t) => phone.has(t)).map((s) => s.id)).toEqual(['welcome', 'menu', 'customize', 'notifications', 'account']);
  });

  it('every step has a short title and text', () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeLessThan(40);
      expect(s.body.length).toBeLessThan(200);
    }
  });

  it('places the card beside, below or above the highlighted element, always inside the window', () => {
    const view = { width: 1280, height: 800 };
    const card = { width: 320, height: 180 };
    // A sidebar item: room on the right.
    expect(placeCard({ top: 200, left: 16, width: 200, height: 36 }, card, view)).toMatchObject({ side: 'right', left: 228 });
    // The bell, top right: no room on the right, so below.
    expect(placeCard({ top: 12, left: 1200, width: 32, height: 32 }, card, view)).toMatchObject({ side: 'bottom', top: 56, left: 1280 - 12 - 320 });
    // Near the bottom of the window: above.
    expect(placeCard({ top: 700, left: 1100, width: 120, height: 40 }, card, view)).toMatchObject({ side: 'top', top: 700 - 12 - 180 });
    // No element: centred.
    expect(placeCard(null, card, view)).toEqual({ side: 'center', top: 310, left: 480 });
    // A phone: the card stays inside the narrow window.
    const p = placeCard({ top: 10, left: 8, width: 36, height: 36 }, { width: 300, height: 200 }, { width: 360, height: 700 });
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + 300).toBeLessThanOrEqual(360);
  });
});
