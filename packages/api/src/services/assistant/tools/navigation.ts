import { z } from 'zod';
import { DomainError } from '@tallywork/domain';
import { NAV_TARGET_KEYS, resolveNav } from '@tallywork/domain/assistant';
import type { AssistantTool } from './types';

const input = z.object({ key: z.enum(NAV_TARGET_KEYS as [string, ...string[]]) });

export const navigationTool: AssistantTool<z.infer<typeof input>> = {
  name: 'suggestNavigation',
  description: 'Offer the person a link to a WorkPulse page. Only pages they may open can be linked.',
  input,
  allowed: () => true,
  statusKey: 'finding_page',
  async run(x, { key }) {
    const target = resolveNav(x.actor.grants, x.org.id, key);
    if (!target) throw new DomainError('forbidden', 'forbidden', 'Not permitted.');
    return { data: { page: target.label }, nav: [target] };
  },
};
