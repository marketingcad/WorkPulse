/** "1 manager", "2 managers", "0 managers" (QA audit 11 Nov 2026, BUG-11: the team panel said "1 managers"). */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}
