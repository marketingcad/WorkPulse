/**
 * "Ask WorkPulse AI" from anywhere on a page (an insight card, the report runner, a performance
 * profile): the launcher listens, opens the panel and asks the question in a new conversation. A
 * plain event target, so pages that ask never import the assistant itself (it stays out of their
 * first load). The launcher loads after the page, so a question asked before anyone listens is kept
 * (the latest one) and handed to the first listener.
 */
const target = new EventTarget();
const EVENT = 'workpulse:assistant-ask';
let listeners = 0;
let pending: string | null = null;

export function askAssistant(question: string): void {
  const q = question.trim();
  if (!q) return;
  if (!listeners) {
    pending = q;
    return;
  }
  target.dispatchEvent(new CustomEvent<string>(EVENT, { detail: q }));
}

export function onAskAssistant(handler: (question: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  target.addEventListener(EVENT, listener);
  listeners++;
  if (pending !== null) {
    const q = pending;
    pending = null;
    handler(q);
  }
  return () => {
    target.removeEventListener(EVENT, listener);
    listeners--;
  };
}
