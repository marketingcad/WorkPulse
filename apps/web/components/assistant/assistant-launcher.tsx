'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

const AssistantPanel = dynamic(() => import('./assistant-panel').then((m) => m.AssistantPanel), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-overlay">
      <Spinner className="size-3.5" /> {t('common.loading')}
    </div>
  ),
});

/**
 * WorkPulse AI launcher: a round button stacked above the calculator's, in the bottom-right corner.
 * Shown only when the assistant is configured and the person's role may use it.
 */
export function AssistantLauncher() {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!org.assistant_enabled) return null;
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <>
      {!open && (
        <button
          ref={button}
          type="button"
          data-testid="assistant-launcher"
          aria-label={t('assistant.launch')}
          title={t('assistant.launch')}
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)] right-4 z-40 flex size-12 items-center justify-center rounded-full border border-border bg-surface text-interactive shadow-overlay hover:bg-interactive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:right-6"
        >
          <Sparkles className="size-5" aria-hidden />
        </button>
      )}
      {open && <AssistantPanel orgId={org.organization.id} onClose={close} />}
    </>
  );
}
