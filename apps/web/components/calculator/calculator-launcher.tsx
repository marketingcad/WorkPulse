'use client';
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Calculator, CornerDownRight, X } from 'lucide-react';
import { IconButton, cx } from '@tallywork/ui';
import type { PayInput, Shift } from './math';
import type { Mode } from './calculator-body';
import { clampToViewport, isDrag, panelPosition, parseSavedPosition, type Point, type Size } from './position';

// The modes load when the panel first opens, or when the pointer or keyboard reaches the button.
const loadBody = () => import('./calculator-body');
const CalculatorBody = lazy(loadBody);
/** Where the person last left the button, in this browser. */
const POSITION_KEY = 'tw.calculator.position';
const BUTTON: Size = { width: 48, height: 48 };
const KEY_STEP = 24;
const ARROWS: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

function savePosition(p: Point | null) {
  try {
    if (p) localStorage.setItem(POSITION_KEY, JSON.stringify(p));
    else localStorage.removeItem(POSITION_KEY);
  } catch {
    /* storage unavailable: the position lasts until the page is reloaded */
  }
}

/**
 * A calculator for checking hours and pay, opened from a round button on every page. The button (or
 * the panel's header) can be dragged anywhere on the screen, or moved with Alt + arrow keys; it stays
 * fully visible and is remembered in this browser. The calculator only does arithmetic in the browser:
 * it reads and saves no data, so anyone signed in may use it. What was typed stays between pages.
 */
export function CalculatorLauncher() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('hours');
  const [shifts, setShifts] = useState<Shift[]>([{ start: '', end: '', breakText: '' }]);
  const [pay, setPay] = useState<PayInput>({ hours: '', payRate: '', billRate: '' });
  const [convert, setConvert] = useState('');
  /** Top-left of the button; null keeps it in the bottom-right corner. */
  const [pos, setPos] = useState<Point | null>(null);
  const [panelAt, setPanelAt] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const draggedLauncher = useRef(false);

  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };

  useEffect(() => {
    try {
      const saved = parseSavedPosition(localStorage.getItem(POSITION_KEY));
      if (saved) setPos(clampToViewport(saved, BUTTON, viewport()));
    } catch {
      /* storage unavailable: start in the corner */
    }
  }, []);

  // A smaller window (or a phone turned sideways) never leaves the button out of reach.
  const moved = pos !== null;
  useEffect(() => {
    if (!moved) return;
    const onResize = () => setPos((p) => (p ? clampToViewport(p, BUTTON, viewport()) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moved]);

  // The panel opens next to a moved button, where it fits, and follows its height as content changes.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !pos || !el) {
      setPanelAt(null);
      return;
    }
    const place = () => setPanelAt(panelPosition(pos, BUTTON, { width: el.offsetWidth, height: el.offsetHeight }, viewport()));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !launcher.current) return;
    // The panel header's own buttons are clicked, not dragged.
    if (e.currentTarget !== launcher.current && (e.target as HTMLElement).closest('button')) return;
    const r = launcher.current.getBoundingClientRect();
    drag.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, origin: { x: r.left, y: r.top }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragTo = (e: ReactPointerEvent<HTMLElement>): Point | null => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return null;
    const now = { x: e.clientX, y: e.clientY };
    if (!d.moved && !isDrag(d.start, now)) return null;
    d.moved = true;
    return clampToViewport({ x: d.origin.x + now.x - d.start.x, y: d.origin.y + now.y - d.start.y }, BUTTON, viewport());
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const p = dragTo(e);
    if (!p) return;
    setDragging(true);
    setPos(p);
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = d.moved ? dragTo(e) : null;
    drag.current = null;
    setDragging(false);
    if (!p) return;
    setPos(p);
    savePosition(p);
    // A drag that ends on the button is not also a click that opens or closes the panel.
    if (e.currentTarget === launcher.current) draggedLauncher.current = true;
  };
  const cancelDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const dragHandlers = { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: cancelDrag };

  const onLauncherKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const dir = ARROWS[e.key];
    if (!e.altKey || !dir || !launcher.current) return;
    e.preventDefault();
    const r = launcher.current.getBoundingClientRect();
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const p = clampToViewport({ x: r.left + dir.x * step, y: r.top + dir.y * step }, BUTTON, viewport());
    setPos(p);
    savePosition(p);
  };

  const backToCorner = () => {
    setPos(null);
    savePosition(null);
  };

  return (
    <>
      {open && (
        <div
          ref={panel}
          id="calculator-panel"
          role="dialog"
          aria-label="Calculator"
          style={pos ? { left: panelAt?.x ?? 0, top: panelAt?.y ?? 0, visibility: panelAt ? undefined : 'hidden' } : undefined}
          className={cx(
            'fixed z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-overlay',
            pos ? 'max-h-[calc(100dvh-1rem)]' : 'bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)] right-4 max-h-[calc(100dvh-7rem)] sm:right-6',
          )}
        >
          <div {...dragHandlers} className={cx('flex touch-none select-none items-center justify-between gap-2 border-b border-border px-4 py-3', dragging ? 'cursor-grabbing' : 'cursor-grab')}>
            <div>
              <h2 className="text-sm font-semibold text-text">Calculator</h2>
              <p className="text-xs text-text-faint">Check hours and pay. Nothing is saved.</p>
            </div>
            <div className="flex items-center gap-1">
              {pos && (
                <IconButton label="Move to corner" onClick={backToCorner}>
                  <CornerDownRight className="size-4" />
                </IconButton>
              )}
              <IconButton label="Close calculator" onClick={close}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <Suspense fallback={<p className="px-4 py-6 text-sm text-text-muted" role="status">Loading the calculator…</p>}>
            <CalculatorBody mode={mode} onMode={setMode} shifts={shifts} onShifts={setShifts} pay={pay} onPay={setPay} convert={convert} onConvert={setConvert} />
          </Suspense>
        </div>
      )}
      <button
        ref={launcher}
        type="button"
        aria-label={open ? 'Close calculator' : 'Open calculator'}
        aria-expanded={open}
        aria-controls="calculator-panel"
        aria-describedby="calculator-move-hint"
        {...dragHandlers}
        onKeyDown={onLauncherKey}
        onPointerEnter={() => void loadBody()}
        onFocus={() => void loadBody()}
        onClick={() => {
          if (draggedLauncher.current) {
            draggedLauncher.current = false;
            return;
          }
          if (open) close();
          else setOpen(true);
        }}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cx(
          'fixed z-40 flex size-12 touch-none select-none items-center justify-center rounded-full bg-interactive text-on-accent shadow-overlay hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          dragging ? 'cursor-grabbing' : 'cursor-grab transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100',
          !pos && 'bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:right-6',
        )}
      >
        {open ? <X className="size-5" /> : <Calculator className="size-5" />}
      </button>
      <span id="calculator-move-hint" className="sr-only">
        Drag to move it, or press Alt and an arrow key.
      </span>
    </>
  );
}

