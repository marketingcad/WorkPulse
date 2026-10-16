'use client';
import type { ReactNode } from 'react';
import { AlertTriangle, CircleCheck, CircleDashed, CircleDot, CircleX, Clock, Inbox, Lock, MinusCircle, PauseCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { cx } from './primitives';
import { t } from './i18n';

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

/** Status always pairs colour with an icon and text. `label` is a message key. */
const STATUS_MAP: Record<string, { tone: Tone; icon: ReactNode; label?: string }> = {
  ACTIVE: { tone: 'success', icon: <CircleDot className="size-3" /> },
  WORKING: { tone: 'success', icon: <CircleDot className="size-3" />, label: 'status.WORKING' },
  TRACKING: { tone: 'success', icon: <CircleDot className="size-3" />, label: 'status.TRACKING' },
  APPROVED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  PAID: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  PRESENT: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  SUCCEEDED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  DONE: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  REIMBURSED: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  healthy: { tone: 'success', icon: <CircleCheck className="size-3" />, label: 'status.healthy' },
  KEPT: { tone: 'success', icon: <CircleCheck className="size-3" /> },
  SUBMITTED: { tone: 'warning', icon: <Clock className="size-3" /> },
  PENDING: { tone: 'warning', icon: <Clock className="size-3" /> },
  IDLE: { tone: 'warning', icon: <PauseCircle className="size-3" />, label: 'status.IDLE' },
  PAUSED: { tone: 'warning', icon: <PauseCircle className="size-3" /> },
  LATE: { tone: 'warning', icon: <AlertTriangle className="size-3" /> },
  PARTIALLY_PAID: { tone: 'warning', icon: <Clock className="size-3" />, label: 'status.PARTIALLY_PAID' },
  warning: { tone: 'warning', icon: <AlertTriangle className="size-3" />, label: 'status.warning' },
  INTERRUPTED: { tone: 'warning', icon: <AlertTriangle className="size-3" /> },
  IN_PROGRESS: { tone: 'info', icon: <CircleDashed className="size-3" />, label: 'status.IN_PROGRESS' },
  SENT: { tone: 'info', icon: <Clock className="size-3" /> },
  FINALIZED: { tone: 'info', icon: <CircleCheck className="size-3" /> },
  INVITED: { tone: 'info', icon: <Clock className="size-3" /> },
  ON_LEAVE: { tone: 'info', icon: <MinusCircle className="size-3" />, label: 'status.ON_LEAVE' },
  HOLIDAY: { tone: 'info', icon: <MinusCircle className="size-3" /> },
  MANUAL: { tone: 'info', icon: <Clock className="size-3" /> },
  WEB: { tone: 'info', icon: <CircleDot className="size-3" />, label: 'status.WEB' },
  DESKTOP: { tone: 'secondary', icon: <CircleDot className="size-3" />, label: 'status.DESKTOP' },
  REJECTED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  OVERDUE: { tone: 'danger', icon: <AlertTriangle className="size-3" /> },
  ABSENT: { tone: 'danger', icon: <CircleX className="size-3" /> },
  REVOKED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  FAILED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  DEAD: { tone: 'danger', icon: <CircleX className="size-3" /> },
  exceeded: { tone: 'danger', icon: <AlertTriangle className="size-3" />, label: 'status.exceeded' },
  DISCARDED: { tone: 'danger', icon: <CircleX className="size-3" /> },
  SUSPENDED: { tone: 'danger', icon: <Lock className="size-3" /> },
  OFFLINE: { tone: 'neutral', icon: <MinusCircle className="size-3" />, label: 'status.OFFLINE' },
  STOPPED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  DRAFT: { tone: 'neutral', icon: <CircleDashed className="size-3" /> },
  TODO: { tone: 'neutral', icon: <CircleDashed className="size-3" />, label: 'status.TODO' },
  VOID: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  CANCELLED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  ARCHIVED: { tone: 'neutral', icon: <MinusCircle className="size-3" /> },
  NOT_SUBMITTED: { tone: 'neutral', icon: <CircleDashed className="size-3" />, label: 'status.NOT_SUBMITTED' },
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
      {label ?? (m.label ? t(m.label) : humanize(status))}
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
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: `hsl(${h} 50% 32%)` }}
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
      {status === 'WORKING' ? t('worker.working') : status === 'IDLE' ? t('worker.idle') : t('worker.offline')}
    </span>
  );
}

/** Activity bar: total %, keyboard vs mouse split. Single-hue ramp. */
export function ActivityBar({ pct, keyboardPct, mousePct, className, showLabel = true }: { pct: number | null; keyboardPct?: number; mousePct?: number; className?: string; showLabel?: boolean }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-text-faint">—</span>;
  const tone = pct < 25 ? 'bg-act-2' : pct < 50 ? 'bg-act-3' : pct < 75 ? 'bg-act-4' : 'bg-act-5';
  return (
    <span className={cx('inline-flex items-center gap-2', className)} title={keyboardPct !== undefined ? t('activity.split', { keyboard: keyboardPct, mouse: mousePct ?? '' }) : undefined}>
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
    <span className={cx('relative block h-1.5 w-full overflow-visible rounded-full bg-surface-sunken', className)} role="meter" aria-label={t('budget.used', { pct: Math.round(pct) })} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cx('absolute inset-y-0 left-0 rounded-full', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      {projectedPct != null && projectedPct > 0 && <span className="absolute -top-0.5 h-2.5 w-px bg-text-muted" style={{ left: `${Math.min(100, projectedPct)}%` }} title={t('budget.projected', { pct: Math.round(projectedPct) })} />}
    </span>
  );
}

export function Panel({ title, actions, children, className, bodyClassName, footer }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; footer?: ReactNode }) {
  return (
    <section className={cx('flex min-w-0 flex-col rounded-md border border-border bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-2.5">
          {typeof title === 'string' ? <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2> : title}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx('min-w-0 flex-1', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-border px-5 py-2.5 text-xs text-text-muted">{footer}</footer>}
    </section>
  );
}

export interface Kpi {
  label: string;
  value: ReactNode;
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean } | null;
  hint?: ReactNode;
  /** A small icon shown in a coloured tile next to the label. */
  icon?: ReactNode;
  tone?: KpiTone;
}

export type KpiTone = 'blue' | 'violet' | 'green' | 'amber' | 'rose' | 'teal';
/** Solid tiles for KPI icons, as on the sign-in page (white icon on a brand colour). */
const KPI_TONE: Record<KpiTone, string> = {
  blue: 'bg-[#1766ff]',
  violet: 'bg-[#6d4cf5]',
  green: 'bg-[#0f9f6e]',
  amber: 'bg-[#e08a00]',
  rose: 'bg-[#e0446a]',
  teal: 'bg-[#0e98b3]',
};

/** Coloured square holding a white icon (KPI tiles, feature lists). */
export function IconTile({ tone = 'blue', children, className }: { tone?: KpiTone; children: ReactNode; className?: string }) {
  return <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-sm text-white shadow-sm [&_svg]:size-[18px]', KPI_TONE[tone], className)} aria-hidden>{children}</span>;
}

/** `minItemWidth` sets how wide a tile may get before the strip wraps (wider = fewer per row). */
export function KpiStrip({ items, className, minItemWidth = 210 }: { items: Kpi[]; className?: string; minItemWidth?: number }) {
  return (
    <div className={cx('grid divide-y divide-border overflow-hidden rounded-md border border-border bg-surface shadow-card sm:divide-x sm:divide-y-0', className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minItemWidth}px), 1fr))` }}>
      {items.map((k) => (
        <div key={k.label} className="flex items-start gap-3 px-5 py-4">
          {k.icon && <IconTile tone={k.tone}>{k.icon}</IconTile>}
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-muted">{k.label}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="tabular text-xl font-bold tracking-tight sm:text-2xl">{k.value}</span>
              {k.delta && (
                <span
                  className={cx(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold',
                    k.delta.direction === 'flat' ? 'bg-surface-muted text-text-muted' : k.delta.good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                  )}
                >
                  {k.delta.direction === 'up' ? <TrendingUp className="size-3" aria-hidden /> : k.delta.direction === 'down' ? <TrendingDown className="size-3" aria-hidden /> : null}
                  {k.delta.value}
                </span>
              )}
            </div>
            {k.hint && <div className="mt-1 text-xs text-text-faint">{k.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <span className="mb-1 flex size-11 items-center justify-center rounded-md bg-interactive-soft text-interactive">{icon ?? <Inbox className="size-5" />}</span>
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
      <p className="text-sm font-semibold">{e?.title ?? e?.message ?? t('state.error')}</p>
      {e?.request_id && <p className="font-mono text-2xs text-text-faint">{t('state.requestId', { id: e.request_id })}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-1 text-sm font-medium text-interactive hover:underline">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function PermissionState({ message = t('state.noAccessArea') }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-text-faint">
        <Lock className="size-5" />
      </span>
      <p className="text-sm font-semibold">{t('state.restricted')}</p>
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label={t('common.loading')}>
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

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tabular truncate text-sm font-medium">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-text-muted">{hint}</dd>}
    </div>
  );
}
