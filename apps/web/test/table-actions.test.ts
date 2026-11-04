import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard for every page built on the shared DataTable (UX audit C2). On phones the table becomes
 * stacked cards that show only some columns, and row actions survive only in columns marked as
 * actions (key 'actions', or `actions: true`). A column of buttons or menus left unmarked would
 * vanish on phones again, so each one must be marked, or listed here with the reason it need not be.
 */
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
  });
}

/** Columns that hold a control but are not row actions, with why. */
const NOT_ACTIONS: Record<string, string> = {
  // none today: add `"path#key": "why"` for a column that has a control but is not a row action
};

/** The object literal starting at `start` (a `{`), up to its matching `}`. */
function objectAt(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** The column objects of a file: object literals that start with `key:` and have a `header:` of their own. */
function columns(src: string): Array<{ key: string; body: string }> {
  return [...src.matchAll(/\{\s*key: '([^']+)',/g)].map((m) => ({ key: m[1]!, body: objectAt(src, m.index!) })).filter((c) => /^\{\s*key: '[^']+',\s*(?:actions: (?:true|false),\s*)?header:/.test(c.body));
}

const consumers = [...files(path.join(web, 'app')), ...files(path.join(web, 'components'))].filter((f) => readFileSync(f, 'utf8').includes('<DataTable'));

describe('DataTable row actions on phones', () => {
  it('finds every page that uses the shared table', () => {
    expect(consumers.length).toBeGreaterThanOrEqual(37);
  });

  it('marks every column of buttons, menus or hidden-header controls as row actions', () => {
    const problems: string[] = [];
    for (const f of consumers) {
      const src = readFileSync(f, 'utf8');
      for (const c of columns(src)) {
        const marked = c.key === 'actions' ? !/actions: false/.test(c.body) : /actions: true/.test(c.body);
        const control = /<(Button|IconButton|Menu)\b/.test(c.body) || /header: <span className="sr-only">/.test(c.body);
        const id = `${path.relative(web, f).replace(/\\/g, '/')}#${c.key}`;
        if (control && !marked && !NOT_ACTIONS[id]) problems.push(id);
      }
    }
    expect(problems).toEqual([]);
  });
});
