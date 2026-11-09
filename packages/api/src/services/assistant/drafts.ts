import { addDaysToDate, forbidden, notFound } from '@tallywork/domain';
import type { AssistantDraftDto, AssistantDraftInput } from '@tallywork/contracts';
import { AiError } from '../../lib/ai/provider';
import type { Ctx } from '../ctx';
import { getInsights } from '../ai-insights';
import { missingTimesheets } from '../ai-insights/gather';
import { listMemberOptions } from '../org';
import { getProject, listTasks } from '../work';

/**
 * WorkPulse AI drafts. The model gets only facts fetched here through the person's own scoped
 * services and writes one block of text: no tools, nothing stored, sent or published. Missing facts
 * become [placeholders] for the person to fill in.
 */
export const DRAFT_SYSTEM = [
  'Write the requested text for WorkPulse users. Use only the facts given. Never invent names, numbers, dates, prices or policies.',
  'If a fact is missing, leave a [placeholder] for the person to fill in. Plain text, no markdown headings.',
  'The person will review and edit it; you never send anything.',
].join(' ');
const MAX_TOKENS = 600;
const TIMEOUT_MS = 30_000;
const MAX_CHARS = 4000;
const has = (x: Ctx, p: string) => x.actor.grants[p as keyof typeof x.actor.grants] !== undefined;

const STYLE: Record<string, string> = {
  improve: 'Improve grammar and clarity; keep the meaning and length.',
  shorter: 'Make it shorter; keep every fact.',
  longer: 'Expand it a little with clearer explanation; add no new facts.',
  professional: 'Rewrite it in a professional tone.',
  friendly: 'Rewrite it in a warm, friendly tone.',
  translate: 'Translate it.',
};

/** The instruction and the facts for one draft, each fetched within the person's own access. */
async function factsFor(x: Ctx, i: AssistantDraftInput): Promise<{ instruction: string; facts: string[] }> {
  switch (i.kind) {
    case 'project_description': {
      if (!has(x, 'projects:read')) throw forbidden();
      const p = await getProject(x, i.project_id);
      const tasks = has(x, 'tasks:read') ? await listTasks(x, { projectId: p.id }) : [];
      return {
        instruction: 'Write a short project description (2 to 4 sentences) for the team.',
        facts: [`Project: ${p.name}`, ...(p.client_name ? [`Client: ${p.client_name}`] : []), ...(p.description ? [`Current description: ${p.description}`] : []), ...(tasks.length ? [`Tasks: ${tasks.slice(0, 15).map((t) => t.title).join('; ')}`] : [])],
      };
    }
    case 'task_description': {
      if (!has(x, 'tasks:read')) throw forbidden();
      const task = (await listTasks(x, { includeArchived: true })).find((t) => t.id === i.task_id);
      if (!task) throw notFound('task');
      return {
        instruction: 'Write a clear task description: what to do and what done looks like, in 2 to 5 sentences or a short list.',
        facts: [`Task: ${task.title}`, ...(task.project_name ? [`Project: ${task.project_name}`] : []), ...(task.description ? [`Current description: ${task.description}`] : []), ...(task.due_date ? [`Due: ${task.due_date}`] : [])],
      };
    }
    case 'timesheet_reminder': {
      if (!has(x, 'timesheets:read') || !has(x, 'members:read')) throw forbidden();
      const names = new Map((await listMemberOptions(x, { includeRemoved: true })).map((m) => [m.id, { name: m.name, active: m.status === 'ACTIVE', tracked: !!m.tracking_enabled }]));
      // Pay periods that ended by the end of the range are the ones a timesheet is due for.
      const missing = (await missingTimesheets(x, { from: i.from, to: i.to }, addDaysToDate(i.to, 1), names)) ?? [];
      return {
        instruction: 'Write a short, friendly reminder email asking these people to submit their timesheets. Start with a subject line.',
        facts: [`Period: ${i.from} to ${i.to}`, missing.length ? `Not submitted: ${missing.map((m) => m.memberName).join(', ')}` : 'Not submitted: [nobody found; add the names]'],
      };
    }
    case 'project_update': {
      if (!has(x, 'projects:read')) throw forbidden();
      const p = await getProject(x, i.project_id);
      const r = await getInsights(x, 'projects', { from: i.from, to: i.to });
      const mine = r.findings.filter((f) => f.refs.some((ref) => ref.type === 'project' && ref.id === p.id));
      return {
        instruction: 'Write a short project status update for the team or client, based only on these findings.',
        facts: [`Project: ${p.name}`, `Period: ${i.from} to ${i.to}`, ...mine.map((f) => `${f.title}: ${f.summary}`)],
      };
    }
    case 'rewrite':
      return { instruction: `${STYLE[i.style]}${i.style === 'translate' ? ` Target language: ${i.language ?? '[language]'}.` : ''}`, facts: [`Text: ${i.text}`] };
  }
}

export async function createDraft(x: Ctx, input: AssistantDraftInput): Promise<AssistantDraftDto> {
  const ai = x.deps.ai;
  if (!ai?.available || !x.deps.config.assistantEnabled) throw new AiError('ai_unavailable');
  // Facts first: a refusal (403/404) happens before anything reaches the AI provider.
  const { instruction, facts } = await factsFor(x, input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text = '';
  try {
    const prompt = `${instruction}\n\nFacts:\n${facts.map((f) => `- ${f}`).join('\n')}`;
    for await (const ch of ai.streamTurn({ system: DRAFT_SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], tools: [], maxTokens: MAX_TOKENS, signal: controller.signal })) {
      if (ch.type === 'text_delta') text += ch.text;
    }
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted) throw new AiError('ai_unavailable');
  text = text.trim().slice(0, MAX_CHARS);
  if (!text) throw new AiError('ai_bad_response');
  return { text, facts_used: facts.filter((f) => !f.startsWith('Text: ')) };
}
