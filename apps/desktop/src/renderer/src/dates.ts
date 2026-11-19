/** Calendar dates for the renderer, with no browser globals, so they can be tested on their own. */

export function localDateInput(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today in a time zone (the computer's when none is given), as YYYY-MM-DD. */
export function todayIn(timeZone?: string, now = new Date()): string {
  if (!timeZone) return localDateInput(now);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
