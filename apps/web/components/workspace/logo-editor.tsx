'use client';
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { DOCUMENT_LANGUAGES } from '@tallywork/contracts';
import { IconButton, cx } from '@tallywork/ui';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'MXN', 'BRL', 'INR', 'PHP', 'SGD', 'ZAR'];
export const LANGUAGES: Array<{ value: (typeof DOCUMENT_LANGUAGES)[number]; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'nl', label: 'Nederlands' },
];

/** A logo in a circle, or the name's initial on `color` when there is none. */
export function LogoAvatar({ name, logo, color, className }: { name: string; logo: string | null; color?: string | null; className?: string }) {
  if (logo) return <img src={logo} alt="" className={cx('shrink-0 rounded-full object-cover', className)} />;
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)} style={{ background: color ?? 'var(--color-text-muted)' }}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

const LOGO_PX = 160;

/**
 * Center-crops to a square at `zoom`, scaled to LOGO_PX. `webp` falls back to PNG where the browser
 * cannot encode WebP; `png` is for logos that are embedded in PDFs.
 */
function renderLogo(img: HTMLImageElement, zoom: number, format: 'webp' | 'png'): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = LOGO_PX;
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, LOGO_PX, LOGO_PX);
  if (format === 'webp') {
    const webp = canvas.toDataURL('image/webp', 0.85);
    if (webp.startsWith('data:image/webp')) return webp;
  }
  return canvas.toDataURL('image/png');
}

export function LogoEditor({
  label,
  value,
  onChange,
  name,
  color,
  error,
  format = 'webp',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  name: string;
  color?: string;
  error?: string | null;
  format?: 'webp' | 'png';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pickErr, setPickErr] = useState<string | null>(null);
  useEffect(() => {
    if (img) onChange(renderLogo(img, zoom, format));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setPickErr('Use a PNG, JPEG or WebP image');
    setPickErr(null);
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      setZoom(1);
      setImg(next);
    };
    next.onerror = () => setPickErr('That image could not be read');
    next.src = url;
  };

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div className="relative">
        <LogoAvatar name={name || '?'} logo={value || null} color={color || null} className="size-32 text-4xl" />
        <span className="absolute right-0 top-0">
          <IconButton label={value ? 'Change logo' : 'Upload logo'} size="xs" onClick={() => input.current?.click()} className="rounded-full border border-border bg-surface">
            <Pencil className="size-3.5" />
          </IconButton>
        </span>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      {img && <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom logo" className="w-32 accent-interactive" />}
      {value && (
        <button
          type="button"
          className="text-xs text-text-muted underline-offset-2 hover:underline"
          onClick={() => {
            setImg(null);
            onChange('');
          }}
        >
          Remove logo
        </button>
      )}
      {(pickErr || error) && (
        <p role="alert" className="max-w-32 text-xs text-danger">
          {pickErr ?? error}
        </p>
      )}
    </div>
  );
}
