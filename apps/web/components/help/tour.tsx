'use client';
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@tallywork/contracts';
import { api } from '@/lib/api';
import type { TourStep } from './tour-steps';

// The card and the steps load when a tour starts: most visits never show it.
const loadView = () => import('./tour-view');
const TourStepView = lazy(() => loadView().then((m) => ({ default: m.TourStepView })));

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
    void loadView().then((m) => {
      setSteps(m.visibleSteps(m.TOUR_STEPS, onScreen));
      setIndex(0);
    });
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
      {steps && steps[index] && (
        <Suspense fallback={null}>
          <TourStepView step={steps[index]!} index={index} total={steps.length} onPrev={() => setIndex((i) => Math.max(0, i - 1))} onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : end())} onSkip={end} />
        </Suspense>
      )}
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

