/** A help article as the search sees it: every word a reader might type. */
export interface Searchable {
  id: string;
  title: string;
  summary: string;
  body: string[];
  keywords?: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ');

/**
 * Articles matching every word of the query (in any order, as the start of a word, so "invo"
 * finds "invoice"), best first: a match in the title counts most, then keywords, then the text.
 */
export function searchArticles<T extends Searchable>(articles: T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  const scored: Array<{ a: T; score: number }> = [];
  for (const a of articles) {
    const fields = [
      { text: ` ${norm(a.title)}`, weight: 5 },
      { text: ` ${norm((a.keywords ?? []).join(' '))}`, weight: 3 },
      { text: ` ${norm(a.summary)}`, weight: 2 },
      { text: ` ${norm(a.body.join(' '))}`, weight: 1 },
    ];
    let score = 0;
    let all = true;
    for (const w of words) {
      const best = Math.max(0, ...fields.filter((f) => f.text.includes(` ${w}`)).map((f) => f.weight));
      if (!best) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) scored.push({ a, score });
  }
  return scored.sort((x, y) => y.score - x.score).map((x) => x.a);
}
