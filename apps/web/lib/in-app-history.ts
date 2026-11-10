/**
 * Whether the page before this one was inside the app, so a "Back" button can use the browser's
 * history without taking someone out of WorkPulse (they may have opened the page from an email or
 * another site). The shell reports every route it shows; a full page load starts over.
 *
 * `document.referrer` cannot answer this: in-app navigation does not reload the page, so it keeps
 * pointing at whatever loaded the app first.
 */
let current: string | null = null;
let moved = false;

/** Called by the shell with each path it shows. */
export function noteRoute(path: string): void {
  if (current !== null && current !== path) moved = true;
  current = path;
}

/** True once the person has gone from one page to another inside the app since it loaded. */
export function hasInAppHistory(): boolean {
  return moved;
}

/** For tests: forget the routes seen. */
export function resetInAppHistory(): void {
  current = null;
  moved = false;
}
