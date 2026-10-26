/** "2:30", "2h 30m", "2.5", "90m" → seconds; null when unreadable. */
export function parseDuration(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 3600);
  return null;
}

/** H:MM, rounded to the nearest minute (3,570 s is "1:00", never "0:60"). */
export function asHm(secs: number): string {
  const mins = Math.round(secs / 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}
