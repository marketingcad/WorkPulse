'use client';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Calculator, CornerDownRight, Plus, X } from 'lucide-react';
import { Button, Field, IconButton, Input, SegmentedControl, cx, fmtMoney } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { asHm } from '@/lib/duration';
import { convertHours, payFor, shiftSeconds, totalShiftSeconds, type Shift } from './math';
import { clampToViewport, isDrag, panelPosition, parseSavedPosition, type Point, type Size } from './position';

type Mode = 'hours' | 'pay' | 'convert';
const EMPTY_SHIFT: Shift = { start: '', end: '', breakText: '' };
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
  const [shifts, setShifts] = useState<Shift[]>([EMPTY_SHIFT]);
  const [pay, setPay] = useState({ hours: '', payRate: '', billRate: '' });
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
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mode]);

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

  const useTotalInPay = () => {
    setPay((p) => ({ ...p, hours: asHm(totalShiftSeconds(shifts)) }));
    setMode('pay');
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
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
            <SegmentedControl
              label="What to work out"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'hours', label: 'Hours' },
                { value: 'pay', label: 'Pay' },
                { value: 'convert', label: 'Convert' },
              ]}
            />
            {mode === 'hours' && <HoursCalc shifts={shifts} onChange={setShifts} onUseInPay={useTotalInPay} />}
            {mode === 'pay' && <PayCalc value={pay} onChange={setPay} />}
            {mode === 'convert' && <ConvertCalc value={convert} onChange={setConvert} />}
          </div>
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

function Result({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cx('tabular-nums', strong ? 'text-base font-semibold text-text' : 'text-sm text-text', tone === 'danger' && 'text-danger')}>{value}</dd>
    </div>
  );
}

function HoursCalc({ shifts, onChange, onUseInPay }: { shifts: Shift[]; onChange: (s: Shift[]) => void; onUseInPay: () => void }) {
  const set = (i: number, patch: Partial<Shift>) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const total = totalShiftSeconds(shifts);
  return (
    <div className="flex flex-col gap-3">
      {shifts.map((s, i) => {
        const r = shiftSeconds(s);
        const err = r.kind === 'error' ? r : null;
        const n = shifts.length > 1 ? ` ${i + 1}` : '';
        return (
          <fieldset key={i} aria-label={`Shift${n}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">Shift{n}</span>
              {shifts.length > 1 && (
                <IconButton label={`Remove shift${n}`} size="xs" onClick={() => onChange(shifts.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </IconButton>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start" htmlFor={`calc-start-${i}`}>
                <Input id={`calc-start-${i}`} type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} aria-invalid={err?.field === 'start'} />
              </Field>
              <Field label="End" htmlFor={`calc-end-${i}`}>
                <Input id={`calc-end-${i}`} type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} aria-invalid={err?.field === 'end'} />
              </Field>
              <Field label="Break" htmlFor={`calc-break-${i}`}>
                <Input id={`calc-break-${i}`} inputMode="decimal" placeholder="0:30" value={s.breakText} onChange={(e) => set(i, { breakText: e.target.value })} aria-invalid={err?.field === 'break'} />
              </Field>
            </div>
            {err ? (
              <p role="alert" className="text-xs text-danger">
                {err.message}
              </p>
            ) : r.kind === 'ok' ? (
              <p className="text-xs text-text-muted">
                <span className="tabular-nums font-semibold text-text">{asHm(r.seconds)}</span> worked{r.overnight ? ', past midnight' : ''}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...shifts, EMPTY_SHIFT])} className="self-start">
        Add shift
      </Button>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Total worked" value={asHm(total)} strong />
        <Result label="In decimal hours" value={(total / 3600).toFixed(2)} />
      </dl>
      <Button size="sm" variant="secondary" disabled={total === 0} onClick={onUseInPay}>
        Work out pay for these hours
      </Button>
    </div>
  );
}

function PayCalc({ value, onChange }: { value: { hours: string; payRate: string; billRate: string }; onChange: (v: { hours: string; payRate: string; billRate: string }) => void }) {
  const org = useOrg();
  const cur = org.organization.currency;
  const r = payFor(value);
  const money = (m: number | null) => (m === null ? '—' : fmtMoney(m, cur));
  return (
    <div className="flex flex-col gap-3">
      <Field label="Hours" htmlFor="calc-pay-hours" error={r.errors.hours} hint="7:30, 7h 30m or 7.5">
        <Input id="calc-pay-hours" inputMode="decimal" placeholder="7:30" value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value })} aria-invalid={!!r.errors.hours} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Pay rate per hour (${cur})`} htmlFor="calc-pay-rate" error={r.errors.payRate}>
          <Input id="calc-pay-rate" inputMode="decimal" placeholder="25.00" value={value.payRate} onChange={(e) => onChange({ ...value, payRate: e.target.value })} aria-invalid={!!r.errors.payRate} />
        </Field>
        <Field label={`Bill rate per hour (${cur})`} htmlFor="calc-bill-rate" error={r.errors.billRate}>
          <Input id="calc-bill-rate" inputMode="decimal" placeholder="60.00" value={value.billRate} onChange={(e) => onChange({ ...value, billRate: e.target.value })} aria-invalid={!!r.errors.billRate} />
        </Field>
      </div>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Pay" value={money(r.payMinor)} strong />
        <Result label="Bill" value={money(r.billMinor)} />
        <Result label="Margin" value={money(r.marginMinor)} tone={r.marginMinor !== null && r.marginMinor < 0 ? 'danger' : undefined} />
      </dl>
      <p className="text-xs text-text-faint">Rounded to the cent like payroll. Payroll rounds each time entry, so a real pay run can differ by a few cents. WorkPulse adds no overtime premium.</p>
    </div>
  );
}

function ConvertCalc({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const r = convertHours(value);
  return (
    <div className="flex flex-col gap-3">
      <Field label="Hours" htmlFor="calc-convert" error={r.kind === 'error' ? r.message : null} hint="Type 7:45, 7h 45m, 7.75 or 465m">
        <Input id="calc-convert" inputMode="decimal" placeholder="7:45" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={r.kind === 'error'} />
      </Field>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Hours and minutes" value={r.kind === 'ok' ? r.hm : '—'} strong />
        <Result label="Decimal hours" value={r.kind === 'ok' ? r.decimal : '—'} />
        <Result label="Minutes" value={r.kind === 'ok' ? String(r.minutes) : '—'} />
      </dl>
    </div>
  );
}
