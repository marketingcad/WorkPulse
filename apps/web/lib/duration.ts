/**
 * "2:30", "120:30", "2h 30m", "2h30", "2.5h", "2.5", ".5", "90m" → seconds; null when unreadable.
 * Shared by time entry and the calculator, so both accept the same ways of typing hours. Callers set
 * their own limits (a time entry is at most 24 hours; the calculator takes weekly or monthly totals).
 */
export function parseDuration(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  // H:MM, any number of hours ("120:30" is a month's total).
  let m = s.match(/^(\d{1,4}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  // Hours with an "h", then optional minutes, the "m" optional after an "h": "7h", "7.5h", "7h 30m", "7h30".
  m = s.match(/^(\d+(?:\.\d+)?|\.\d+)\s*h(?:\s*(\d+)\s*m?)?$/);
  if (m) return Math.round(Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60);
  // Minutes only: "90m".
  m = s.match(/^(\d+)\s*m$/);
  if (m) return Number(m[1]) * 60;
  // Decimal hours: "7.5", "7", ".5".
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(s)) return Math.round(Number(s) * 3600);
  return null;
}

/** H:MM, rounded to the nearest minute (3,570 s is "1:00", never "0:60"). */
export function asHm(secs: number): string {
  const mins = Math.round(secs / 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}
