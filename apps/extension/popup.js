// Popup: shows whether the desktop app is connected and whether websites are being recorded right now.
const PORTS = [47816, 47817, 47818];

function set(id, cls, text) {
  const row = document.getElementById(id);
  row.className = `row ${cls}`;
  document.getElementById(`${id}-text`).textContent = text;
}

async function status() {
  for (const p of PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/v1/status`);
      if (res.ok) return await res.json();
    } catch {
      // not listening on this port
    }
  }
  return null;
}

(async () => {
  const s = await status();
  if (!s) {
    set('app', 'warn', 'The Tallywork desktop app is not running on this computer.');
    set('rec', '', 'Nothing is recorded.');
    return;
  }
  set('app', 'ok', 'Connected to the Tallywork desktop app.');
  if (!s.urls_enabled) set('rec', '', 'Your organization does not record websites.');
  else if (!s.tracking) set('rec', '', 'Timer is not running — nothing is recorded.');
  else set('rec', 'ok', s.mode === 'domain' ? 'Timer running — the website domain is recorded (e.g. github.com).' : 'Timer running — the website address is recorded (without query strings).');
})();
