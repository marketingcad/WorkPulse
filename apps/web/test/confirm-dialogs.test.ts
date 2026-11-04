import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard: every confirmation says what will happen (UX remediation, phase 4). A ConfirmDialog
 * with only a title ("Delete?") asks people to agree to consequences they cannot see, so each
 * one must pass a `description`.
 */
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f.startsWith('.')) return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
  });
}

/** The JSX opening tag starting at `start` (`<ConfirmDialog`), up to its closing `>` or `/>`. */
function tagAt(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(start, i + 1);
  }
  return src.slice(start);
}

const dialogs = ['app', 'components'].flatMap((d) => files(path.join(web, d))).flatMap((file) => {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/<ConfirmDialog\b/g)].map((m) => ({ where: `${path.relative(web, file)}:${src.slice(0, m.index).split('\n').length}`, tag: tagAt(src, m.index!) }));
});

describe('confirmation dialogs', () => {
  it('finds the app’s confirmations', () => {
    expect(dialogs.length).toBeGreaterThan(20);
  });

  it('every one explains the consequences in a description', () => {
    expect(dialogs.filter((d) => !/\bdescription=/.test(d.tag)).map((d) => d.where)).toEqual([]);
  });
});
