import type { ActivityBlockDto } from '@tallywork/contracts';

export type BlockShot = ActivityBlockDto['screenshots'][number];

/**
 * One capture = every display photographed at the same moment (the agent stamps all
 * displays of one capture with the same captured_at). Captures are in time order and
 * each capture's screens are ordered Screen 1, Screen 2, …
 */
export function groupCaptures(shots: BlockShot[]): BlockShot[][] {
  const byTime = new Map<string, BlockShot[]>();
  for (const s of shots) byTime.set(s.captured_at, [...(byTime.get(s.captured_at) ?? []), s]);
  return [...byTime.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([, group]) => group.sort((a, b) => a.display_index - b.display_index));
}

export function screenLabel(s: BlockShot): string {
  return `Screen ${s.display_index + 1}`;
}
