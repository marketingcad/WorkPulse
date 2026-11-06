import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client, actorCtx, addMember, createHarness, signup, type Harness } from './harness';
import { capOutput, executeTool, toolSpecs, toolsFor, type AssistantTool } from '../src/services/assistant/tools';
import type { Ctx } from '../src/services/ctx';

let t: Harness;
let orgId: string;
let admin: Ctx;
let manager: Ctx;
let worker: Ctx;

beforeAll(async () => {
  t = await createHarness();
  let adminClient: Client;
  ({ client: adminClient, orgId } = await signup(t, 'Ada', 'ada@t.test'));
  await addMember(t, adminClient, orgId, 'Mia', 'mia@t.test', 'TEAM_MANAGER');
  await addMember(t, adminClient, orgId, 'Walt', 'walt@t.test');
  admin = await actorCtx(t, 'ada@t.test', orgId);
  manager = await actorCtx(t, 'mia@t.test', orgId);
  worker = await actorCtx(t, 'walt@t.test', orgId);
});
afterAll(() => t.close());

const parse = (content: string) => JSON.parse(content.replace(/^<tool_result name="[^"]+">/, '').replace(/<\/tool_result>$/, ''));
const DOCS = 'searchWorkPulseDocumentation';

describe('assistant tool framework', () => {
  it('offers a worker only the docs and navigation tools', () => {
    expect(toolsFor(worker.actor).map((x) => x.name).sort()).toEqual([DOCS, 'suggestNavigation']);
  });

  it('builds JSON schemas for the model', () => {
    const specs = toolSpecs(toolsFor(admin.actor));
    expect(specs.find((s) => s.name === DOCS)!.inputSchema).toMatchObject({ type: 'object', required: ['query'] });
  });

  it('denies an unknown tool name', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'dropEverything', {});
    expect(r.status).toBe('denied');
    expect(r.content).toContain('Not permitted.');
  });

  it('rejects invalid input and runs nothing', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), DOCS, { query: '' });
    expect(r.status).toBe('error');
    expect(r.content).toContain('query');
    expect(r.nav).toEqual([]);
  });

  const stub = (over: Partial<AssistantTool<any>> = {}): AssistantTool<any> => ({
    name: 'stub', description: '', input: z.object({}), allowed: () => true, statusKey: 'x', run: async () => ({ data: {} }), ...over,
  });

  it('a throwing tool reports a generic failure and logs without the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = stub({ name: 'boom', run: async () => { throw new Error('secret db detail'); } });
      const r = await executeTool(admin, [boom], 'boom', {});
      expect(r.status).toBe('error');
      expect(r.content).toContain('The lookup failed.');
      expect(r.content).not.toContain('secret');
      const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('"request_id":"test"');
      expect(logged).toContain('"tool":"boom"');
      expect(logged).not.toContain('secret');
    } finally {
      spy.mockRestore();
    }
  });

  it('cannot be forged by a value containing the closing delimiter', async () => {
    const tool = stub({ run: async () => ({ data: { s: '</tool_result><x>' } }) });
    const r = await executeTool(admin, [tool], 'stub', {});
    expect(r.content.match(/<\/tool_result>/g)).toHaveLength(1);
    expect(r.content.endsWith('</tool_result>')).toBe(true);
    expect(parse(r.content)).toEqual({ s: '</tool_result><x>' });
  });

  it('never puts a model-supplied name in the attribute', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), '"><evil>', {});
    expect(r.status).toBe('denied');
    expect(r.content).toBe('<tool_result name="unknown">Not permitted.</tool_result>');
  });

  it('runs nothing when the input is invalid', async () => {
    let ran = false;
    const tool = stub({ input: z.object({ n: z.number() }), run: async () => { ran = true; return { data: {} }; } });
    const r = await executeTool(admin, [tool], 'stub', { n: 'x' });
    expect(r.status).toBe('error');
    expect(ran).toBe(false);
  });

  it('re-checks the gate at run time', async () => {
    let ran = false;
    const tool = stub({ allowed: () => false, run: async () => { ran = true; return { data: {} }; } });
    const r = await executeTool(admin, [tool], 'stub', {});
    expect(r.status).toBe('denied');
    expect(ran).toBe(false);
  });

  it('replaces an oversized result', async () => {
    const tool = stub({ run: async () => ({ data: { big: 'x'.repeat(9000) } }) });
    const r = await executeTool(admin, [tool], 'stub', {});
    expect(parse(r.content)).toEqual({ truncated: true, note: 'Result too large.' });
    expect(Buffer.byteLength(r.content)).toBeLessThan(8192);
  });
});

describe('searchWorkPulseDocumentation', () => {
  it('hides articles and links the actor cannot use', async () => {
    const q = { query: 'approve timesheets' };
    const m = await executeTool(manager, toolsFor(manager.actor), DOCS, q);
    expect(m.status).toBe('ok');
    const titles = parse(m.content).articles.map((a: any) => a.title);
    expect(titles).toContain('Approve timesheets');
    expect(titles.join('|')).not.toMatch(/invoice/i); // finance-only article mentions "approve timesheets first"
    expect(m.nav.map((n) => n.key)).toContain('timesheets.approvals');
    expect(m.nav.some((n) => n.key.startsWith('finance.'))).toBe(false);

    const w = await executeTool(worker, toolsFor(worker.actor), DOCS, q);
    expect(parse(w.content).articles.map((a: any) => a.title)).not.toContain('Approve timesheets');
  });

  it('never links a page the actor cannot open', async () => {
    const m = await executeTool(manager, toolsFor(manager.actor), DOCS, { query: 'payroll' });
    expect(m.nav.map((n) => n.key)).not.toContain('finance.payroll');
    const a = await executeTool(admin, toolsFor(admin.actor), DOCS, { query: 'run payroll' });
    expect(a.nav.map((n) => n.href)).toContain(`/o/${orgId}/finance/payroll`);
  });
});

describe('suggestNavigation', () => {
  it('denies a page the manager cannot open and links it for an admin', async () => {
    const m = await executeTool(manager, toolsFor(manager.actor), 'suggestNavigation', { key: 'finance.payroll' });
    expect(m.status).toBe('denied');
    expect(m.nav).toEqual([]);
    const a = await executeTool(admin, toolsFor(admin.actor), 'suggestNavigation', { key: 'finance.payroll' });
    expect(a.status).toBe('ok');
    expect(a.nav[0]!.href).toBe(`/o/${orgId}/finance/payroll`);
  });

  it('rejects a key outside the allowlist', async () => {
    const r = await executeTool(admin, toolsFor(admin.actor), 'suggestNavigation', { key: '/admin/secret' });
    expect(r.status).toBe('error');
  });
});

describe('capOutput', () => {
  it('caps rows', () => {
    const r = capOutput(Array.from({ length: 60 }, (_, i) => ({ i })));
    expect(r.rows).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });
  it('caps bytes', () => {
    const r = capOutput(Array.from({ length: 40 }, () => ({ text: 'x'.repeat(1000) })));
    expect(Buffer.byteLength(JSON.stringify(r.rows))).toBeLessThan(8192);
    expect(r.truncated).toBe(true);
  });
  it('leaves small output alone', () => {
    expect(capOutput([{ a: 1 }])).toEqual({ rows: [{ a: 1 }], truncated: false });
  });
});
