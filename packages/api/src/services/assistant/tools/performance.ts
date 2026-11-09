import { z } from 'zod';
import { previousPeriod, explainScore } from '@tallywork/domain/insights';
import { resolveNav } from '@tallywork/domain/assistant';
import { listMemberOptions } from '../../org';
import { memberScore } from '../../performance';
import { canSeeMembership } from '../../scope';
import { redactFinding } from '../redact';
import { dateRange, has, matchByName, nameArg, NO_MEMBER } from './shared';
import type { AssistantTool } from './types';

const input = dateRange({ member: nameArg.optional().describe('The person whose score to explain (their name)') });

/**
 * Why a Performance Center score moved, and one development suggestion. The scores are the
 * Performance Center's own (memberScore, which applies its visibility rules); this compares the
 * period with the one before it, part by part. Review notes are never read.
 */
export const explainPerformanceTool: AssistantTool<z.infer<typeof input>> = {
  name: 'explainPerformance',
  description:
    "Explain a person's Performance Center score for a date range: the change against the previous period of the same length, which parts (goal completion, delivery, approved-work consistency, quality, attendance) drove it, and one development suggestion. Uses the Performance Center's own scores; never review notes.",
  input,
  allowed: (a) => has(a, 'performance:read'),
  statusKey: 'explaining_performance',
  async run(x, q) {
    if (!q.member) return { data: { note: 'Name the person whose score you want explained.' } };
    // Only people whose performance this person may see.
    const visible = (has(x.actor, 'members:read') ? await listMemberOptions(x, { includeRemoved: true }) : []).filter((m) => canSeeMembership(x.actor, 'performance:read', m.id));
    const [m] = matchByName(visible, q.member);
    if (!m) return { data: { note: NO_MEMBER } };
    const prev = previousPeriod(q.from, q.to);
    const current = await memberScore(x, m.id, q.from, q.to);
    const before = await memberScore(x, m.id, prev.from, prev.to);
    const r = explainScore({ subject: { type: 'member', id: m.id, name: m.name }, period: { from: q.from, to: q.to }, previous: prev, current, before });
    const nav = resolveNav(x.actor.grants, x.org.id, 'performance');
    return {
      data: { member: m.name, period: { from: q.from, to: q.to }, previous_period: prev, coverage: current.coverage, findings: r.findings.map(redactFinding), limitations: r.limitations },
      ...(nav ? { nav: [nav] } : {}),
    };
  },
};
