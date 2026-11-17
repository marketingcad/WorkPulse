'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@tallywork/ui';
import { DOCUMENT_LOGO_TYPES, fitWithin, pickEncoding } from '@/lib/document-logo';

/** Draws the image at its fitted size and returns a PNG, or a JPEG on white when the PNG is too big. */
function encode(img: HTMLImageElement): { url: string } | { error: string } {
  const size = fitWithin(img.naturalWidth, img.naturalHeight);
  if (!size) return { error: 'That image could not be read' };
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0, size.width, size.height);
  const png = canvas.toDataURL('image/png');
  if (pickEncoding(png.length, null) === 'png') return { url: png };
  // JPEG has no transparency: paint white first so a transparent logo doesn't print on black.
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size.width, size.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.9);
  return pickEncoding(png.length, jpeg.length) === 'jpeg' ? { url: jpeg } : { error: 'This image is too detailed to print. Try a simpler or smaller version of the logo.' };
}

/**
 * The logo printed on invoices and pay stubs. Unlike the square company logo, it is never cropped:
 * wide logos with the company name in them keep their shape. The preview mimics the document header.
 */
export function DocumentLogoEditor({ value, onChange, name, fallback, error }: { value: string; onChange: (v: string) => void; name: string; fallback: string; error?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const shown = value || fallback;

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!DOCUMENT_LOGO_TYPES.test(file.type)) return setPickErr('Use a PNG, JPEG, WebP or SVG image');
    setPickErr(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = encode(img);
      URL.revokeObjectURL(url);
      if ('error' in r) return setPickErr(r.error);
      onChange(r.url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setPickErr('That image could not be read');
    };
    img.src = url;
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id="doc-logo-label" className="text-xs font-medium text-text-muted">
          Logo on documents
        </span>
        <span className="text-xs text-text-muted">Invoices and pay stubs. Not cropped, so wide logos keep their shape.</span>
      </div>
      {/* Paper-white on purpose in both themes: this is how the PDF looks. */}
      <figure aria-labelledby="doc-logo-label" className="m-0 flex min-h-22 items-center gap-3 overflow-hidden rounded-md border border-border bg-white px-4 py-3 text-[#06132a]" data-testid="document-logo-preview">
        {shown ? <img src={shown} alt={value ? 'Logo on documents' : 'Company logo (used on documents)'} className="max-h-18 max-w-60 object-contain" /> : null}
        <figcaption className="min-w-0 truncate text-lg font-bold">{name || 'Your company'}</figcaption>
      </figure>
      {!value && <p className="text-xs text-text-muted">{fallback ? 'No document logo yet: documents use the square company logo.' : 'No logo yet: documents show the company name only.'}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" icon={<Upload className="size-3.5" aria-hidden />} onClick={() => input.current?.click()}>
          {value ? 'Change document logo' : 'Upload document logo'}
        </Button>
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPickErr(null);
              onChange('');
            }}
          >
            Remove document logo
          </Button>
        )}
        <input ref={input} id="org-document-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Document logo file" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      {(pickErr || error) && (
        <p role="alert" className="text-xs text-danger">
          {pickErr ?? error}
        </p>
      )}
    </div>
  );
}
