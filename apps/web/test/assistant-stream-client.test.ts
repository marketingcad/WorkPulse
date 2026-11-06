import { describe, expect, it } from 'vitest';
import type { AssistantStreamEvent } from '@tallywork/contracts';
import { createSseParser } from '../components/assistant/sse';
import { parseInline, parseMarkdown } from '../components/assistant/markdown';

describe('assistant SSE parser', () => {
  it('emits an event split across chunks exactly once', () => {
    const got: AssistantStreamEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('event: del');
    feed('ta\ndata: {"te');
    feed('xt":"Hello"}\n\nevent: done\ndata: {"assistant_message_id":"0190a5d4-7a1c-7d2e-9f00-000000000001"}\n\n');
    expect(got).toEqual([
      { event: 'delta', data: { text: 'Hello' } },
      { event: 'done', data: { assistant_message_id: '0190a5d4-7a1c-7d2e-9f00-000000000001' } },
    ]);
  });

  it('skips unknown events, invalid JSON and events that break the contract', () => {
    const got: AssistantStreamEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('event: bogus\ndata: {}\n\n');
    feed('event: delta\ndata: {not json\n\n');
    feed('event: delta\ndata: {}\n\n');
    feed('event: tool_status\r\ndata: {"tool":"getHoursSummary","state":"error"}\r\n\r\n');
    expect(got).toEqual([{ event: 'tool_status', data: { tool: 'getHoursSummary', state: 'error' } }]);
  });
});

describe('assistant markdown subset', () => {
  const flat = (text: string) => JSON.stringify(parseMarkdown(text));

  it('keeps HTML and links as plain text', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **b**');
    expect(blocks).toEqual([
      {
        t: 'p',
        inl: [
          { t: 'text', v: '<img src=x onerror=alert(1)> [x](javascript:alert(1)) ' },
          { t: 'bold', v: 'b' },
        ],
      },
    ]);
    // Only text, bold, code, lists, headings and tables exist: there is no node that could be a link or HTML.
    expect(flat('[a](https://evil.example) <a href="x">y</a> ![i](x)')).not.toMatch(/"t":"(a|link|img|html)"/);
  });

  it('parses lists, headings, code and tables', () => {
    expect(parseMarkdown('### Steps\n1. Open **Timesheets**\n2. Click `Approve`\n\n- one\n- two')).toEqual([
      { t: 'h', inl: [{ t: 'text', v: 'Steps' }] },
      { t: 'ol', items: [[{ t: 'text', v: 'Open ' }, { t: 'bold', v: 'Timesheets' }], [{ t: 'text', v: 'Click ' }, { t: 'code', v: 'Approve' }]] },
      { t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
    ]);
    const table = parseMarkdown('| Member | Hours |\n|---|---|\n| Walt | 2 |\n| Bea | 3 |');
    expect(table).toEqual([
      { t: 'table', head: [[{ t: 'text', v: 'Member' }], [{ t: 'text', v: 'Hours' }]], rows: [[[{ t: 'text', v: 'Walt' }], [{ t: 'text', v: '2' }]], [[{ t: 'text', v: 'Bea' }], [{ t: 'text', v: '3' }]]] },
    ]);
  });

  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    expect(parseMarkdown('a\nb\n\nc').map((b) => b.t)).toEqual(['p', 'p']);
    expect(parseInline('plain')).toEqual([{ t: 'text', v: 'plain' }]);
  });
});
