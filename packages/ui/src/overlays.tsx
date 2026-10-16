'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import * as SW from '@radix-ui/react-switch';
import * as T from '@radix-ui/react-tabs';
import * as TT from '@radix-ui/react-tooltip';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { Button, cx } from './primitives';
import { t } from './i18n';

// ─── Dialog ──────────────────────────────────────────────────────────────────
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 480 }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[rgb(10_18_32/0.45)] data-[state=open]:animate-[fade_120ms_ease-out]" />
        <D.Content
          className="fixed left-1/2 top-[10vh] z-50 flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-lg border border-border bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-[pop_140ms_ease-out]"
          style={{ maxWidth: width }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-sm p-1 text-text-muted hover:bg-surface-muted hover:text-text" aria-label={t('common.close')}>
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Right-hand detail drawer; full screen on mobile. */
export function Drawer({ open, onOpenChange, title, subtitle, children, actions, width = 480 }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; width?: number }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(10_18_32/0.25)]" />
        <D.Content className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-[slide_160ms_ease-out]" style={{ maxWidth: width }}>
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <D.Title className="truncate text-lg font-semibold">{title}</D.Title>
              {subtitle ? <D.Description className="truncate text-sm text-text-muted">{subtitle}</D.Description> : <D.Description className="sr-only">{t('common.details')}</D.Description>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <D.Close className="rounded-sm p-1.5 text-text-muted hover:bg-surface-muted hover:text-text" aria-label={t('common.close')}>
                <X className="size-4" />
              </D.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = t('common.confirm'), danger, onConfirm, loading }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; loading?: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={420}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text-muted">{description}</div>
    </Dialog>
  );
}

// ─── Menu ────────────────────────────────────────────────────────────────────
export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={4} className="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-overlay">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, danger, icon, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx('flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-surface-muted data-[disabled]:opacity-50', danger && 'text-danger')}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-text-faint">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

// ─── Popover / Tooltip / Switch / Tabs ───────────────────────────────────────
export function Popover({ trigger, children, align = 'start', className }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={4} className={cx('z-50 rounded-md border border-border bg-surface p-3 shadow-overlay focus:outline-none', className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TT.Provider delayDuration={300}>
      <TT.Root>
        <TT.Trigger asChild>{children}</TT.Trigger>
        <TT.Portal>
          <TT.Content sideOffset={4} className="z-50 max-w-64 rounded-sm bg-[#0b1a3a] px-2.5 py-1.5 text-xs text-white shadow-overlay">
            {content}
          </TT.Content>
        </TT.Portal>
      </TT.Root>
    </TT.Provider>
  );
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={cx('flex items-start justify-between gap-4', disabled ? 'opacity-60' : 'cursor-pointer')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {description && <span className="block text-xs text-text-muted">{description}</span>}
        </span>
      )}
      <SW.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors data-[state=checked]:bg-interactive">
        <SW.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SW.Root>
    </label>
  );
}

const TAB_CLASS =
  'relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-text-muted hover:text-text data-[state=active]:border-interactive data-[state=active]:text-text';

/**
 * Section tabs. With children, the children are the selected tab's panel (real tab semantics).
 * Without children the tabs only switch a filter on content shown elsewhere, so they render as
 * toggle buttons (aria-pressed): a tab would have to point at a panel that does not exist.
 */
export function Tabs({ value, onValueChange, items, children, className }: { value: string; onValueChange: (v: string) => void; items: Array<{ value: string; label: ReactNode; count?: number }>; children?: ReactNode; className?: string }) {
  const count = (i: { count?: number }) => i.count !== undefined && <span className="tabular rounded-full bg-surface-muted px-1.5 text-2xs text-text-muted">{i.count}</span>;
  if (children === undefined || children === null) {
    return (
      <div role="group" aria-label={t('common.sections')} className={cx('scrollbar-none flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]', className)}>
        {items.map((i) => (
          <button key={i.value} type="button" aria-pressed={i.value === value} data-state={i.value === value ? 'active' : 'inactive'} onClick={() => onValueChange(i.value)} className={TAB_CLASS}>
            {i.label}
            {count(i)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <T.Root value={value} onValueChange={onValueChange} className={className}>
      <T.List className="scrollbar-none flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]" aria-label={t('common.sections')}>
        {items.map((i) => (
          <T.Trigger
            key={i.value}
            value={i.value}
            className={TAB_CLASS}
          >
            {i.label}
            {count(i)}
          </T.Trigger>
        ))}
      </T.List>
      <T.Content value={value} tabIndex={-1} className="focus:outline-none">
        {children}
      </T.Content>
    </T.Root>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, size = 'sm', label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; size?: 'xs' | 'sm'; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-sm border border-border bg-surface-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-[6px] px-2.5 font-medium transition-colors', size === 'xs' ? 'h-6 text-xs' : 'h-7 text-sm', value === o.value ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────
interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.action ? 6000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm shadow-overlay animate-[pop_140ms_ease-out]">
            {t.kind === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            <div className="min-w-0 flex-1">{t.message}</div>
            {t.action && (
              <button className="shrink-0 font-medium text-interactive hover:underline" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (message: ReactNode, action?: ToastItem['action']) => push({ kind: 'success', message, action }),
    error: (message: ReactNode) => push({ kind: 'error', message }),
    info: (message: ReactNode) => push({ kind: 'info', message }),
  };
}
