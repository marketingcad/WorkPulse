# Deploying the desktop app with device management

This page is for IT administrators who install the WorkPulse desktop app on company computers with Intune, Group Policy, SCCM, Jamf, Kandji or a Linux configuration tool. It covers the installers, silent installation, and the settings you can push to every machine.

The app is branded WorkPulse, but its technical names still say Tallywork: the installer files, the Start menu entry, the install folder, the app bundle, the Linux `tallywork` executable, and the policy paths and bundle ID below. They are kept so installed apps keep their sign-in and update path.

Each person signs in once, in the app, with the email and password from their invitation (plus their 2FA code, if they use one). The password is sent to the server once and never stored. The app keeps only a device token, tied to that person and encrypted with the OS keychain. **Sign in with browser instead** is there for people who prefer to confirm in their browser.

## Installers

Every release is published on GitHub Releases in the public repo [marketingcad/tallywork-desktop](https://github.com/marketingcad/tallywork-desktop/releases). File names don't change between versions, so these links always serve the newest one:

| Platform | File | Use |
|---|---|---|
| Windows | [`Tallywork-Setup.exe`](https://github.com/marketingcad/tallywork-desktop/releases/latest/download/Tallywork-Setup.exe) | Install by the person, or a silent per-user install |
| macOS | [`Tallywork-mac.dmg`](https://github.com/marketingcad/tallywork-desktop/releases/latest/download/Tallywork-mac.dmg) | Universal (Intel and Apple Silicon). `Tallywork-mac.zip` is published too |
| Linux | [`Tallywork-linux.deb`](https://github.com/marketingcad/tallywork-desktop/releases/latest/download/Tallywork-linux.deb) | Ubuntu and Debian. Recommended |
| Linux | [`Tallywork-linux.AppImage`](https://github.com/marketingcad/tallywork-desktop/releases/latest/download/Tallywork-linux.AppImage) | Other distributions |

The web app's `/download` page offers the same files when its `DESKTOP_DOWNLOAD_URL_*` variables point at these links.

**Per-machine Windows installer:** every release also publishes `Tallywork-<version>-x64.msi`, a silent, per-machine install for Intune, Group Policy and SCCM. Download it from the [latest release](https://github.com/marketingcad/tallywork-desktop/releases/latest). Its name includes the version, so there is no fixed link.

The macOS `.pkg` (`Tallywork-<version>.pkg`) is configured but not published yet: it needs the Developer ID Installer certificate. Build it yourself with `pnpm --filter @tallywork/desktop dist:mac` if you need it.

**Signing is not in place yet:**

- **Windows:** the installer isn't code-signed, so SmartScreen warns on first run. Choose **More info → Run anyway**.
- **macOS:** the app is ad-hoc signed and not notarized, so the first launch is blocked. Open **System Settings → Privacy & Security** and choose **Open Anyway**. Updates can't install themselves (see [Updates](#updates)).

## Silent install

**Windows (per machine, `.msi`):**

```bat
msiexec /i Tallywork-<version>-x64.msi /qn
```

**Windows (per user):**

```bat
Tallywork-Setup.exe /S
```

**macOS:** copy `Tallywork.app` from the `.dmg` to `/Applications`, or, with a `.pkg` you built:

```bash
sudo installer -pkg Tallywork-0.1.4.pkg -target /
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt install ./Tallywork-linux.deb
```

### Linux packages

- **`.deb`:** apt installs what the trackers need (`libxt6`, and `x11-utils` for `xprop` and `xwininfo`) and recommends a desktop keyring (`gnome-keyring` or `kwalletmanager`). It also installs an AppArmor profile, which keeps Chromium's sandbox on in Ubuntu 24.04.
- **AppImage:** needs `libfuse2` (`libfuse2t64` on Ubuntu 24.04). Where unprivileged user namespaces are blocked, its launcher starts the app with `--no-sandbox`.
- **Keyring:** the sign-in is stored only in the desktop keyring (Secret Service), never unencrypted. Without one, the app shows a dialog saying what to install, then exits.
- **Wayland:** Linux doesn't let apps see input, other apps' windows or the screen, so activity, applications and screenshots are reported as unavailable (the device's `wayland` capability) and nothing partial is recorded. People who must be tracked choose **Ubuntu on Xorg** on the login screen.

## Managed settings

Managed values override anything a person set, and lock the matching controls in the app. For example, the server field on the sign-in screen is hidden when the server is managed.

| Setting | Type | Meaning |
|---|---|---|
| `ServerUrl` | string (https) | Your WorkPulse address, e.g. `https://time.acme.com`. Required for self-hosted or custom domains. |
| `UpdateChannel` | `latest` \| `beta` | `beta` also gets prerelease versions (such as `0.2.0-beta.1`) when they are published. Useful for a pilot group. |
| `LaunchAtLogin` | boolean | Start WorkPulse when the person signs in to the computer. |
| `EnrollmentToken` | string (`wpe_…`) | Joins the computer to your organization, already approved. See [Enrollment tokens](#enrollment-tokens). |

Invalid values are ignored, including non-https URLs and unknown channels. The app starts normally without them.

### Windows: registry policy

Push these as `HKLM\SOFTWARE\Policies\Tallywork`, through a Group Policy Preference, Intune (OMA-URI or a PowerShell script) or SCCM:

```bat
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v ServerUrl /t REG_SZ /d "https://time.acme.com" /f
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v UpdateChannel /t REG_SZ /d "latest" /f
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v LaunchAtLogin /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v EnrollmentToken /t REG_SZ /d "wpe_…" /f
```

### macOS: configuration profile

Deploy a profile with a Custom Settings payload for the preference domain `app.tallywork.desktop`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>PayloadType</key><string>app.tallywork.desktop</string>
    <key>PayloadIdentifier</key><string>com.acme.tallywork.settings</string>
    <key>PayloadUUID</key><string>6D9C0E1A-1B2C-4D5E-8F90-123456789ABC</string>
    <key>PayloadVersion</key><integer>1</integer>
    <key>ServerUrl</key><string>https://time.acme.com</string>
    <key>UpdateChannel</key><string>latest</string>
    <key>LaunchAtLogin</key><true/>
    <key>EnrollmentToken</key><string>wpe_…</string>
  </dict></array>
  <key>PayloadDisplayName</key><string>Tallywork</string>
  <key>PayloadIdentifier</key><string>com.acme.tallywork</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>0B8E2F43-9A61-4C7D-B2E5-ABCDEF012345</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>
```

Your MDM also needs to pre-approve these, so people aren't prompted:

- **Screen Recording**, only if your organization turns on screenshots;
- **Accessibility** and **Input Monitoring**, for activity levels (keystrokes are counted, never recorded);
- **Automation of browsers**, only if website tracking is on.

Grant them with a Privacy Preferences Policy Control (PPPC) payload for bundle ID `app.tallywork.desktop`. PPPC payloads normally match the app's signing requirement, which an ad-hoc signed build doesn't have yet, so expect people to be prompted until the Mac app is signed.

### Linux: config file

```bash
sudo mkdir -p /etc/tallywork
echo '{ "serverUrl": "https://time.acme.com", "updateChannel": "latest", "launchAtLogin": true, "enrollmentToken": "wpe_…" }' | sudo tee /etc/tallywork/config.json
```

On Wayland, activity, applications and screenshots aren't available (see [Linux packages](#linux-packages)), and the app says so on its **What is monitored** screen.

## Updates

The app checks GitHub Releases every 6 hours, downloads updates in the background and installs them when it quits, never while a timer is running. This covers Windows, the AppImage and the `.deb` (which asks for the administrator password to install). On macOS the unsigned app can't replace itself, so it shows a notification that opens the `/download` page instead.

A release normally reaches everyone at once. Staged rollouts are in [runbooks.md](runbooks.md#desktop-release-staged). To pin a version, block `github.com/marketingcad/tallywork-desktop` at your proxy and deploy new versions yourself. To serve updates from your own server, set `TALLYWORK_UPDATE_URL` to a generic update feed.

## Device approval

If **Settings → Security → Require device approval** is on, newly installed apps stay pending until an admin approves them under **Devices**.

## Enrollment tokens

An enrollment token lets company computers join your organization without an admin approving each one.

1. An admin opens **Devices → Enrollment tokens → New token**, names it (for example after the office or rollout) and can set an expiry date. The token (`wpe_` followed by 43 characters) is shown **once**, with setup lines for each system. Only people who manage devices for the whole organization (System Admins by default) can create, see or revoke tokens.
2. IT puts it in the managed settings as `EnrollmentToken` (above), next to `ServerUrl`, and installs the app.
3. Each person signs in with **their own** email and password (plus two-factor if they use it), or with the browser. The computer joins the token's organization and is **approved at once**, even when device approval is required. It shows a **Managed** badge under Devices, and the app's sign-in screen says the computer was set up by your IT.

What a token does **not** do:

- It never signs anyone in. Without the person's password nothing happens, and the sign-in rate limit applies as usual.
- It works only for members of that organization. Someone who isn't, or who picks another organization on that computer, is refused with "This computer is set up for another organization."
- It is never shown in the app, written to the app's files or logs, or listed again in the web app. WorkPulse stores only a hash of it.

**Revoking and expiry:** new sign-ins on a computer that still has the token are refused with "This computer's enrollment token is no longer valid. Ask your IT team." Computers already set up keep working; to cut one off, revoke that device. To rotate a token, create a new one, push it, then revoke the old one.

**Keep it private.** Treat the token like a Wi-Fi password. On Linux, `/etc/tallywork/config.json` must stay readable by the people who use the app (it runs as them), so any local account can read the token. A leaked token only lets *members of your organization* skip device approval: revoke it and push a new one.
