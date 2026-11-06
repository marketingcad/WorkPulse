import { DomainError, hasPermission, isDesktopOnly } from '@tallywork/domain';
import type { Ctx } from '../ctx';

/**
 * Who may use the assistant: a signed-in person (never an API key or device) with a web role,
 * who can read the organization. Workers on desktop-only roles are refused.
 */
export function assertAssistantAccess(x: Ctx): void {
  const ok = x.actor.principal.type === 'user' && !isDesktopOnly(x.actor.grants) && hasPermission(x.actor.grants, 'org:read');
  if (!ok) throw new DomainError('forbidden', 'assistant_forbidden', 'The assistant is not available for your role.');
}
