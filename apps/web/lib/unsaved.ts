'use client';
import { useEffect } from 'react';

export const UNSAVED_MESSAGE = 'You have unsaved changes. Leave this page and lose them?';

/**
 * Whether a click on this link would leave the page in the same tab (so unsaved edits would be
 * lost): a same-origin link to another page, clicked without a modifier key, not a download and
 * not opening a new tab. Links within the page (`#…`) and to the same address keep the form.
 */
export function leavesPage(a: { href: string; target?: string; hasDownload?: boolean }, current: string, e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if ((a.target && a.target !== '_self') || a.hasDownload) return false;
  let to: URL;
  let from: URL;
  try {
    to = new URL(a.href, current);
    from = new URL(current);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  return to.pathname !== from.pathname || to.search !== from.search;
}

/**
 * Ask before unsaved edits are lost: on reload or closing the tab (the browser's own prompt), and
 * on links inside the app, which change pages without the browser asking. Pass `dirty` as true
 * while the form has changes that are not saved.
 */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Capture phase, before the app's link handler moves to the next page.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !leavesPage({ href: a.href, target: a.target, hasDownload: a.hasAttribute('download') }, window.location.href, e)) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
