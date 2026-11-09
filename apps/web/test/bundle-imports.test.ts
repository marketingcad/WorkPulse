import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every page's first load is held to 250 KB of JavaScript (scripts/check-bundle-budget.mjs, in CI).
 * The shell is on every page, so what it imports statically is paid everywhere: these modules are
 * only needed after a click (the calculator's panel and arithmetic, the product tour, two-factor setup, creating an
 * organization, a client from the project form) and load on demand. A static import of one of them
 * from the shell, or of the dialogs from a page that only needs workspace helpers, quietly puts it
 * back on every visit. This follows static imports only; `import()` and type-only imports are free.
 */
const web = path.resolve(__dirname, '..');
const rel = (f: string) => path.relative(web, f).split(path.sep).join('/');

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(web, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null; // a package: outside this app
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Static, value-carrying imports and re-exports of a source file. */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    const clause = m[2]!.trim();
    if (clause.startsWith('type ')) continue;
    const named = clause.match(/^\{([^}]*)\}$/);
    if (named && named[1]!.split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    out.push(m[3]!);
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!); // side-effect imports
  return out;
}

function reachable(root: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(web, root)];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of staticImports(f)) {
      const r = resolve(f, spec);
      if (r) queue.push(r);
    }
  }
  return new Set([...seen].map(rel));
}

describe('what every page loads', () => {
  const shell = reachable('app/o/[orgId]/layout.tsx');

  it('includes the shell itself (the walk follows real imports)', () => {
    expect(shell).toContain('components/shell/app-shell.tsx');
    expect(shell).toContain('components/calculator/calculator-launcher.tsx');
    expect(shell).toContain('components/help/tour.tsx');
    expect(shell).toContain('components/security/mfa-required.tsx');
  });

  it.each([
    'components/calculator/calculator-panel.tsx',
    'components/calculator/math.ts',
    'components/calculator/messages.ts',
    'components/help/tour-view.tsx',
    'components/help/tour-steps.ts',
    'components/security/two-factor-panel.tsx',
    'components/shell/new-org-dialog.tsx',
    'components/workspace/shared.tsx',
    'components/workspace/client-dialog.tsx',
    'components/assistant/assistant-launcher.tsx',
    'components/assistant/assistant-panel.tsx',
    'components/assistant/messages.ts',
  ])('does not include %s, which loads when it is needed', (file) => {
    expect(shell).not.toContain(file);
  });
});

describe('pages that only need workspace helpers', () => {
  it.each(['app/o/[orgId]/workers/page.tsx', 'app/o/[orgId]/workers/[id]/page.tsx', 'app/o/[orgId]/teams/page.tsx', 'app/o/[orgId]/clients/page.tsx', 'app/o/[orgId]/finance/payroll/[id]/page.tsx', 'app/o/[orgId]/settings/time/page.tsx'])(
    '%s does not bring in the task and project dialogs',
    (page) => {
      expect(reachable(page)).not.toContain('components/workspace/shared.tsx');
    },
  );

  it('the project page opens its budget dialog and documents tab on demand', () => {
    const page = reachable('app/o/[orgId]/projects/[id]/page.tsx');
    expect(page).not.toContain('components/finance/budget-dialog.tsx');
    expect(page).not.toContain('components/workspace/project-documents.tsx');
    expect(page).not.toContain('components/workspace/client-dialog.tsx');
  });

  // The manual is about 13 KB gzip; inside the first load it put Help over budget (250.7 KB, 6 Nov 2026).
  it('the Help page loads the manual alongside it, not in its first load', () => {
    expect(reachable('app/o/[orgId]/help/page.tsx')).not.toContain('components/help/content.ts');
  });
});

describe('the contracts package in the browser', () => {
  function* sources(dir: string): Generator<string> {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) {
        if (n !== 'server' && n !== 'api') yield* sources(p); // server-only code may use the schemas
      } else if (/\.tsx?$/.test(n)) yield p;
    }
  }

  it('is imported for values only through a subpath: its root brings every schema and zod (~35 KB)', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((d) => [...sources(path.join(web, d))]).filter((f) => staticImports(f).includes('@tallywork/contracts'));
    expect(offenders.map(rel)).toEqual([]);
  });
});
