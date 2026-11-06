'use client';
import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { Calculator, CornerDownRight, X } from 'lucide-react';
import { IconButton, Spinner, cx } from '@tallywork/ui';
import { t } from '@/lib/i18n';
import { clampToViewport, isDrag, panelPosition, parseSavedPosition, type Point, type Size } from './position';
import { INITIAL_STATE, type CalcState } from './state';

/** The panel's body (modes, arithmetic, money formatting) loads the first time the calculator opens. */
const loadPanel = () => import('./calculator-panel').then((m) => m.CalculatorPanel);
const CalculatorPanel = dynamic(loadPanel, {
  loading: () => (
    <div className="flex items-center gap-2 py-6 text-xs text-text-muted">
      <Spinner className="size-4" /> {t('calc.loading')}
    </div>
  ),
});

/** Where the person last left the button, in this browser. */
const POSITION_KEY = 'tw.calculator.position';
const BUTTON: Size = { width: 48, height: 48 };
const KEY_STEP = 24;
const ARROWS: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });
/** The person asked for less motion: the panel appears and disappears without animating. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  /** Open as far as the person is concerned (the button shows X; Escape and clicks act on it). */
  const [open, setOpen] = useState(false);
  /** In the page: true from opening until the closing animation ends. */
  const [mounted, setMounted] = useState(false);
  /** The opening animation has finished (data-state="open"). */
  const [settled, setSettled] = useState(false);
  const [calc, setCalc] = useState<CalcState>(INITIAL_STATE);
  /** Top-left of the button; null keeps it in the bottom-right corner. */
  const [pos, setPos] = useState<Point | null>(null);
  const [panelAt, setPanelAt] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const draggedLauncher = useRef(false);

  const openPanel = () => {
    const still = reducedMotion();
    setOpen(true);
    setMounted(true);
    setSettled(still);
  };
  const close = () => {
    setOpen(false);
    setSettled(false);
    // With reduced motion there is no closing animation to wait for.
    if (reducedMotion()) setMounted(false);
    launcher.current?.focus();
  };
  /** The panel's own animation ended (not one of its children's): finish opening or closing. */
  const onPanelAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (open) setSettled(true);
    else setMounted(false);
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
    // Kept while it closes, so it shrinks back where it is rather than jumping to the corner.
    if (!mounted || !pos || !el) {
      setPanelAt(null);
      return;
    }
    const place = () => setPanelAt(panelPosition(pos, BUTTON, { width: el.offsetWidth, height: el.offsetHeight }, viewport()));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted, pos]);

  // Escape closes the calculator only when the person is in it (its panel or its button), so it never
  // also closes another dialog or menu that happens to be open on the page.
  const onEscape = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    close();
  };

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
    onEscape(e);
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
      {mounted && (
        <div
          ref={panel}
          id="calculator-panel"
          role="dialog"
          aria-label={t('calc.title')}
          // opening → open → closing; tests that measure the panel wait for "open".
          data-state={!open ? 'closing' : settled ? 'open' : 'opening'}
          // A closing panel takes no more clicks or keys.
          inert={!open}
          onKeyDown={onEscape}
          onAnimationEnd={onPanelAnimationEnd}
          style={{
            // It grows out of the button's centre: 24px in from the panel's right edge and 40px below it
            // in the corner; worked out from both positions once the button has been moved.
            transformOrigin: pos ? (panelAt ? `${pos.x + BUTTON.width / 2 - panelAt.x}px ${pos.y + BUTTON.height / 2 - panelAt.y}px` : undefined) : 'calc(100% - 24px) calc(100% + 40px)',
            ...(pos ? { left: panelAt?.x ?? 0, top: panelAt?.y ?? 0, visibility: panelAt ? undefined : 'hidden' } : {}),
          }}
          className={cx(
            'fixed z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-overlay',
            open ? 'animate-[calc-in_200ms_cubic-bezier(0.22,1,0.36,1)]' : 'animate-[calc-out_140ms_ease-in_forwards]',
            'motion-reduce:animate-none',
            pos ? 'max-h-[calc(100dvh-1rem)]' : 'bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)] right-4 max-h-[calc(100dvh-7rem)] sm:right-6',
          )}
        >
          <div {...dragHandlers} className={cx('flex touch-none select-none items-center justify-between gap-2 border-b border-border px-4 py-3', dragging ? 'cursor-grabbing' : 'cursor-grab')}>
            <div>
              <h2 className="text-sm font-semibold text-text">{t('calc.title')}</h2>
              <p className="text-xs text-text-faint">{t('calc.subtitle')}</p>
            </div>
            <div className="flex items-center gap-1">
              {pos && (
                <IconButton label={t('calc.moveToCorner')} onClick={backToCorner}>
                  <CornerDownRight className="size-4" />
                </IconButton>
              )}
              <IconButton label={t('calc.close')} onClick={close}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="overflow-y-auto px-4 py-4">
            <CalculatorPanel state={calc} onChange={setCalc} />
          </div>
        </div>
      )}
      <button
        ref={launcher}
        type="button"
        aria-label={open ? t('calc.close') : t('calc.open')}
        aria-expanded={open}
        aria-controls="calculator-panel"
        aria-describedby="calculator-move-hint"
        {...dragHandlers}
        onKeyDown={onLauncherKey}
        // Start loading the panel as soon as the person reaches for the button, so it opens at once.
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        onClick={() => {
          if (draggedLauncher.current) {
            draggedLauncher.current = false;
            return;
          }
          if (open) close();
          else openPanel();
        }}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cx(
          'fixed z-40 flex size-12 touch-none select-none items-center justify-center rounded-full bg-interactive text-on-accent shadow-overlay hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          dragging ? 'cursor-grabbing' : 'cursor-grab transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100',
          !pos && 'bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:right-6',
        )}
      >
        {/* Keyed so the new icon turns in each time it swaps. */}
        <span key={open ? 'x' : 'calc'} className="flex animate-[calc-icon_200ms_cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none" aria-hidden>
          {open ? <X className="size-5" /> : <Calculator className="size-5" />}
        </span>
      </button>
      <span id="calculator-move-hint" className="sr-only">
        {t('calc.moveHint')}
      </span>
    </>
  );
}
