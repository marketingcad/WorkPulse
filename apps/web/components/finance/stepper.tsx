'use client';
import { Check } from 'lucide-react';
import { cx } from '@tallywork/ui';

/** Horizontal step indicator. Completed steps are clickable to go back. */
export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number) => void }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-md border border-border bg-surface px-3 py-2.5" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!done || !onStep}
              onClick={() => onStep?.(i)}
              aria-current={active ? 'step' : undefined}
              className={cx('flex items-center gap-2 rounded-sm px-1 py-0.5 text-sm', done && onStep ? 'cursor-pointer hover:bg-surface-muted' : 'cursor-default')}
            >
              <span
                className={cx(
                  'tabular flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  done ? 'border-interactive bg-interactive text-on-accent' : active ? 'border-interactive text-interactive' : 'border-border text-text-faint',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cx('font-medium', active ? 'text-text' : done ? 'text-text-muted' : 'text-text-faint')}>
                {label}
                {done && <span className="sr-only"> (completed)</span>}
              </span>
            </button>
            {i < steps.length - 1 && <span className="hidden h-px w-8 bg-border sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
