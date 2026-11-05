'use client';
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button, Dialog, IconButton } from '@tallywork/ui';
import { t } from '@/lib/i18n';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, initialCrop, moveCrop, sourceRect, zoomCrop, type Crop } from './crop';

/** The square the server stores (it re-encodes whatever it receives to this size). */
const OUTPUT_PX = 512;
const VIEW = 260;

/** The visible square of the picture, at OUTPUT_PX: WebP where the browser can encode it, PNG otherwise. */
async function render(img: HTMLImageElement, crop: Crop): Promise<Blob> {
  const { sx, sy, side } = sourceRect(crop, img.naturalWidth, img.naturalHeight, VIEW);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUTPUT_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_PX, OUTPUT_PX);
  const as = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  const webp = await as('image/webp');
  if (webp?.type === 'image/webp') return webp;
  const png = await as('image/png');
  if (!png) throw new Error(t('avatar.error.read'));
  return png;
}

/**
 * Crop a new profile picture: drag (mouse, touch or pen) or arrow keys to move, the slider, buttons,
 * +/- keys or the wheel to zoom. The circle is what others will see.
 */
export function AvatarEditor({ src, width, height, saving, onCancel, onSave }: { src: string; width: number; height: number; saving: boolean; onCancel: () => void; onSave: (b: Blob) => void }) {
  const [crop, setCrop] = useState<Crop>(() => initialCrop(width, height, VIEW));
  const img = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const move = (dx: number, dy: number) => setCrop((c) => moveCrop(c, dx, dy, width, height, VIEW));
  const zoom = (z: number) => setCrop((c) => zoomCrop(c, z, width, height, VIEW));
  const scale = (VIEW / Math.min(width, height)) * crop.zoom;

  // The wheel zooms (a non-passive listener, so the page does not scroll instead).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop((c) => zoomCrop(c, c.zoom - Math.sign(e.deltaY) * ZOOM_STEP, width, height, VIEW));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, height]);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onCancel()}
      title={t('avatar.editor.title')}
      description={t('avatar.editor.description')}
      width={400}
      footer={
        <>
          <Button onClick={onCancel} disabled={saving}>
            {t('avatar.editor.cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={async () => img.current && onSave(await render(img.current, crop))}>
            {t('avatar.editor.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          ref={area}
          tabIndex={0}
          role="group"
          aria-label={t('avatar.editor.area')}
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-md bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={(e) => {
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            move(e.clientX - d.x, e.clientY - d.y);
            drag.current = { id: d.id, x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 10;
            const keys: Record<string, () => void> = {
              ArrowLeft: () => move(step, 0),
              ArrowRight: () => move(-step, 0),
              ArrowUp: () => move(0, step),
              ArrowDown: () => move(0, -step),
              '+': () => zoom(crop.zoom + ZOOM_STEP),
              '=': () => zoom(crop.zoom + ZOOM_STEP),
              '-': () => zoom(crop.zoom - ZOOM_STEP),
              '0': () => setCrop(initialCrop(width, height, VIEW)),
            };
            const k = keys[e.key];
            if (k) {
              e.preventDefault();
              k();
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, drawn to a canvas */}
          <img ref={img} src={src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: crop.x, top: crop.y, width: width * scale, height: height * scale }} />
          {/* The circle others will see; outside it is dimmed. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-surface" style={{ boxShadow: '0 0 0 999px rgb(10 18 32 / 0.55)' }} />
        </div>

        <div className="flex w-full items-center gap-2">
          <IconButton label={t('avatar.editor.zoomOut')} onClick={() => zoom(crop.zoom - ZOOM_STEP)} disabled={crop.zoom <= MIN_ZOOM}>
            <Minus className="size-3.5" />
          </IconButton>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => zoom(Number(e.target.value))}
            aria-label={t('avatar.editor.zoom')}
            className="h-1.5 flex-1 cursor-pointer accent-[var(--color-interactive)]"
          />
          <IconButton label={t('avatar.editor.zoomIn')} onClick={() => zoom(crop.zoom + ZOOM_STEP)} disabled={crop.zoom >= MAX_ZOOM}>
            <Plus className="size-3.5" />
          </IconButton>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setCrop(initialCrop(width, height, VIEW))}>
            {t('avatar.editor.reset')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
