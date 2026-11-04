import { Check, Minus, ShieldCheck } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { trackingDisclosure } from '../../shared/disclosure';
import { card } from './lib';

/**
 * "What WorkPulse records": the organization's tracking settings for this worker, in plain words,
 * with what is being recorded right now while clocked in. Shown on Home and in Settings.
 */
export function TrackingDisclosure({ s, compact = false }: { s: AgentState; compact?: boolean }) {
  if (!s.policy) return null;
  const items = trackingDisclosure(s.policy, s.capabilities);
  const now = s.recordingNow;
  return (
    <section className={`${card} p-4`} aria-labelledby="disclosure-title">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-interactive" aria-hidden />
        <div className="min-w-0">
          <h2 id="disclosure-title" className="text-sm font-semibold">
            What WorkPulse records
          </h2>
          <p className="text-xs text-text-muted">Set by {s.account?.organization ?? 'your organization'}. Only while you are clocked in: nothing is recorded while you are clocked out, paused or on a break.</p>
        </div>
      </div>
      <ul className={`mt-3 grid gap-2 ${compact ? 'sm:grid-cols-2' : ''}`}>
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${i.on ? 'bg-interactive-soft text-interactive' : 'bg-surface-muted text-text-faint'}`} aria-hidden>
              {i.on ? <Check className="size-3" /> : <Minus className="size-3" />}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{i.label}</span>
              <span className="sr-only">{i.on ? ': recorded.' : ': not recorded.'}</span>
              <span className="block text-xs text-text-muted">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {now && (now.app || now.domain) && (
        <p className="mt-3 rounded-sm bg-surface-muted px-3 py-2 text-xs text-text-muted" aria-live="off">
          Recording now: {[now.app, now.domain].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  );
}
