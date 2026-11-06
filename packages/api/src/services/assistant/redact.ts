import type { HelpArticle } from '@tallywork/domain/help';

/** Keep only the named fields; never spread a DTO into tool output. */
export function pick<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Output allowlist for the documentation tool: only these fields reach the model. */
export function redactArticle(a: HelpArticle, links: string[]) {
  return {
    title: a.title,
    summary: a.summary,
    steps: a.steps ?? [],
    points: a.points ?? [],
    tip: a.tip ?? null,
    links,
  };
}
