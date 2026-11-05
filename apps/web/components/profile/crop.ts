/**
 * The avatar editor's geometry, kept free of React so it can be tested on its own.
 *
 * The picture is drawn at `scale` (screen pixels per image pixel) with its top-left corner at
 * (x, y) inside a square viewport of `view` pixels. It must always cover the viewport, so the round
 * crop never shows an empty edge: scale is at least `view / shortest side`, and x, y are clamped.
 */
export interface Crop {
  /** zoom, 1 = the picture just covers the viewport */
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;

export const baseScale = (w: number, h: number, view: number) => view / Math.min(w, h);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep the picture over the whole viewport. */
export function clampCrop(c: Crop, w: number, h: number, view: number): Crop {
  const zoom = clamp(c.zoom, MIN_ZOOM, MAX_ZOOM);
  const s = baseScale(w, h, view) * zoom;
  return { zoom, x: clamp(c.x, view - w * s, 0), y: clamp(c.y, view - h * s, 0) };
}

/** The starting crop: the picture fills the circle, centered. */
export function initialCrop(w: number, h: number, view: number): Crop {
  const s = baseScale(w, h, view);
  return { zoom: 1, x: (view - w * s) / 2, y: (view - h * s) / 2 };
}

/** Move by a drag or arrow key (in screen pixels). */
export function moveCrop(c: Crop, dx: number, dy: number, w: number, h: number, view: number): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, w, h, view);
}

/** Zoom while keeping the point at the viewport's center where it is. */
export function zoomCrop(c: Crop, zoom: number, w: number, h: number, view: number): Crop {
  const base = baseScale(w, h, view);
  const s = base * c.zoom;
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const s2 = base * next;
  const cx = (view / 2 - c.x) / s;
  const cy = (view / 2 - c.y) / s;
  return clampCrop({ zoom: next, x: view / 2 - cx * s2, y: view / 2 - cy * s2 }, w, h, view);
}

/** The square of the original picture the viewport shows (what gets saved). */
export function sourceRect(c: Crop, w: number, h: number, view: number): { sx: number; sy: number; side: number } {
  const s = baseScale(w, h, view) * c.zoom;
  return { sx: -c.x / s, sy: -c.y / s, side: view / s };
}

/** What the browser may send before the server's own checks (it decodes and re-encodes the picture). */
export function precheck(file: { type: string; size: number }, limits: { maxBytes: number; types: readonly string[] }): 'type' | 'size' | null {
  if (!limits.types.includes(file.type)) return 'type';
  if (file.size > limits.maxBytes) return 'size';
  return null;
}
