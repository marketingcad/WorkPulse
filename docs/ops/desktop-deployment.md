# Deploying the desktop app with device management

This page is for IT administrators who install Tallywork on company computers with Intune, Group Policy, SCCM, Jamf, Kandji or a Linux configuration tool. It covers the installers, silent installation, and the settings you can push to every machine.

Each person still signs in once, in their browser, the first time the app opens. The desktop app never sees passwords, and device tokens are tied to that person.

## Installers

| Platform | File | Use |
|---|---|---|
| Windows | `Tallywork-<version>-x64.msi` | Per-machine silent install (Intune, Group Policy, SCCM) |
| Windows | `Tallywork-Setup-<version>.exe` | Interactive install by the person |
| macOS | `Tallywork-<version>.pkg` | Installs to `/Applications` for all users (Jamf, Kandji, Intune) |
| macOS | `.dmg`, `.zip` | Interactive install, and the auto-update feed |
| Linux | `.deb`, `.AppImage` | Package manager or direct |

Every file is code-signed: Authenticode on Windows, Developer ID plus notarization on macOS. Build them on the release runners with `pnpm --filter @tallywork/desktop dist`, with the signing variables set. Native modules are rebuilt there, which needs Python and a C++ toolchain.

## Silent install

**Windows:**

```bat
msiexec /i Tallywork-1.4.0-x64.msi /qn /norestart
```

**macOS:**

```bash
sudo installer -pkg Tallywork-1.4.0.pkg -target /
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt install ./tallywork_1.4.0_amd64.deb
```

## Managed settings

Managed values override anything a person set, and lock the matching controls in the app. For example, the server field on the sign-in screen is hidden when the server is managed.

| Setting | Type | Meaning |
|---|---|---|
| `ServerUrl` | string (https) | Your Tallywork address, e.g. `https://time.acme.com`. Required for self-hosted or custom domains. |
| `UpdateChannel` | `latest` \| `beta` | `beta` gets releases about 2 days early. Useful for a pilot group. |
| `LaunchAtLogin` | boolean | Start Tallywork when the person signs in to the computer. |

Invalid values are ignored, including non-https URLs and unknown channels. The app starts normally without them.

### Windows: registry policy

Push these as `HKLM\SOFTWARE\Policies\Tallywork`, through a Group Policy Preference, Intune (OMA-URI or a PowerShell script) or SCCM:

```bat
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v ServerUrl /t REG_SZ /d "https://time.acme.com" /f
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v UpdateChannel /t REG_SZ /d "latest" /f
reg add "HKLM\SOFTWARE\Policies\Tallywork" /v LaunchAtLogin /t REG_DWORD /d 1 /f
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

Grant them with a Privacy Preferences Policy Control (PPPC) payload for bundle ID `app.tallywork.desktop`.

### Linux: config file

```bash
sudo mkdir -p /etc/tallywork
echo '{ "serverUrl": "https://time.acme.com", "updateChannel": "latest", "launchAtLogin": true }' | sudo tee /etc/tallywork/config.json
```

On Wayland, screenshots and input activity aren't available, and the app says so on its **What is monitored** screen.

## Updates

The app checks for updates every 6 hours and installs them when it quits, never while a timer is running. Rollouts are staged: beta first, then a growing share of the `latest` channel ([runbooks.md](runbooks.md#desktop-release-staged)). To pin a version, block the update URL at your proxy and deploy new MSI/PKG versions yourself.

## Device approval

If **Settings → Security → Require device approval** is on, newly installed apps stay pending until an admin approves them under **Devices**.
