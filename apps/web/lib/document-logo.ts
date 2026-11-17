import { DOCUMENT_LOGO_MAX_CHARS } from '@tallywork/contracts/limits';

/** The largest document logo the browser keeps, in pixels. Printed at up to 160 × 48 pt, this is about 270 dpi. */
export const DOCUMENT_LOGO_MAX = { width: 600, height: 200 } as const;

/** Scale `w × h` down to fit inside `max`, keeping its shape. Never enlarges; at least 1 px each way. */
export function fitWithin(w: number, h: number, max: { width: number; height: number } = DOCUMENT_LOGO_MAX): { width: number; height: number } | null {
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const s = Math.min(1, max.width / w, max.height / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Which encoding to keep: PNG (keeps transparency) when it fits under the upload cap, otherwise JPEG
 * on a white background, otherwise nothing fits and the person needs a simpler image.
 */
export function pickEncoding(pngChars: number, jpegChars: number | null, max: number = DOCUMENT_LOGO_MAX_CHARS): 'png' | 'jpeg' | 'too_large' {
  if (pngChars <= max) return 'png';
  if (jpegChars != null && jpegChars <= max) return 'jpeg';
  return 'too_large';
}

/** Image types the picker accepts; everything is re-encoded to PNG or JPEG for PDFs. */
export const DOCUMENT_LOGO_TYPES = /^image\/(png|jpeg|webp|svg\+xml)$/;
