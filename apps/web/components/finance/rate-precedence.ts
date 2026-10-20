import { RATE_PRECEDENCE, type RateKind, type RateScope } from '@tallywork/domain';

export const SCOPE_LABEL: Record<RateScope, string> = {
  ORG: 'Organization',
  CLIENT: 'Client',
  PROJECT: 'Project',
  WORKER: 'Member',
  PROJECT_WORKER: 'Member on project',
};

const lower = (s: RateScope) => (s === 'PROJECT_WORKER' ? 'member-on-project' : SCOPE_LABEL[s].toLowerCase());
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** e.g. "Pay rate overrides project, client and organization rates; a member-on-project rate still wins." */
export function precedenceText(kind: RateKind, scope: RateScope): string {
  const order = RATE_PRECEDENCE[kind];
  const at = order.indexOf(scope);
  const below = order.slice(at + 1).map(lower);
  const above = order.slice(0, at).map(lower);
  const parts = [below.length ? `overrides ${list(below)} rates` : '', above.length === 1 ? `a ${above[0]} rate still wins` : above.length ? `${list(above)} rates still win` : ''].filter(Boolean);
  return `${kind === 'PAY' ? 'Pay' : 'Bill'} rate ${parts.join('; ')}.`;
}
