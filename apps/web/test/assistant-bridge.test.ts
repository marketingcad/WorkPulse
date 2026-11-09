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
    const off2 = onAskAssistant((q) => got.push(q));
    askAssistant('   ');
    off2();
    expect(got).toEqual([]);
  });
});
