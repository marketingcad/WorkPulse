// Build the desktop app and publish it as a GitHub Release (installer + auto-update feed).
// Usage: bump "version" in package.json, then `pnpm --filter @tallywork/desktop release:win`.
// The token comes from GH_TOKEN, or from the GitHub CLI (`gh auth login`) when GH_TOKEN is not set.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const targets = process.argv.slice(2);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let token = process.env.GH_TOKEN;
if (!token) {
  try {
    token = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    console.error('No GitHub token: set GH_TOKEN, or sign in with `gh auth login`.');
    process.exit(1);
  }
}

const REPO = 'marketingcad/tallywork-desktop';
const tag = `v${version}`;
const env = { ...process.env, GH_TOKEN: token };
// electron-vite / electron-builder are .cmd shims on Windows and need a shell; gh is called directly so arguments stay intact.
const run = (cmd, args, shell = true) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log(`Publishing Tallywork ${version} (${targets.join(' ')})`);
if (spawnSync('gh', ['release', 'view', tag, '-R', REPO], { stdio: 'ignore', env }).status === 0) {
  console.error(`${tag} already exists in ${REPO}. Bump "version" in apps/desktop/package.json first.`);
  process.exit(1);
}
run('electron-vite', ['build']);
// Create the draft first: electron-builder uploads files in parallel and would otherwise create one release per file.
run('gh', ['release', 'create', tag, '-R', REPO, '--draft', '--title', `Tallywork ${version}`, '--notes', 'Download **Tallywork-Setup.exe**, run it, then sign in with the email and password from your invitation. Installed apps update to this version automatically.'], false);
run('electron-builder', [...targets, '--publish', 'always']);
// Publishing the draft creates the tag and makes it the latest release, which installed apps then pick up.
run('gh', ['release', 'edit', tag, '-R', REPO, '--draft=false', '--latest'], false);
console.log(`Published: https://github.com/${REPO}/releases/tag/${tag}`);
