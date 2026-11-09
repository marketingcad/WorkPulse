import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, searchArticles, type Searchable } from '../src/help';

const searchable: Searchable[] = HELP_ARTICLES.map((a) => ({
  id: a.id,
  title: a.title,
  summary: a.summary,
  keywords: a.keywords,
  body: [...(a.steps ?? []), ...(a.points ?? [])],
}));

describe('help knowledge in the domain package', () => {
  it('ships the full set of articles', () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(47);
  });

  it('finds a timesheet article by a word prefix', () => {
    const hits = searchArticles(searchable, 'timesh');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.title.toLowerCase().includes('timesheet'))).toBe(true);
  });
});
