// Performance budget: first-load JavaScript per route (gzip), from the production build.
// Run after `next build`: `node scripts/check-bundle-budget.mjs` (fails when a route is over budget).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = Number(process.env.JS_BUDGET_KB ?? 250);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.next');
const shared = JSON.parse(readFileSync(path.join(root, 'build-manifest.json'), 'utf8')).rootMainFiles ?? [];

const sizes = new Map();
const gz = (file) => {
  if (!sizes.has(file)) sizes.set(file, gzipSync(readFileSync(path.join(root, file))).length);
  return sizes.get(file);
};

function* manifests(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* manifests(p);
    else if (name.endsWith('_client-reference-manifest.js')) yield p;
  }
}

const rows = [];
for (const file of manifests(path.join(root, 'server', 'app'))) {
  const src = readFileSync(file, 'utf8');
  // globalThis.__RSC_MANIFEST["/route/page"] = {…};
  const json = src.slice(src.indexOf('] = ') + 4, src.lastIndexOf('}') + 1);
  const m = JSON.parse(json);
  const entries = Object.values(m.entryJSFiles ?? {}).flat();
  const files = [...new Set([...shared, ...entries])].filter((f) => f.endsWith('.js'));
  const route = path.relative(path.join(root, 'server', 'app'), file).replace(/\\/g, '/').replace(/_client-reference-manifest\.js$/, '').replace(/\/page$/, '') || '/';
  rows.push({ route: `/${route}`.replace(/\/+/g, '/'), kb: files.reduce((s, f) => s + gz(f), 0) / 1024 });
}
rows.sort((a, b) => b.kb - a.kb);
const over = rows.filter((r) => r.kb > BUDGET_KB);
for (const r of rows) console.log(`${r.kb > BUDGET_KB ? 'OVER' : '  ok'}  ${r.kb.toFixed(1).padStart(7)} KB  ${r.route}`);
console.log(`\n${rows.length} routes, budget ${BUDGET_KB} KB gzip first-load JS; largest ${rows[0]?.kb.toFixed(1)} KB.`);
if (over.length) {
  console.error(`${over.length} route(s) over budget.`);
  process.exit(1);
}
