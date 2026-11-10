import { describe, expect, it } from 'vitest';
import { askAssistant, onAskAssistant } from '../lib/assistant-bridge';

describe('assistant bridge', () => {
  it('hands a question to the listener once', () => {
    const got: string[] = [];
    const off = onAskAssistant((q) => got.push(q));
    askAssistant('Explain this insight');
    expect(got).toEqual(['Explain this insight']);
    off();
  });

  it('stops after unsubscribing, and ignores empty questions', () => {
    const got: string[] = [];
    const off = onAskAssistant((q) => got.push(q));
    off();
    askAssistant('Later');
    expect(got).toEqual([]);
    // With nobody listening the question waits for the next listener (the launcher reloading).
    const next: string[] = [];
    const off2 = onAskAssistant((q) => next.push(q));
    askAssistant('   ');
    off2();
    expect(got).toEqual([]);
    expect(next).toEqual(['Later']);
  });
});

describe('assistant bridge before the assistant has loaded', () => {
  it('keeps a question asked before anyone listens, and hands it to the first listener once', () => {
    askAssistant('Asked too early');
    const got: string[] = [];
    const off = onAskAssistant((q) => got.push(q));
    expect(got).toEqual(['Asked too early']);
    const later: string[] = [];
    const off2 = onAskAssistant((q) => later.push(q));
    expect(later).toEqual([]);
    off();
    off2();
  });
});
