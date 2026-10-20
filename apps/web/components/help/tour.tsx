'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@tallywork/contracts';
import { Button } from '@tallywork/ui';
import { api } from '@/lib/api';
import { TOUR_STEPS, placeCard, visibleSteps, type Box, type TourStep } from './tour-steps';

/**
 * The product tour: highlights one part of the app at a time with a short explanation. It starts
 * on its own once for a first-time user (on the Overview, after it has loaded), can be restarted
 * from Help, and remembers on the person's account when it was finished or skipped.
 */
interface TourApi {
  start: () => void;
  active: boolean;
}
const TourContext = createContext<TourApi>({ start: () => undefined, active: false });
export const useTour = () => useContext(TourContext);

const el = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
const onScreen = (target: string) => {
  const e = el(target);
  if (!e || e.closest('[inert]')) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
};

export function TourProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);

  const start = useCallback(() => {
    setSteps(visibleSteps(TOUR_STEPS, onScreen));
    setIndex(0);
  }, []);
  // Finished or skipped: remember it on the account, so it never starts again on its own.
  const end = useCallback(() => {
    setSteps(null);
    void api<MeDto>('/me', { method: 'PATCH', body: { tour: 'done' } })
      .then((me) => qc.setQueryData(['me'], me))
      .catch(() => undefined);
  }, [qc]);

  return (
    <TourContext.Provider value={{ start, active: !!steps }}>
      {children}
      {steps && steps[index] && <TourStepView step={steps[index]!} index={index} total={steps.length} onPrev={() => setIndex((i) => Math.max(0, i - 1))} onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : end())} onSkip={end} />}
    </TourContext.Provider>
  );
}

/**
 * Start the tour on its own for someone who has not seen it, once `ready` (the page's content has
 * loaded), or when the page was opened with `?tour=1` (Restart from Help).
 */
export function useAutoTour(ready: boolean) {
  const { start, active } = useTour();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') }).data;
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !me || started.current || active) return;
    const asked = new URLSearchParams(window.location.search).get('tour') === '1';
    if (!asked && me.user.tour_done) return;
    started.current = true;
    if (asked) window.history.replaceState(null, '', window.location.pathname);
    // Let the page finish laying out before measuring what to highlight.
    const t = window.setTimeout(start, 300);
    return () => window.clearTimeout(t);
  }, [ready, me, active, start]);
}

function TourStepView({ step, index, total, onPrev, onNext, onSkip }: { step: TourStep; index: number; total: number; onPrev: () => void; onNext: () => void; onSkip: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const last = index === total - 1;

  // Measure the highlighted element (scrolled into view) and place the card next to it.
  const measure = useCallback(() => {
    const target = step.target ? el(step.target) : null;
    const r = target?.getBoundingClientRect();
    const b = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    setBox(b);
    const c = card.current?.getBoundingClientRect();
    const p = placeCard(b, { width: c?.width ?? 320, height: c?.height ?? 180 }, { width: window.innerWidth, height: window.innerHeight });
    setPos({ top: p.top, left: p.left });
  }, [step.target]);

  useLayoutEffect(() => {
    if (step.target) el(step.target)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    next.current?.focus();
  }, [step, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Keep keyboard focus inside the card while the page behind it is blocked.
        const items = [...(card.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]!.focus();
      } else if (e.key === 'Escape') onSkip();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'ArrowLeft' && index > 0) onPrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, onNext, onPrev, onSkip]);

  const pad = 6;
  return (
    <div className="fixed inset-0 z-[60]" data-testid="product-tour">
      {/* Blocks the page while the tour runs; the dimming comes from the highlight's shadow (or this layer for a centred step). */}
      <div className={box ? 'absolute inset-0' : 'absolute inset-0 bg-[rgb(15_23_42/0.55)]'} aria-hidden />
      {box && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md transition-all duration-150 motion-reduce:transition-none"
          // White outline + blue glow: visible on the dark sidebar and on the light page alike.
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, outline: '2px solid #fff', boxShadow: '0 0 0 5px rgb(59 130 255 / 0.85), 0 0 0 9999px rgb(15 23 42 / 0.55)' }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute w-[min(320px,calc(100vw-24px))] rounded-md border border-border bg-surface p-4 text-text shadow-overlay"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      >
        <p className="tabular text-2xs font-semibold uppercase tracking-wider text-text-muted">
          Step {index + 1} of {total}
        </p>
        <h2 id="tour-title" className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1 text-sm text-text-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip tour
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button size="sm" onClick={onPrev}>
                Previous
              </Button>
            )}
            <Button ref={next} size="sm" variant="primary" onClick={onNext}>
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
