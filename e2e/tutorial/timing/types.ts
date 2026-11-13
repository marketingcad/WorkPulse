/**
 * The timing model of the tutorial video: what the recordings note, what the voice says when, and how
 * the renderer maps one onto the other. `timeline.json` (render output) is a list of SceneTimeline.
 */

/** An area of the 1920 × 1080 video, in pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A moment a recording noted (clips/<id>.markers.json). */
export interface Marker {
  /** seconds from the start of the clip */
  at: number;
  label: string;
  /** the area to zoom to or highlight */
  box?: Box;
  /** the narration words this moment belongs to (an anchor) */
  on?: string;
  /** which occurrence of `on`, when the phrase is said more than once (default 1) */
  nth?: number;
  /** where the anchored item is (point, click, type), for the highlight ring; unlike `box`, never zoomed to */
  target?: Box;
  /** a click, scroll or page change: it ends the highlight on the item before it */
  interaction?: 'click' | 'scroll' | 'navigate';
}

/** When a word is spoken, in seconds from the start of its voice file. */
export interface WordTime {
  word: string;
  start: number;
  end: number;
}

/** Where the word times came from: forced alignment, the voice provider, or the word-count estimate. */
export type Aligner = 'whisper' | 'elevenlabs' | 'estimate';

/**
 * A stretch of the trimmed clip (never empty), played at `speed`, then held on its last frame for
 * `holdAfter` seconds. `holdBefore` holds its first frame first: only where an anchor comes before any
 * footage has played.
 */
export interface Piece {
  from: number;
  to: number;
  speed: number;
  holdBefore?: number;
  holdAfter: number;
}

/** How an anchor came out: when its word is spoken and when the video shows it (scene seconds). */
export interface AnchorResult {
  label: string;
  on: string;
  wordAt: number;
  /** null when it was dropped (out of order) */
  shownAt: number | null;
  driftMs: number | null;
  note?: 'out of order' | 'late';
  /** which marker of the recording this anchor came from (its index in the markers file) */
  key?: number;
}

/** One scene of the rendered video. Times are seconds from the scene's start; `start` places it in the video. */
export interface SceneTimeline {
  scene: string;
  start: number;
  seconds: number;
  voice: { start: number; seconds: number; aligner: Aligner };
  words: WordTime[];
  anchors: AnchorResult[];
  pieces: Piece[];
  captions: Array<{ start: number; end: number; text: string }>;
}
