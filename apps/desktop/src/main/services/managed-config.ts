import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/**
 * Settings pushed by an organization's device management (MDM / Group Policy). Managed values win
 * over the user's own choices and lock them in the UI:
 * - Windows: registry HKLM\SOFTWARE\Policies\Tallywork (REG_SZ ServerUrl, UpdateChannel, EnrollmentToken; REG_DWORD LaunchAtLogin)
 * - macOS:   configuration profile for app.tallywork.desktop (keys ServerUrl, UpdateChannel, LaunchAtLogin, EnrollmentToken)
 * - Linux:   /etc/tallywork/config.json ({ "serverUrl": …, "updateChannel": …, "launchAtLogin": …, "enrollmentToken": … })
 * See docs/ops/desktop-deployment.md.
 */
export interface ManagedConfig {
  serverUrl?: string;
  updateChannel?: 'latest' | 'beta';
  launchAtLogin?: boolean;
  /**
   * An enrollment token from the organization (wpe_…): at sign-in it pins this computer to that
   * organization and pre-approves it. It never signs anyone in. Kept in memory only, never shown.
   */
  enrollmentToken?: string;
}

/** The shape the server accepts; anything else (spaces inside, another prefix) is ignored. */
const ENROLLMENT_TOKEN = /^wpe_[A-Za-z0-9_-]{43}$/;

function clean(raw: Record<string, unknown>): ManagedConfig {
  const out: ManagedConfig = {};
  const url = raw.serverUrl ?? raw.ServerUrl;
  if (typeof url === 'string') {
    try {
      const u = new URL(url.trim());
      if (u.protocol === 'https:' || u.hostname === 'localhost') out.serverUrl = u.origin;
    } catch {
      /* ignore an invalid managed URL rather than failing to start */
    }
  }
  const ch = raw.updateChannel ?? raw.UpdateChannel;
  if (ch === 'beta' || ch === 'latest') out.updateChannel = ch;
  const launch = raw.launchAtLogin ?? raw.LaunchAtLogin;
  if (typeof launch === 'boolean') out.launchAtLogin = launch;
  else if (launch === 1 || launch === '1' || launch === 'true') out.launchAtLogin = true;
  else if (launch === 0 || launch === '0' || launch === 'false') out.launchAtLogin = false;
  const token = raw.enrollmentToken ?? raw.EnrollmentToken;
  if (typeof token === 'string' && ENROLLMENT_TOKEN.test(token.trim())) out.enrollmentToken = token.trim();
  return out;
}

/** Parse `reg query HKLM\SOFTWARE\Policies\Tallywork` output. */
export function parseRegQuery(output: string): ManagedConfig {
  const raw: Record<string, unknown> = {};
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s+(\w+)\s+(REG_SZ|REG_DWORD|REG_EXPAND_SZ)\s+(.*)$/.exec(line);
    if (!m) continue;
    raw[m[1]!] = m[2] === 'REG_DWORD' ? Number.parseInt(m[3]!.trim(), 16) : m[3]!.trim();
  }
  return clean(raw);
}

/** Parse `defaults read /Library/Managed Preferences/app.tallywork.desktop` output (old-style plist). */
export function parseDefaultsRead(output: string): ManagedConfig {
  const raw: Record<string, unknown> = {};
  for (const m of output.matchAll(/^\s*"?(\w+)"?\s*=\s*"?([^";]*)"?;\s*$/gm)) raw[m[1]!] = m[2]!;
  return clean(raw);
}

export function parseJsonConfig(text: string): ManagedConfig {
  try {
    const j = JSON.parse(text) as unknown;
    return j && typeof j === 'object' ? clean(j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout))));

/** Read the managed configuration for this machine (empty when none is deployed). */
export async function readManagedConfig(platform = process.platform): Promise<ManagedConfig> {
  if (platform === 'win32') return parseRegQuery(await run('reg', ['query', 'HKLM\\SOFTWARE\\Policies\\Tallywork']));
  if (platform === 'darwin') return parseDefaultsRead(await run('defaults', ['read', '/Library/Managed Preferences/app.tallywork.desktop']));
  return parseJsonConfig(await readFile('/etc/tallywork/config.json', 'utf8').catch(() => ''));
}
