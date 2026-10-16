'use client';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { t } from './i18n';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-interactive text-on-accent hover:bg-interactive-hover border border-transparent shadow-button',
  secondary: 'bg-surface text-text border border-border shadow-[0_1px_2px_rgb(15_23_42/0.05)] hover:bg-surface-muted hover:border-border-strong',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-muted hover:text-text border border-transparent',
  danger: 'bg-danger text-on-accent hover:opacity-90 border border-transparent shadow-[0_1px_2px_rgb(0_0_0/0.12)]',
  subtle: 'bg-interactive-soft text-interactive hover:brightness-95 border border-transparent',
};
const SIZE: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1',
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};
/** Icon-only buttons: square, no horizontal padding (a padding class cannot be overridden reliably without class merging). */
const SQUARE: Record<Size, string> = {
  xs: 'size-6 text-xs',
  sm: 'size-8 text-sm',
  md: 'size-10 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  /** square icon-only button (used by IconButton) */
  square?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'sm', loading, icon, className, children, disabled, square, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-sm font-semibold transition-[background-color,border-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        VARIANT[variant],
        square ? SQUARE[size] : SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton({ label, className, size = 'sm', variant = 'ghost', children, ...rest }, ref) {
  return (
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size} square className={className} {...rest}>
      {children}
    </Button>
  );
});

/** Fields fill their container unless the caller sets an explicit width. */
const widthOf = (className?: string) => (/(^|\s)(w-|min-w-|max-w-|flex-1|basis-)/.test(className ?? '') ? '' : 'w-full');
const field = 'rounded-sm border border-border bg-surface px-3 text-sm shadow-[0_1px_2px_rgb(15_23_42/0.04)] text-text placeholder:text-text-faint transition-colors hover:border-border-strong focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20 disabled:bg-surface-muted disabled:text-text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(field, widthOf(className), 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(field, widthOf(className), 'min-h-20 py-1.5', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(field, widthOf(className), 'h-9 appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8', "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%238a93a0' stroke-width='1.5'/%3E%3C/svg%3E\")]", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, htmlFor, className, required }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string; required?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-text">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 rounded-sm border-border accent-[var(--color-interactive)]" {...rest} />
      {label}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-border bg-surface-muted px-1 font-mono text-2xs text-text-muted">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-text-faint', className)} aria-label={t('common.loading')} />;
}
