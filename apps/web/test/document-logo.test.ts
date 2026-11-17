import { describe, expect, it } from 'vitest';
import { DOCUMENT_LOGO_MAX_CHARS } from '@tallywork/contracts/limits';
import { DOCUMENT_LOGO_MAX, DOCUMENT_LOGO_TYPES, fitWithin, pickEncoding } from '../lib/document-logo';

// The document logo is resized in the browser before upload: never cropped, never enlarged.
describe('fitWithin', () => {
  it('scales a large wide logo down to the 600 px width, keeping its shape', () => {
    expect(fitWithin(1800, 300)).toEqual({ width: 600, height: 100 });
  });
  it('scales a tall logo down to the 200 px height', () => {
    expect(fitWithin(400, 800)).toEqual({ width: 100, height: 200 });
  });
  it('keeps a small logo at its own size', () => {
    expect(fitWithin(240, 80)).toEqual({ width: 240, height: 80 });
  });
  it('never makes a side smaller than 1 px', () => {
    expect(fitWithin(60000, 10)).toEqual({ width: 600, height: 1 });
  });
  it('stays inside the box for any shape', () => {
    for (const [w, h] of [[601, 199], [1234, 567], [3, 2000], [999, 999]] as const) {
      const f = fitWithin(w, h)!;
      expect(f.width).toBeLessThanOrEqual(DOCUMENT_LOGO_MAX.width);
      expect(f.height).toBeLessThanOrEqual(DOCUMENT_LOGO_MAX.height);
    }
  });
  it('refuses an image the browser could not size (e.g. an SVG with no width)', () => {
    expect(fitWithin(0, 0)).toBeNull();
    expect(fitWithin(Number.NaN, 10)).toBeNull();
    expect(fitWithin(Infinity, 10)).toBeNull();
  });
});

describe('pickEncoding', () => {
  it('keeps PNG (transparency) whenever it fits the server limit', () => {
    expect(pickEncoding(DOCUMENT_LOGO_MAX_CHARS, null)).toBe('png');
  });
  it('falls back to JPEG when only that fits', () => {
    expect(pickEncoding(DOCUMENT_LOGO_MAX_CHARS + 1, DOCUMENT_LOGO_MAX_CHARS - 10)).toBe('jpeg');
  });
  it('says too large when neither fits', () => {
    expect(pickEncoding(DOCUMENT_LOGO_MAX_CHARS + 1, DOCUMENT_LOGO_MAX_CHARS + 1)).toBe('too_large');
    expect(pickEncoding(DOCUMENT_LOGO_MAX_CHARS + 1, null)).toBe('too_large');
  });
});

describe('accepted files', () => {
  it('takes PNG, JPEG, WebP and SVG and nothing else', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) expect(DOCUMENT_LOGO_TYPES.test(t)).toBe(true);
    for (const t of ['image/gif', 'application/pdf', 'text/plain', 'image/png; x']) expect(DOCUMENT_LOGO_TYPES.test(t)).toBe(false);
  });
});
