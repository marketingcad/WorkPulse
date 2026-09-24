'use client';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-interactive text-white hover:bg-interactive-hover border border-transparent shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)]',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-muted hover:border-border-strong',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-muted hover:text-text border border-transparent',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
  subtle: 'bg-interactive-soft text-interactive hover:brightness-95 border border-transparent',
};
const SIZE: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1',
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'sm', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
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
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size} className={cx(size === 'xs' ? 'w-6 px-0' : size === 'sm' ? 'w-8 px-0' : 'w-9 px-0', className)} {...rest}>
      {children}
    </Button>
  );
});

const field = 'w-full rounded-sm border border-border bg-surface px-2.5 text-sm text-text placeholder:text-text-faint transition-colors hover:border-border-strong focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20 disabled:bg-surface-muted disabled:text-text-muted aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(field, 'h-8', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(field, 'min-h-20 py-1.5', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(field, 'h-8 appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7', "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%238a93a0' stroke-width='1.5'/%3E%3C/svg%3E\")]", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, htmlFor, className, required }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string; required?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-muted">
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
  return <Loader2 className={cx('size-4 animate-spin text-text-faint', className)} aria-label="Loading" />;
}
