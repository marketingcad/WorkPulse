'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { onAskAssistant } from '@/lib/assistant-bridge';

const AssistantPanel = dynamic(() => import('./assistant-panel').then((m) => m.AssistantPanel), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-overlay">
      <Spinner className="size-3.5" /> {t('common.loading')}
    </div>
  ),
});

/**
 * WorkPulse AI launcher: a round button just left of the calculator button, in the bottom row, so it
 * never covers the calculator panel (which opens above its button).
 * Shown only when the assistant is configured and the person's role may use it.
 */
export function AssistantLauncher() {
  const org = useOrg();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ seq: number; question: string } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // "Ask WorkPulse AI" buttons elsewhere on the page: open the panel with that question.
  useEffect(
    () =>
      onAskAssistant((question) => {
        setAsk((prev) => ({ seq: (prev?.seq ?? 0) + 1, question }));
        setOpen(true);
      }),
    [],
  );
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
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-20 z-40 flex size-12 items-center justify-center rounded-full border border-border bg-surface text-interactive shadow-overlay hover:bg-interactive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:right-22"
        >
          <Sparkles className="size-5" aria-hidden />
        </button>
      )}
      {open && <AssistantPanel orgId={org.organization.id} onClose={close} ask={ask} />}
    </>
  );
}
