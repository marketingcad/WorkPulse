/** The rendered video's timeline (video/timeline.json) and its sync report (video/sync-report.json). */
import { LATE_MS } from './retime';
import type { AnchorResult, SceneTimeline } from './types';

const missed = (a: AnchorResult) => a.note === 'out of order' || (a.driftMs ?? 0) > LATE_MS;

/** The anchors not shown on their words: one line each for the log, and the same as JSON. */
export function syncReport(scenes: SceneTimeline[]): { lines: string[]; json: Array<{ scene: string; anchors: AnchorResult[] }> } {
  const json = scenes.map((s) => ({ scene: s.scene, anchors: s.anchors.filter(missed) })).filter((s) => s.anchors.length);
  const lines = json.flatMap((s) => s.anchors.map((a) => `${s.scene} "${a.on}": ${a.note === 'out of order' ? 'out of order (dropped)' : `${a.driftMs} ms late`}`));
  return { lines, json };
}

/** The scenes with their start times in the whole video. */
export function placeTimeline(scenes: SceneTimeline[], starts: number[]): SceneTimeline[] {
  return scenes.map((s, i) => ({ ...s, start: starts[i]! }));
}
