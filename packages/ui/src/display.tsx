'use client';
import type { ReactNode } from 'react';
import { AlertTriangle, CircleCheck, CircleDashed, CircleDot, CircleX, Clock, Inbox, Lock, MinusCircle, PauseCircle } from 'lucide-react';
import { cx } from './primitives';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'secondary';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-text-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  brand: 'bg-interactive-soft text-interactive',
  secondary: 'bg-secondary-soft text-secondary',
};

/** Status always pairs colour with an icon and text. */
const STATUS_MAP: Record<string, { tone: Tone; icon: ReactNode; label?: string }> = {
  ACTIVE: { tone: 'success', icon: <CircleDot className="size-3" /> },
  WORKING: { tone: 'success', icon: <CircleDot className="size-3" />, label: 'Working' },
  TRACKING: { tone: 'success', icon: <CircleDot className="size-3" />, label: 'Tracking' },
  APPROVED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  PAID: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  PRESENT: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  SUCCEEDED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  DONE: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  REIMBURSED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  healthy: { tone: 'success', icon: <CircleCheck className="size-3" />, label: 'Healthy' },
  KEPT: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  SUBMITTED: { tone: 'warning', icon: <Clock className="size-3" /> },
  PENDING: { tone: 'warning', icon: <Clock className="size-3" /> },
  IDLE: { tone: 'warning', icon: <PauseCircle className="size-3" />, label: 'Idle' },
  PAUSED: { tone: 'warning', icon: <PauseCircle className="size-3" /> },
  LATE: { tone: 'warning', icon: <AlertTriangle className="size-3" /> },
  PARTIALLY_PAID: { tone: 'warning', icon: <Clock className="size-3" />, label: 'Partially paid' },
  warning: { tone: 'warning', icon: <AlertTriangle className="size-3" />, label: 'Warning' },
  INTERRUPTED: { tone: 'warning', icon: <AlertTriangle className="size-3" /> },
  IN_PROGRESS: { tone: 'info', icon: <CircleDashed className="size-3" />, label: 'In progress' },
  SENT: { tone: 'info', icon: <Clock className="size-3" /> },
  INVITED: { tone: 'info', icon: <Clock className="size-3" /> },
  ON_LEAVE: { tone: 'info', icon: <MinusCircle className="size-3" />, label: 'On leave' },
  HOLIDAY: { tone: 'info', icon: <MinusCircle className="size-3" /> },
  MANUAL: { tone: 'info', icon: <Clock className="size-3" /> },
  WEB: { tone: 'info', icon: <CircleDot className="size-3" />, label: 'Web' },
  DESKTOP: { tone: 'secondary', icon: <CircleDot className="size-3" />, label: 'Desktop' },
  REJECTED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  OVERDUE: { tone: 'danger', icon: <AlertTriangle className="size-3" /> },
  ABSENT: { tone: 'danger', icon: <CircleX className="size-3" /> },
  REVOKED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  FAILED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  DEAD: { tone: 'danger', icon: <CircleX className="size-3" /> },
  exceeded: { tone: 'danger', icon: <AlertTriangle className="size-3" />, label: 'Exceeded' },
  DISCARDED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  SUSPENDED: { tone: 'danger', icon: <Lock className="size-3" /> },
  OFFLINE: { tone: 'neutral', icon: <MinusCircle className="size-3" />, label: 'Offline' },
  STOPPED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  DRAFT: { tone: 'neutral', icon: <CircleDashed className="size-3" /> },
  TODO: { tone: 'neutral', icon: <CircleDashed className="size-3" />, label: 'To do' },
  VOID: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  CANCELLED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  ARCHIVED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  NOT_SUBMITTED: { tone: 'neutral', icon: <CircleDashed className="size-3" />, label: 'Not submitted' },
};

export function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-2xs font-medium', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const m: { tone: Tone; icon: ReactNode; label?: string } = STATUS_MAP[status] ?? { tone: 'neutral', icon: <CircleDashed className="size-3" /> };
  return (
    <Badge tone={m.tone} icon={m.icon} className={className}>
      {label ?? m.label ?? humanize(status)}
    </Badge>
  );
}

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  // Stable hue per name so people are recognizable across screens.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `hsl(${h} 42% 42%)` }}
    >
      {initials || '?'}
    </span>
  );
}

export function PersonCell({ name, sub, size = 24 }: { name: string; sub?: ReactNode; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        {sub && <span className="block truncate text-xs text-text-muted">{sub}</span>}
      </span>
    </span>
  );
}

/** Live worker status dot + label. */
export function WorkerStatus({ status }: { status: 'WORKING' | 'IDLE' | 'OFFLINE' }) {
  const cls = status === 'WORKING' ? 'bg-success' : status === 'IDLE' ? 'bg-warning' : 'bg-text-faint';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <span className={cx('relative inline-flex size-2 rounded-full', cls)}>
        {status === 'WORKING' && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-40" />}
      </span>
      {status === 'WORKING' ? 'Working' : status === 'IDLE' ? 'Idle' : 'Offline'}
    </span>
  );
}

/** Activity bar: total %, keyboard vs mouse split. Single-hue ramp. */
export function ActivityBar({ pct, keyboardPct, mousePct, className, showLabel = true }: { pct: number | null; keyboardPct?: number; mousePct?: number; className?: string; showLabel?: boolean }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-text-faint">—</span>;
  const tone = pct < 25 ? 'bg-act-2' : pct < 50 ? 'bg-act-3' : pct < 75 ? 'bg-act-4' : 'bg-act-5';
  return (
    <span className={cx('inline-flex items-center gap-2', className)} title={keyboardPct !== undefined ? `Keyboard ${keyboardPct}% · Mouse ${mousePct}%` : undefined}>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className={cx('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      {showLabel && <span className="tabular text-xs text-text-muted">{pct}%</span>}
    </span>
  );
}

export function BudgetProgress({ pct, state, projectedPct, className }: { pct: number; state: 'healthy' | 'warning' | 'exceeded'; projectedPct?: number | null; className?: string }) {
  const color = state === 'exceeded' ? 'bg-danger' : state === 'warning' ? 'bg-warning' : 'bg-success';
  return (
    <span className={cx('relative block h-1.5 w-full overflow-visible rounded-full bg-surface-sunken', className)} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cx('absolute inset-y-0 left-0 rounded-full', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      {projectedPct != null && projectedPct > 0 && <span className="absolute -top-0.5 h-2.5 w-px bg-text-muted" style={{ left: `${Math.min(100, projectedPct)}%` }} title={`Projected ${Math.round(projectedPct)}%`} />}
    </span>
  );
}

export function Panel({ title, actions, children, className, bodyClassName, footer }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; footer?: ReactNode }) {
  return (
    <section className={cx('flex min-w-0 flex-col rounded-md border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-2">
          {typeof title === 'string' ? <h2 className="truncate text-sm font-semibold">{title}</h2> : title}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx('min-w-0 flex-1', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-border px-4 py-2 text-xs text-text-muted">{footer}</footer>}
    </section>
  );
}

export interface Kpi {
  label: string;
  value: ReactNode;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean } | null;
  hint?: ReactNode;
}

export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  return (
    <div className={cx('grid divide-y divide-border overflow-hidden rounded-md border border-border bg-surface sm:divide-x sm:divide-y-0', className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {items.map((k) => (
        <div key={k.label} className="px-4 py-3">
          <div className="text-xs font-medium text-text-muted">{k.label}</div>
          <div className="tabular mt-1 text-xl font-semibold tracking-tight">{k.value}</div>
          {(k.delta || k.hint) && (
            <div className="mt-0.5 text-xs text-text-faint">
              {k.delta && (
                <span className={cx(k.delta.direction === 'flat' ? 'text-text-faint' : k.delta.good ? 'text-success' : 'text-danger')}>
                  {k.delta.direction === 'up' ? '▲' : k.delta.direction === 'down' ? '▼' : '■'} {k.delta.value}
                </span>
              )}{' '}
              {k.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-muted text-text-faint">{icon ?? <Inbox className="size-5" />}</span>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { title?: string; message?: string; request_id?: string; status?: number };
  if (e?.status === 403) return <PermissionState />;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </span>
      <p className="text-sm font-semibold">{e?.title ?? e?.message ?? 'Something went wrong'}</p>
      {e?.request_id && <p className="font-mono text-2xs text-text-faint">Request {e.request_id}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-1 text-sm font-medium text-interactive hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function PermissionState({ message = 'You don’t have access to this area.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-text-faint">
        <Lock className="size-5" />
      </span>
      <p className="text-sm font-semibold">Restricted</p>
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-10 items-center gap-4 px-4">
          {Array.from({ length: cols }, (_, c) => (
            <span key={c} className="h-2.5 animate-pulse rounded-full bg-surface-sunken" style={{ width: `${c === 0 ? 22 : 10 + ((r * 7 + c * 13) % 14)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
