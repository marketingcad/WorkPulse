/**
 * "Ask WorkPulse AI" from anywhere on a page (an insight card, the report runner): the launcher
 * listens, opens the panel and asks the question in a new conversation. A plain event target, so
 * pages that ask never import the assistant itself (it stays out of their first load).
 */
const target = new EventTarget();
const EVENT = 'workpulse:assistant-ask';

export function askAssistant(question: string): void {
  const q = question.trim();
  if (!q) return;
  target.dispatchEvent(new CustomEvent<string>(EVENT, { detail: q }));
}

export function onAskAssistant(handler: (question: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  target.addEventListener(EVENT, listener);
  return () => target.removeEventListener(EVENT, listener);
}
