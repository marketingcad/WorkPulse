'use client';
import { useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button, cx } from '@tallywork/ui';

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="xs"
      className={className}
      icon={done ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: the value stays selectable */
        }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

/** Shows a one-time secret with a copy button and a clear "won't be shown again" warning. */
export function SecretReveal({ label, secret, warning }: { label: string; secret: string; warning: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{warning}</span>
      </div>
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-muted p-2">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-xs">{secret}</code>
        <CopyButton value={secret} />
      </div>
    </div>
  );
}

export function CodeBlock({ children, className, copy }: { children: string; className?: string; copy?: boolean }) {
  return (
    <div className={cx('relative', className)}>
      <pre className="overflow-x-auto rounded-sm border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed">{children}</pre>
      {copy && <CopyButton value={children} className="absolute right-2 top-2" />}
    </div>
  );
}
