import { describe, expect, it } from 'vitest';
import { assistantCreateInput, assistantRenameInput, assistantSendInput, assistantStreamEvent } from '../src/assistant';

describe('assistantSendInput', () => {
  it('rejects empty and whitespace-only content', () => {
    expect(assistantSendInput.safeParse({ content: '' }).success).toBe(false);
    expect(assistantSendInput.safeParse({ content: '   \n ' }).success).toBe(false);
  });
  it('enforces the 4000 character cap', () => {
    expect(assistantSendInput.safeParse({ content: 'a'.repeat(4000) }).success).toBe(true);
    expect(assistantSendInput.safeParse({ content: 'a'.repeat(4001) }).success).toBe(false);
  });
  it('trims content and caps route at 200', () => {
    expect(assistantSendInput.parse({ content: '  hi  ' }).content).toBe('hi');
    expect(assistantSendInput.safeParse({ content: 'hi', route: '/' + 'a'.repeat(199) }).success).toBe(true);
    expect(assistantSendInput.safeParse({ content: 'hi', route: 'a'.repeat(201) }).success).toBe(false);
  });
});

describe('rename and create inputs', () => {
  it('validates title bounds', () => {
    expect(assistantRenameInput.safeParse({ title: ' ' }).success).toBe(false);
    expect(assistantRenameInput.safeParse({ title: 'a'.repeat(121) }).success).toBe(false);
    expect(assistantRenameInput.parse({ title: ' Hello ' }).title).toBe('Hello');
    expect(assistantCreateInput.safeParse({}).success).toBe(true);
    expect(assistantCreateInput.safeParse({ title: 'a'.repeat(121) }).success).toBe(false);
  });
});

describe('assistantStreamEvent', () => {
  const ok = [
    { event: 'message_saved', data: { user_message_id: '5b0f1c1e-3c1a-4a43-9d51-0d6c1f6f2a11' } },
    { event: 'delta', data: { text: 'hi' } },
    { event: 'tool_status', data: { tool: 'list_projects', state: 'running' } },
    { event: 'tool_status', data: { tool: 'list_projects', state: 'denied' } },
    { event: 'nav', data: { key: 'projects', label: 'Projects', href: '/projects' } },
    { event: 'done', data: { assistant_message_id: '5b0f1c1e-3c1a-4a43-9d51-0d6c1f6f2a12' } },
    { event: 'error', data: { code: 'timeout', retryable: true } },
  ];
  it.each(ok)('parses $event', (e) => {
    expect(assistantStreamEvent.safeParse(e).success).toBe(true);
  });
  it('rejects malformed events', () => {
    expect(assistantStreamEvent.safeParse({ event: 'delta', data: {} }).success).toBe(false);
    expect(assistantStreamEvent.safeParse({ event: 'bogus', data: {} }).success).toBe(false);
    expect(assistantStreamEvent.safeParse({ event: 'tool_status', data: { tool: 'x', state: 'weird' } }).success).toBe(false);
    expect(assistantStreamEvent.safeParse({ event: 'error', data: { code: 'nope', retryable: true } }).success).toBe(false);
  });
});
