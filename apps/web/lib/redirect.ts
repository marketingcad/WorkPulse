/**
 * Where to go after signing in: the `next` value only when it stays on this site. Browsers read
 * `/\evil.com` and `/<tab>/evil.com` as `//evil.com`, so a prefix check is not enough; the value is
 * resolved the way the browser would, and only its path, query and hash are kept.
 */
export function sameOriginPath(next: string | null, origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin): string | null {
  if (!next || !next.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  const path = url.pathname + url.search + url.hash;
  // Resolving drops dot segments, so `/.//evil.com` becomes `//evil.com`: another site to the browser
  // (audit 29 Oct 2026, AUTH-003). A path must stay a path.
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  return path;
}
