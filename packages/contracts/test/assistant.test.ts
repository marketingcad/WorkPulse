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
    { event: 'tool_status', data: { tool: 'list_projects', state: 'error' } },
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

describe('insight schemas', () => {
  const finding = {
    id: 'workforce:hours_trend:2026-11-02',
    section: 'workforce',
    category: 'hours_trend',
    severity: 'info',
    basis: 'observation',
    title: 'Hours up 25 %',
    summary: '100 h against 80 h.',
    period: { from: '2026-11-02', to: '2026-11-08' },
    metrics: [{ label: 'Hours', value: 100, unit: 'hours', previous: 80 }],
    refs: [{ type: 'team', id: 't1', name: 'Design' }],
    links: ['timesheets.all'],
    next_step: 'Open time entries.',
  };
  const result = { section: 'overview', period: { from: '2026-11-02', to: '2026-11-08' }, previous: { from: '2026-10-26', to: '2026-11-01' }, findings: [finding], limitations: [] };

  it('accepts a valid result', async () => {
    const { insightResultSchema } = await import('../src/assistant');
    expect(insightResultSchema.safeParse(result).success).toBe(true);
  });
  it('rejects an unknown basis or an unknown link', async () => {
    const { insightResultSchema } = await import('../src/assistant');
    expect(insightResultSchema.safeParse({ ...result, findings: [{ ...finding, basis: 'guess' }] }).success).toBe(false);
    expect(insightResultSchema.safeParse({ ...result, findings: [{ ...finding, links: ['../admin'] }] }).success).toBe(false);
  });
  it('limits the period to 93 days and to a forward range', async () => {
    const { insightQueryInput, insightSectionInput } = await import('../src/assistant');
    expect(insightQueryInput.safeParse({ from: '2026-01-01', to: '2026-04-03' }).success).toBe(true);
    expect(insightQueryInput.safeParse({ from: '2026-01-01', to: '2026-04-04' }).success).toBe(false);
    expect(insightQueryInput.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(false);
    expect(insightSectionInput.safeParse('payroll').success).toBe(false);
  });
});
