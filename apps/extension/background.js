// Tallywork browser extension (Manifest V3 service worker).
// Tells the Tallywork desktop app which website is in the active tab of the focused
// window, over a local-only bridge (127.0.0.1). The desktop app decides whether to
// record it: only while a timer runs, and only as the organization's policy allows
// (domain only, excluded domains). Incognito windows are never visible to this
// extension ("incognito": "not_allowed"), so they are reported as "not focused".

/** Keep in sync with BRIDGE_PORTS in apps/desktop/src/main/services/urls.ts. */
const PORTS = [47816, 47817, 47818];
const HEARTBEAT_ALARM = 'tallywork-heartbeat';

let port = null;
let lastSent = '';

function browserKey() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.some((b) => /Edge/i.test(b))) return 'edge';
  if (brands.some((b) => /Brave/i.test(b))) return 'brave';
  if (brands.some((b) => /Opera/i.test(b))) return 'opera';
  if (brands.some((b) => /Vivaldi/i.test(b))) return 'vivaldi';
  return 'chrome';
}

/** What is in front of the user right now, as far as this extension can see. */
async function currentTab() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused || win.type !== 'normal' || win.incognito) return { focused: false, url: null };
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  const url = tab?.url && /^https?:\/\//i.test(tab.url) ? tab.url : null;
  return { focused: true, url };
}

async function post(p, body) {
  const res = await fetch(`http://127.0.0.1:${p}/v1/tab`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  return res.json();
}

/** Send the current tab to the desktop app. `force` re-sends an unchanged state (heartbeat). */
async function report(force = false) {
  const state = await currentTab();
  const body = JSON.stringify({ browser: browserKey(), ...state });
  if (!force && body === lastSent) return;
  for (const p of port ? [port, ...PORTS.filter((x) => x !== port)] : PORTS) {
    try {
      await post(p, body);
      port = p;
      lastSent = body;
      return;
    } catch {
      // desktop app not listening on this port
    }
  }
  port = null;
  lastSent = '';
}

function ensureAlarm() {
  chrome.alarms.get(HEARTBEAT_ALARM, (a) => {
    if (!a) chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void report(true);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void report(true);
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === HEARTBEAT_ALARM) void report(true);
});
chrome.tabs.onActivated.addListener(() => void report());
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.status === 'complete')) void report();
});
chrome.windows.onFocusChanged.addListener(() => void report());
