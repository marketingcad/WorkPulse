/**
 * `placeholderData` for a paged list that should keep showing its rows while the next page or a new
 * search loads, but not while it switches to a different list. `same(previousPath)` says whether the
 * previous query showed the same kind of rows; otherwise there is no placeholder and the list shows
 * its loading state.
 *
 * QA audit 11 Nov 2026 (BUG-03): Members › Former members kept the current members on screen, under
 * "Date left", for 2–4 s after the tab was opened, because every earlier list was kept as placeholder.
 */
export function keepPreviousWhen<T>(same: (previousPath: string) => boolean) {
  return (previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }): T | undefined => {
    const path = previousQuery?.queryKey?.[2];
    return typeof path === 'string' && same(path) ? previous : undefined;
  };
}

/** A query parameter of an org API path such as `/workers?view=former&page=2`. */
export function pathParam(path: string, name: string): string | null {
  const q = path.indexOf('?');
  return q < 0 ? null : new URLSearchParams(path.slice(q + 1)).get(name);
}
