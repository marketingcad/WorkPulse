'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Check, Copy, History, MessageSquarePlus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { AiBadge, Button, ConfirmDialog, IconButton, Spinner, cx, useToast } from '@tallywork/ui';
import type { AssistantMessageDto } from '@tallywork/contracts';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import './messages';
import { Markdown } from './markdown-view';
import { useAssistant, type AssistantError } from './use-assistant';

const MAX_CHARS = 4000;

function errorText(e: AssistantError): string {
  const key = `assistant.error.${e.code}`;
  const msg = t(key);
  return msg === key ? t('assistant.error.generic') : msg;
}

function toolLabel(tool: string): string {
  const key = `assistant.tool.${tool}`;
  const msg = t(key);
  return msg === key ? t('assistant.tool.default') : msg;
}

function NavChips({ nav }: { nav: AssistantMessageDto['nav'] }) {
  if (!nav.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {nav.map((n) => (
        <Link
          key={n.key}
          href={n.href}
          data-testid="assistant-nav-chip"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-interactive hover:bg-interactive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
        >
          {t('assistant.openPage', { page: n.label })}
        </Link>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <IconButton
      label={done ? t('assistant.copied') : t('assistant.copy')}
      data-testid="assistant-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error(t('assistant.copyFailed'));
        }
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  return (
    <div data-testid="assistant-message" data-role={role} className={cx('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div className={cx('max-w-[90%] rounded-lg px-3 py-2 text-sm', role === 'user' ? 'bg-interactive text-on-accent' : 'border border-border bg-surface-muted text-text')}>{children}</div>
    </div>
  );
}

/** `ask`: a question from an "Ask WorkPulse AI" button, sent once in a new conversation (`seq` tells repeats apart). */
export function AssistantPanel({ orgId, onClose, ask }: { orgId: string; onClose: () => void; ask?: { seq: number; question: string } | null }) {
  const a = useAssistant(orgId, true);
  const pathname = usePathname();
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = useQuery({
    queryKey: ['assistant', orgId, 'suggestions', pathname],
    queryFn: ({ signal }) => api<{ questions: string[] }>(`/orgs/${orgId}/assistant/suggestions?route=${encodeURIComponent(pathname)}`, { signal }),
    staleTime: 5 * 60_000,
  });

  // Block bodies: an effect may return only a cleanup function, and newer browsers make
  // scrollIntoView return a Promise.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [a.active?.messages.length, a.streaming?.text, a.error]);

  const asked = useRef(0);
  useEffect(() => {
    if (!ask || asked.current === ask.seq) return;
    asked.current = ask.seq;
    setView('chat');
    void a.send(ask.question, { fresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.seq]);

  const submit = () => {
    const text = draft.trim();
    if (!text || a.busy || text.length > MAX_CHARS) return;
    setDraft('');
    void a.send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const stored = a.active?.messages ?? [];
  // While a reply streams, the live copy of this turn is shown; saved messages from this turn (past
  // the count when it started) are hidden if a refetch brings them in early.
  const messages = a.streaming ? stored.slice(0, a.streaming.baseCount) : stored;
  const empty = !messages.length && !a.streaming && !a.activeLoading;
  const title = a.active?.title ?? t('assistant.newChat');

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={t('assistant.title')}
      data-testid="assistant-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !renaming && !confirmDelete) {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l md:top-14 md:border-t border-border bg-surface shadow-overlay md:w-100"
    >
      {/* Product identity (WorkPulse AI + the badge) above the conversation's own header row. */}
      <div className="flex items-center gap-2 px-4 pt-3" data-testid="assistant-brand">
        <span className="text-xs font-semibold tracking-wide text-text">{t('assistant.title')}</span>
        <AiBadge />
      </div>
      <header className="flex items-center gap-1 border-b border-border px-3 pb-2.5 pt-1">
        {renaming && a.active ? (
          <input
            autoFocus
            defaultValue={a.active.title}
            maxLength={120}
            aria-label={t('assistant.rename')}
            className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-sm"
            onKeyDown={async (e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(null);
              }
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim();
                if (v) await a.rename(a.active!.id, v);
                setRenaming(null);
              }
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : a.active && view === 'chat' ? (
          // The title renames the conversation; with nothing to rename it is plain text.
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-sm px-1 text-left text-sm font-semibold hover:bg-surface-muted"
            title={t('assistant.rename')}
            onClick={() => setRenaming(a.active!.id)}
          >
            {title}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{view === 'history' ? t('assistant.history') : title}</p>
        )}
        <IconButton label={t('assistant.newChat')} onClick={() => (a.newChat(), setView('chat'), inputRef.current?.focus())}>
          <MessageSquarePlus className="size-4" />
        </IconButton>
        <IconButton label={t('assistant.history')} aria-pressed={view === 'history'} onClick={() => setView(view === 'history' ? 'chat' : 'history')}>
          <History className="size-4" />
        </IconButton>
        <IconButton label={t('assistant.close')} onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto p-2" data-testid="assistant-history">
          {a.listLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : a.conversations.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-muted">{t('assistant.historyEmpty')}</p>
          ) : (
            <ul className="space-y-0.5">
              {a.conversations.map((c) => (
                <li key={c.id} className="group flex items-center gap-1 rounded-md hover:bg-surface-muted">
                  <button type="button" className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm" onClick={() => (a.select(c.id), setView('chat'))}>
                    {c.title}
                  </button>
                  <IconButton label={t('assistant.delete')} onClick={() => setConfirmDelete(c.id)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" role="log" aria-live="off" aria-busy={!!a.streaming}>
          {a.activeLoading && (
            <div className="space-y-2" aria-busy="true" aria-label={t('common.loading')} data-testid="assistant-loading">
              {[60, 85, 45].map((w) => (
                <div key={w} className="h-8 animate-pulse rounded-md bg-surface-muted" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {a.activeError && (
            <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm" data-testid="assistant-error">
              {t('assistant.error.load')}{' '}
              <Button size="sm" variant="secondary" onClick={() => a.reloadActive()}>
                {t('assistant.retry')}
              </Button>
            </div>
          )}
          {empty && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-interactive-soft text-interactive">
                  <Sparkles className="size-4" aria-hidden />
                </span>
                <div className="text-sm">
                  <p className="font-semibold">{t('assistant.welcomeTitle')}</p>
                  <p className="text-text-muted">{t('assistant.welcome')}</p>
                </div>
              </div>
              {!!suggestions.data?.questions.length && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{t('assistant.suggestions')}</p>
                  {suggestions.data.questions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      data-testid="assistant-suggestion"
                      disabled={a.busy}
                      onClick={() => void a.send(q)}
                      className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <Bubble key={m.id} role="user">
                <p className="whitespace-pre-wrap wrap-break-word">{m.content}</p>
              </Bubble>
            ) : (
              <Bubble key={m.id} role="assistant">
                <Markdown text={m.content} />
                {m.error_code && <p className="mt-1 text-xs text-text-muted">{t('assistant.interrupted')}</p>}
                <NavChips nav={m.nav} />
                <div className="mt-1 flex justify-end gap-0.5">
                  <CopyButton text={m.content} />
                </div>
              </Bubble>
            ),
          )}
          {a.streaming && (
            <>
              {/* The sent message shows at once; the saved copy replaces it when the reply ends. */}
              <Bubble role="user">
                <p className="whitespace-pre-wrap wrap-break-word">{a.streaming.userText}</p>
              </Bubble>
              <Bubble role="assistant">
                {a.streaming.text ? <Markdown text={a.streaming.text} /> : <TypingDots />}
                {a.streaming.toolStatus && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <Spinner className="size-3" /> {toolLabel(a.streaming.toolStatus)}
                  </p>
                )}
                <NavChips nav={a.streaming.nav} />
              </Bubble>
            </>
          )}
          {a.error && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm" data-testid="assistant-error" role="alert">
              <span>{errorText(a.error)}</span>
              {a.error.retryable && (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} data-testid="assistant-retry" onClick={() => void a.retry()}>
                  {t('assistant.retry')}
                </Button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {a.announcement}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder={t('assistant.placeholder')}
            aria-label={t('assistant.placeholder')}
            data-testid="assistant-input"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
          />
          <IconButton label={t('assistant.send')} type="submit" variant="primary" disabled={!draft.trim() || a.busy || draft.length > MAX_CHARS} data-testid="assistant-send">
            <ArrowUp className="size-4" />
          </IconButton>
        </div>
        <p className={cx('mt-1.5 text-2xs', draft.length > MAX_CHARS ? 'text-danger' : 'text-text-muted')}>
          {draft.length > MAX_CHARS ? t('assistant.tooLong', { max: MAX_CHARS }) : t('assistant.disclaimer')}
        </p>
      </form>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('assistant.deleteTitle')}
        description={t('assistant.deleteDescription')}
        confirmLabel={t('assistant.delete')}
        danger
        onConfirm={async () => {
          if (confirmDelete) await a.remove(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </aside>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label={t('assistant.thinking')} role="status">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-pulse rounded-full bg-text-muted" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
