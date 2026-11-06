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

const wrap = (name: string, body: string) => `<tool_result name="${name}">${body}</tool_result>`;

/**
 * Runs one model-requested tool call: unknown or unpermitted tools are denied, input is validated,
 * and the tool runs in its own short tenant transaction. Never call from inside a request transaction.
 */
export async function executeTool(x: Ctx, tools: AssistantTool[], name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool || !tool.allowed(x.actor)) return { status: 'denied', content: wrap(name, 'Not permitted.'), args: rawInput, nav: [] };
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { status: 'error', content: wrap(name, `Invalid input. ${msg}`), args: rawInput, nav: [] };
  }
  try {
    const out = await withTenant(x.deps.db, x.org.id, (tx) => tool.run({ ...x, tx }, parsed.data));
    return { status: 'ok', content: wrap(name, JSON.stringify(out.data)), args: parsed.data, nav: out.nav ?? [] };
  } catch (e) {
    if (e instanceof DomainError && e.category === 'forbidden') return { status: 'denied', content: wrap(name, 'Not permitted.'), args: parsed.data, nav: [] };
    return { status: 'error', content: wrap(name, 'The lookup failed.'), args: parsed.data, nav: [] };
  }
}

/** Cap rows and serialized size; reports whether anything was cut. */
export function capOutput(rows: unknown[], maxRows = 50, maxBytes = 8192): { rows: unknown[]; truncated: boolean } {
  let n = Math.min(rows.length, maxRows);
  while (n > 0 && Buffer.byteLength(JSON.stringify(rows.slice(0, n))) > maxBytes) n--;
  return { rows: rows.slice(0, n), truncated: n < rows.length };
}
