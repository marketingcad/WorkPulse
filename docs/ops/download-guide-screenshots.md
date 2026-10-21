# Setup guide screenshots

The desktop setup guides at `/download/guide/macos`, `/download/guide/windows` and `/download/guide/linux` show one
screenshot per step. The steps and the file names are in
`apps/web/components/download/guides.ts`. Until a screenshot is added, its step shows a dashed
frame that describes the missing picture.

## Adding screenshots

1. Take the screenshot on a real Mac, Windows PC or Ubuntu computer, following the list below.
2. Save it as a PNG with **exactly** the file name in the list, in
   `apps/web/public/download-guides/<macos|windows|linux>/`.
3. Commit and deploy. The guide pages are built at deploy time and pick up the new files then.

Tips:

- Use a clean test account (not a real person's email), and close unrelated windows and tabs.
- Crop to the window that matters. About 1600 px wide is plenty; the page scales images down.
- Use light mode, at the system's default text size.

## macOS (`public/download-guides/macos/`)

| File | Shows |
|---|---|
| `01-open-dmg.png` | The browser downloads list (or Finder's Downloads folder) with `Tallywork-mac.dmg` highlighted |
| `02-drag-to-applications.png` | The `.dmg` window, with the Tallywork icon being dragged onto the Applications folder |
| `03-cannot-verify.png` | The macOS message that it cannot verify Tallywork, with the **Done** button |
| `04-open-anyway.png` | System Settings â†’ Privacy & Security, scrolled to Security, with **Open Anyway** next to the Tallywork message |
| `05-sign-in.png` | The WorkPulse desktop sign-in screen |
| `06-screen-recording.png` | Privacy & Security â†’ Screen & System Audio Recording, with Tallywork turned on |
| `07-accessibility.png` | Privacy & Security â†’ Accessibility, with Tallywork turned on |
| `08-start-tracking.png` | WorkPulse Home, clocked in on a project with the timer running (captured from the real desktop app) |

## Windows (`public/download-guides/windows/`)

| File | Shows |
|---|---|
| `01-open-installer.png` | The browser downloads list (or File Explorer's Downloads folder) with `Tallywork-Setup.exe` highlighted |
| `02-more-info.png` | "Windows protected your PC", with the **More info** link |
| `03-run-anyway.png` | The same window after clicking **More info**: App `Tallywork-Setup.exe` and the **Run anyway** button |
| `04-install.png` | The Tallywork setup wizard's Welcome page, with the **Next** button |
| `05-finish.png` | The last setup screen, "Completing the Tallywork Setup Wizard", with the **Finish** button |
| `06-sign-in.png` | The WorkPulse desktop sign-in screen |
| `07-start-tracking.png` | WorkPulse Home, clocked in on a project with the timer running |

## Ubuntu / Debian (`public/download-guides/linux/`)

| File | Shows |
|---|---|
| `01-open-terminal.png` | Files in the Downloads folder, with `Tallywork-linux.deb` and the right-click menu showing **Open in Terminal** |
| `02-apt-install.png` | The terminal after `sudo apt install ./Tallywork-linux.deb`, with the installation finished |
| `03-open-app.png` | Show Apps with "Tallywork" typed in the search and the Tallywork icon |
| `04-sign-in.png` | The WorkPulse desktop sign-in screen |
| `05-ubuntu-on-xorg.png` | The Ubuntu login screen with the gear menu open and **Ubuntu on Xorg** selected |
| `06-start-tracking.png` | WorkPulse Home, clocked in on a project with the timer running (captured from the real desktop app) |
