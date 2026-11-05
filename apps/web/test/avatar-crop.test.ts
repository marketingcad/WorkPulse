import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, clampCrop, initialCrop, moveCrop, precheck, sourceRect, zoomCrop } from '../components/profile/crop';

/** The avatar editor's crop: the picture always covers the circle, and what is saved is what is shown. */
const VIEW = 280;

describe('avatar crop', () => {
  it('starts centered, filling the circle with the shortest side', () => {
    const c = initialCrop(1200, 800, VIEW);
    expect(c.zoom).toBe(1);
    expect(c.y).toBe(0);
    expect(c.x).toBeCloseTo((VIEW - 1200 * (VIEW / 800)) / 2);
    // The saved square is the centered 800×800 of the original.
    const r = sourceRect(c, 1200, 800, VIEW);
    expect(r.side).toBeCloseTo(800);
    expect(r.sx).toBeCloseTo(200);
    expect(r.sy).toBeCloseTo(0);
  });

  it('never leaves an empty edge when dragged or zoomed out', () => {
    const c = initialCrop(1000, 1000, VIEW);
    // A square picture at zoom 1 cannot move at all.
    expect(moveCrop(c, 50, -50, 1000, 1000, VIEW)).toEqual(c);
    const zoomed = zoomCrop(c, 2, 1000, 1000, VIEW);
    const far = moveCrop(zoomed, 10_000, 10_000, 1000, 1000, VIEW);
    expect(far.x).toBe(0);
    expect(far.y).toBe(0);
    const other = moveCrop(zoomed, -10_000, -10_000, 1000, 1000, VIEW);
    expect(other.x).toBeCloseTo(VIEW - 1000 * (VIEW / 1000) * 2);
    // Zooming back out pulls the picture back over the circle.
    const out = zoomCrop(far, 1, 1000, 1000, VIEW);
    expect(out).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('zooms around the center, within limits', () => {
    const c = initialCrop(1000, 1000, VIEW);
    const z = zoomCrop(c, 2, 1000, 1000, VIEW);
    const r = sourceRect(z, 1000, 1000, VIEW);
    expect(r.side).toBeCloseTo(500);
    expect(r.sx + r.side / 2).toBeCloseTo(500); // still centered
    expect(zoomCrop(c, 99, 1000, 1000, VIEW).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(c, 0.1, 1000, 1000, VIEW).zoom).toBe(1);
    expect(clampCrop({ zoom: 3, x: 5, y: 5 }, 1000, 1000, VIEW)).toEqual({ zoom: 3, x: 0, y: 0 });
  });

  it('checks the type and size the browser reports before sending', () => {
    const limits = { maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] };
    expect(precheck({ type: 'image/png', size: 1000 }, limits)).toBeNull();
    expect(precheck({ type: 'image/gif', size: 1000 }, limits)).toBe('type');
    expect(precheck({ type: 'image/jpeg', size: limits.maxBytes + 1 }, limits)).toBe('size');
  });
});
