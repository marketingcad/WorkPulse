/**
 * Where the movable calculator sits. The round button is the anchor: it is dragged (or moved with
 * Alt + arrow keys) anywhere on the screen and always stays fully visible; the panel opens next to it.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

/** Space kept between the calculator and the edges of the window. */
export const EDGE = 8;
/** Space between the button and its panel. */
export const GAP = 12;
/** A press that moves less than this is a click, not a drag. */
export const DRAG_THRESHOLD = 5;

/** Keep a box of `size` whose top-left corner is `p` fully inside the viewport. */
export function clampToViewport(p: Point, size: Size, viewport: Size): Point {
  const maxX = Math.max(EDGE, viewport.width - EDGE - size.width);
  const maxY = Math.max(EDGE, viewport.height - EDGE - size.height);
  return { x: Math.round(Math.min(Math.max(p.x, EDGE), maxX)), y: Math.round(Math.min(Math.max(p.y, EDGE), maxY)) };
}

/** True once a press has moved far enough to count as a drag. */
export function isDrag(start: Point, now: Point): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD;
}

/**
 * Top-left of the panel for a button at `anchor`: above the button when it fits, else below, else
 * as close as fits; lined up with the button's right edge, or its left edge when that keeps more of it
 * on screen. Never outside the viewport.
 */
export function panelPosition(anchor: Point, button: Size, panel: Size, viewport: Size): Point {
  const above = anchor.y - GAP - panel.height;
  const below = anchor.y + button.height + GAP;
  let y: number;
  if (above >= EDGE) y = above;
  else if (below + panel.height <= viewport.height - EDGE) y = below;
  else y = viewport.height - EDGE - panel.height;
  const rightAligned = anchor.x + button.width - panel.width;
  const x = rightAligned >= EDGE ? rightAligned : anchor.x;
  return clampToViewport({ x, y }, panel, viewport);
}

/** A saved position, or null when it is missing or not a position (it then falls back to the corner). */
export function parseSavedPosition(raw: string | null): Point | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y)) return { x: (v as Point).x, y: (v as Point).y };
  } catch {
    /* not JSON */
  }
  return null;
}
