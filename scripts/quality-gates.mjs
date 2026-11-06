#!/usr/bin/env node
// Quality gates: every automated test belongs to one of three gates (quality-gates.json).
//
//   node scripts/quality-gates.mjs check                 every test file is in exactly one gate
//   node scripts/quality-gates.mjs list 1                the files of gate 1
//   node scripts/quality-gates.mjs run 1                 unit/API tests, then E2E, of gate 1
//   node scripts/quality-gates.mjs run 1 --unit          Vitest only        (--e2e: Playwright only)
//   node scripts/quality-gates.mjs run 2 --unit --exclude=apps/desktop
//   node scripts/quality-gates.mjs run 3 --e2e -- --project=web --project=desktop
//
// Everything after `--` goes to Playwright. A failing package does not stop the others, so one run
// reports every failure; the exit code is non-zero if anything failed. See docs/QUALITY_GATES.md.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'quality-gates.json'), 'utf8'));
const gates = manifest.gates;
const E2E_DIR = 'e2e/tests';
const VITEST_DIRS = ['packages/domain', 'packages/db', 'packages/api', 'packages/ui', 'packages/contracts', 'apps/web', 'apps/desktop'];

const posix = (p) => p.split(path.sep).join('/');
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Test files on disk: { 'vitest:packages/api:tracking': 'packages/api/test/tracking.test.ts', 'e2e:web/auth': 'e2e/tests/web/auth.spec.ts' } */
function filesOnDisk() {
  const found = new Map();
  for (const pkg of VITEST_DIRS) {
    for (const f of walk(path.join(root, pkg, 'test'))) {
      const m = /([^\\/]+)\.test\.tsx?$/.exec(f);
      if (m) found.set(`vitest:${pkg}:${m[1]}`, posix(path.relative(root, f)));
    }
  }
  for (const f of walk(path.join(root, E2E_DIR))) {
    const rel = posix(path.relative(path.join(root, E2E_DIR), f));
    const m = /^(.+)\.spec\.ts$/.exec(rel);
    if (m) found.set(`e2e:${m[1]}`, posix(path.join(E2E_DIR, rel)));
  }
  return found;
}

/** Manifest entries as keys, with the gate each is in. */
function entries(gateId) {
  const out = [];
  for (const [id, g] of Object.entries(gates)) {
    if (gateId && id !== gateId) continue;
    for (const [pkg, names] of Object.entries(g.vitest ?? {})) for (const n of names) out.push({ gate: id, key: `vitest:${pkg}:${n}`, pkg });
    for (const s of g.playwright ?? []) out.push({ gate: id, key: `e2e:${s}` });
  }
  return out;
}

function check() {
  const disk = filesOnDisk();
  const seen = new Map();
  const problems = [];
  for (const e of entries()) {
    if (seen.has(e.key)) problems.push(`${e.key} is in gate ${seen.get(e.key)} and gate ${e.gate}`);
    seen.set(e.key, e.gate);
    if (!disk.has(e.key)) problems.push(`${e.key} (gate ${e.gate}) has no test file`);
  }
  for (const [key, file] of disk) if (!seen.has(key)) problems.push(`${file} is in no quality gate: add it to quality-gates.json`);
  if (problems.length) {
    console.error(`Quality gates: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const counts = Object.keys(gates).map((id) => `gate ${id} (${gates[id].name}): ${entries(id).length} files`);
  console.log(`Quality gates: all ${disk.size} test files are in exactly one gate.\n  ${counts.join('\n  ')}`);
}

/** Runs `pnpm …` through the shell (pnpm is a .cmd on Windows) as one quoted command line. */
function sh(args) {
  const quote = (a) => (/^[\w@./:=,-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`);
  const line = ['pnpm', ...args].map(quote).join(' ');
  console.log(`\n$ ${line}`);
  return spawnSync(line, { cwd: root, stdio: 'inherit', shell: true }).status === 0;
}

function run(gateId, flags, playwrightArgs) {
  const g = gates[gateId];
  if (!g) throw new Error(`No gate ${gateId}. Gates: ${Object.keys(gates).join(', ')}`);
  const disk = filesOnDisk();
  const exclude = new Set(flags.filter((f) => f.startsWith('--exclude=')).flatMap((f) => f.slice(10).split(',')));
  const unit = !flags.includes('--e2e') || flags.includes('--unit');
  const e2e = !flags.includes('--unit') || flags.includes('--e2e');
  console.log(`Gate ${gateId}: ${g.name} (${g.severity}). ${g.covers}`);
  const failed = [];
  if (unit) {
    for (const [pkg, names] of Object.entries(g.vitest ?? {})) {
      if (exclude.has(pkg)) continue;
      const name = JSON.parse(readFileSync(path.join(root, pkg, 'package.json'), 'utf8')).name;
      const files = names.map((n) => posix(path.relative(path.join(root, pkg), path.join(root, disk.get(`vitest:${pkg}:${n}`)))));
      if (!sh(['--filter', name, 'exec', 'vitest', 'run', ...files])) failed.push(`${pkg} (Vitest)`);
    }
  }
  if (e2e && g.playwright?.length) {
    const specs = g.playwright.map((s) => `tests/${s}.spec.ts`);
    if (!sh(['--filter', '@tallywork/e2e', 'exec', 'playwright', 'test', ...specs, ...playwrightArgs])) failed.push('E2E (Playwright)');
  }
  if (failed.length) {
    console.error(`\nGate ${gateId} (${g.name}) FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nGate ${gateId} (${g.name}) passed.`);
}

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const [cmd, gateId, ...flags] = dash >= 0 ? argv.slice(0, dash) : argv;
const passthrough = dash >= 0 ? argv.slice(dash + 1) : [];
if (cmd === 'check') check();
else if (cmd === 'list') for (const e of entries(gateId)) console.log(filesOnDisk().get(e.key) ?? `(missing) ${e.key}`);
else if (cmd === 'run' && gateId) run(gateId, flags, passthrough);
else {
  console.error('Usage: node scripts/quality-gates.mjs check | list <gate> | run <gate> [--unit|--e2e] [--exclude=apps/desktop] [-- playwright args]');
  process.exit(2);
}
