'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@tallywork/ui';
import { placeCard, type Box, type TourStep } from './tour-steps';

/** The tour card and highlight, loaded when a tour starts (see tour.tsx). */
export { TOUR_STEPS, visibleSteps } from './tour-steps';

const el = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);

export function TourStepView({ step, index, total, onPrev, onNext, onSkip }: { step: TourStep; index: number; total: number; onPrev: () => void; onNext: () => void; onSkip: () => void }) {
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
