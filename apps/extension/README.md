# Tallywork browser extension

Tells the Tallywork desktop app which website is open in the active tab, so website
tracking works on Windows (macOS reads it from the OS). Chrome, Edge and Brave
(Manifest V3, Chrome 116+).

- Sends only to the desktop app on this computer (`http://127.0.0.1:47816–47818`).
  The app only accepts this extension's ID (`pmgcginlglleofaohoddeemkibphkcij`,
  fixed by `key` in `manifest.json`).
- Only `http`/`https` pages. Never runs in private/incognito windows.
- The desktop app records the site only while a timer is running, and applies the
  organization's policy first (domain only, excluded domains).
- Without the extension, the desktop app falls back to reading the browser's
  address bar.

## Install (development)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → choose this `apps/extension` folder.
4. Click the Tallywork icon: it shows whether the desktop app is connected and
   whether websites are being recorded right now.

For company-wide rollout, publish to the Chrome Web Store / Edge Add-ons and
force-install it through browser policy. Add the store-assigned ID to
`TALLYWORK_EXTENSION_IDS` (comma-separated) in the desktop app's environment
until it is added to `EXTENSION_IDS` in `apps/desktop/src/main/services/urls.ts`.
