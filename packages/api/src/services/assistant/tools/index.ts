import { z } from 'zod';
import { withTenant } from '@tallywork/db';
import { DomainError } from '@tallywork/domain';
import type { AiToolSpec } from '../../../lib/ai/provider';
import type { Actor } from '../../../context';
import type { Ctx } from '../../ctx';
import { docsTool } from './docs';
import { navigationTool } from './navigation';
import type { AssistantTool, NavLink } from './types';

export type { AssistantTool, NavLink } from './types';

const ALL_TOOLS: AssistantTool<any>[] = [docsTool, navigationTool];

/** The tool set for one actor: a tool the actor may not use is never offered to the model. */
export function toolsFor(actor: Actor): AssistantTool[] {
  return ALL_TOOLS.filter((t) => t.allowed(actor));
}

export function toolSpecs(tools: AssistantTool[]): AiToolSpec[] {
  return tools.map((t) => {
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema };
  });
}

export interface ToolOutcome {
  status: 'ok' | 'denied' | 'error';
  content: string;
  args: unknown;
  nav: NavLink[];
}

const MAX_BODY_BYTES = 8192;

/** Only the matched tool's own name goes in the attribute, never model-supplied text. */
const wrap = (name: string, body: string) => `<tool_result name="${name}">${body}</tool_result>`;

/** Escape `<` and `>` so a value can never close the wrapper; still valid JSON, decodes to the same value. */
const escapeBody = (json: string) => json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

/**
 * Runs one model-requested tool call: unknown or unpermitted tools are denied, input is validated,
 * and the tool runs in its own short tenant transaction. Never call from inside a request transaction.
 */
export async function executeTool(x: Ctx, tools: AssistantTool[], name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  const label = tool ? tool.name : 'unknown';
  if (!tool || !tool.allowed(x.actor)) return { status: 'denied', content: wrap(label, 'Not permitted.'), args: rawInput, nav: [] };
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { status: 'error', content: wrap(label, escapeBody(`Invalid input. ${msg}`)), args: rawInput, nav: [] };
  }
  try {
    const out = await withTenant(x.deps.db, x.org.id, (tx) => tool.run({ ...x, tx }, parsed.data));
    let body = escapeBody(JSON.stringify(out.data));
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) body = '{"truncated":true,"note":"Result too large."}';
    return { status: 'ok', content: wrap(label, body), args: parsed.data, nav: out.nav ?? [] };
  } catch (e) {
    if (e instanceof DomainError && e.category === 'forbidden') return { status: 'denied', content: wrap(label, 'Not permitted.'), args: parsed.data, nav: [] };
    // Never log the message, arguments or output (they can hold organization data).
    console.error(JSON.stringify({ level: 'error', msg: 'assistant tool failed', request_id: x.requestId, tool: label, code: e instanceof DomainError ? e.code : (e as Error)?.name }));
    return { status: 'error', content: wrap(label, 'The lookup failed.'), args: parsed.data, nav: [] };
  }
}

/** Cap rows and serialized size; reports whether anything was cut. */
export function capOutput(rows: unknown[], maxRows = 50, maxBytes = 8192): { rows: unknown[]; truncated: boolean } {
  let n = Math.min(rows.length, maxRows);
  while (n > 0 && Buffer.byteLength(JSON.stringify(rows.slice(0, n))) > maxBytes) n--;
  return { rows: rows.slice(0, n), truncated: n < rows.length };
}
