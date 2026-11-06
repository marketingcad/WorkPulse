import { z } from 'zod';
import { hasPermission, type Grants } from '@tallywork/domain';
import { NAV_TARGETS, NAV_TARGET_KEYS, resolveNav } from '@tallywork/domain/assistant';
import { HELP_ARTICLES, searchArticles, type HelpArticle } from '@tallywork/domain/help';
import { redactArticle } from '../redact';
import type { AssistantTool, NavLink } from './types';

const input = z.object({ query: z.string().min(1).max(200) });

function visibleTo(grants: Grants, a: HelpArticle): boolean {
  return !a.perms?.length || a.perms.some((p) => hasPermission(grants, p));
}

/** A help link (a path such as /timesheets/approvals) becomes a nav link only when it matches a target exactly and is permitted. */
function linksFor(grants: Grants, orgId: string, a: HelpArticle): NavLink[] {
  const out: NavLink[] = [];
  for (const l of a.links ?? []) {
    const key = NAV_TARGET_KEYS.find((k) => NAV_TARGETS[k].path === l.href);
    if (!key) continue;
    const r = resolveNav(grants, orgId, key);
    if (r && !out.some((o) => o.key === r.key)) out.push(r);
  }
  return out;
}

export const docsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'searchWorkPulseDocumentation',
  description: 'Search the WorkPulse help articles for how-to steps. Use for any question about how to do something in WorkPulse.',
  input,
  allowed: () => true,
  statusKey: 'searching_help',
  async run(x, { query }) {
    const searchable = HELP_ARTICLES.filter((a) => visibleTo(x.actor.grants, a)).map((a) => ({
      a,
      id: a.id,
      title: a.title,
      summary: a.summary,
      body: [...(a.steps ?? []), ...(a.points ?? []), ...(a.tip ? [a.tip] : [])],
      keywords: a.keywords,
    }));
    const hits = searchArticles(searchable, query).slice(0, 5);
    const nav: NavLink[] = [];
    const articles = hits.map(({ a }) => {
      const links = linksFor(x.actor.grants, x.org.id, a);
      for (const l of links) if (!nav.some((n) => n.key === l.key)) nav.push(l);
      return redactArticle(a, links.map((l) => l.key));
    });
    return { data: { articles }, nav };
  },
};
