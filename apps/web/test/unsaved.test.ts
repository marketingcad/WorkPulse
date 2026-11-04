import { describe, expect, it } from 'vitest';
import { leavesPage } from '../lib/unsaved';

/** Which link clicks would lose unsaved edits, so the page asks first (UX remediation, phase 4). */
describe('leavesPage', () => {
  const here = 'https://app.test/o/1/settings/security?tab=a';
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('asks for a plain click to another page of the app', () => {
    expect(leavesPage({ href: '/o/1/workers' }, here, click)).toBe(true);
    expect(leavesPage({ href: '/o/1/settings/security?tab=b' }, here, click)).toBe(true);
  });

  it('does not ask when the form stays open', () => {
    // same page, or a jump within it
    expect(leavesPage({ href: here }, here, click)).toBe(false);
    expect(leavesPage({ href: `${here}#sessions` }, here, click)).toBe(false);
    // a new tab or window, a download
    expect(leavesPage({ href: '/o/1/workers', target: '_blank' }, here, click)).toBe(false);
    expect(leavesPage({ href: '/o/1/export.csv', hasDownload: true }, here, click)).toBe(false);
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) expect(leavesPage({ href: '/o/1/workers' }, here, { ...click, [k]: true })).toBe(false);
    expect(leavesPage({ href: '/o/1/workers' }, here, { ...click, button: 1 })).toBe(false);
    // another site: the browser's own leave prompt covers it
    expect(leavesPage({ href: 'https://docs.example.com/' }, here, click)).toBe(false);
  });
});
