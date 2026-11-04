/**
 * Wall-clock times in a named time zone, for <input type="datetime-local">. Entries are recorded and
 * listed in the member's time zone, so they are edited in it too, whatever the browser's zone is
 * (audit 28 Oct 2026, U7/FE-4). Without a zone, the browser's is used.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function parts(d: Date, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function offsetMs(d: Date, timeZone: string): number {
  const p = parts(d, timeZone);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) - Math.floor(d.getTime() / 1000) * 1000;
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" on the wall clock of `timeZone`. */
export function toZonedInput(iso: string | Date, timeZone?: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (!timeZone) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const p = parts(d, timeZone);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}T${pad(p.hour! % 24)}:${pad(p.minute!)}`;
}

/** "YYYY-MM-DDTHH:mm" read on the wall clock of `timeZone` -> ISO instant (null if not a valid time). */
export function fromZonedInput(v: string, timeZone?: string): string | null {
  if (!v) return null;
  if (!timeZone) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  // The offset at the guess, then at the result (they differ only across a daylight-saving change).
  let t = wall - offsetMs(new Date(wall), timeZone);
  t = wall - offsetMs(new Date(t), timeZone);
  return new Date(t).toISOString();
}
