/**
 * Step-by-step setup guides for the desktop app, one per operating system, shown at
 * /download/guide/:platform. Each step names the screenshot that illustrates it: the files live
 * in public/download-guides/<platform>/ (see the README there). A step whose screenshot has not
 * been added yet shows a labelled frame instead.
 */
export type GuidePlatform = 'macos' | 'windows' | 'linux';

export interface GuideStep {
  title: string;
  body: string;
  /** File name in public/download-guides/<platform>/ */
  image: string;
  /** What the screenshot shows (the image's alt text, and the brief for whoever takes it). */
  shows: string;
  tip?: string;
  /** A terminal command for this step, shown in a code block. */
  command?: string;
}

export interface Guide {
  platform: GuidePlatform;
  name: string;
  file: string;
  intro: string;
  before: string[];
  steps: GuideStep[];
  update: { title: string; steps: string[] };
  /** An extra section after the steps (another way to install, for example). */
  extra?: { title: string; intro: string; steps: string[]; commands: string[] };
}

export const GUIDES: Record<GuidePlatform, Guide> = {
  macos: {
    platform: 'macos',
    name: 'macOS',
    file: 'Tallywork-mac.dmg',
    intro: 'Install the WorkPulse desktop app on a Mac (Intel or Apple silicon). It takes about five minutes.',
    before: ['Your WorkPulse email and password (from your invitation).', 'Permission to install apps on this Mac. If your company manages your Mac, it may already be installed.'],
    steps: [
      {
        title: 'Open the downloaded file',
        body: 'Open Tallywork-mac.dmg from your Downloads folder, or click it in the browser’s downloads list.',
        image: '01-open-dmg.png',
        shows: 'The browser downloads list (or the Downloads folder in Finder) with Tallywork-mac.dmg highlighted.',
      },
      {
        title: 'Drag Tallywork into Applications',
        body: 'A window opens with the Tallywork icon and an Applications folder. Drag the Tallywork icon onto the Applications folder.',
        image: '02-drag-to-applications.png',
        shows: 'The .dmg window with the Tallywork icon being dragged onto the Applications folder.',
        tip: 'Updating? Quit WorkPulse from the menu bar first, then choose Replace when asked.',
      },
      {
        title: 'Open Tallywork',
        body: 'Open Finder, go to Applications and double-click Tallywork. The first time, macOS says it cannot verify the app. Click Done.',
        image: '03-cannot-verify.png',
        shows: 'The macOS message “Tallywork” Not Opened / cannot verify the app, with the Done button.',
      },
      {
        title: 'Allow it in Privacy & Security',
        body: 'Open System Settings → Privacy & Security, scroll down to Security and click Open Anyway next to the Tallywork message. Enter your Mac password if asked, then click Open Anyway again.',
        image: '04-open-anyway.png',
        shows: 'System Settings → Privacy & Security, scrolled to Security, with the “Open Anyway” button next to the Tallywork message.',
        tip: 'You only do this once. Updates open normally.',
      },
      {
        title: 'Sign in',
        body: 'WorkPulse opens. Sign in with your WorkPulse email and password.',
        image: '05-sign-in.png',
        shows: 'The WorkPulse desktop sign-in screen with the email and password fields.',
      },
      {
        title: 'Allow Screen Recording (if asked)',
        body: 'If your organization uses screenshots, macOS asks to let Tallywork record the screen. Open System Settings → Privacy & Security → Screen & System Audio Recording, turn on Tallywork, then quit and reopen WorkPulse.',
        image: '06-screen-recording.png',
        shows: 'System Settings → Privacy & Security → Screen & System Audio Recording with the Tallywork switch on.',
        tip: 'If Tallywork is on but screenshots still do not work after an update, remove it with the minus button, add it again, and reopen WorkPulse.',
      },
      {
        title: 'Allow Accessibility and Input Monitoring (if asked)',
        body: 'For activity levels, turn on Tallywork under Privacy & Security → Accessibility and under Input Monitoring. WorkPulse counts keyboard and mouse activity; it never records what you type.',
        image: '07-accessibility.png',
        shows: 'System Settings → Privacy & Security → Accessibility with the Tallywork switch on.',
      },
      {
        title: 'Start tracking',
        body: 'On Home, choose your project and click Clock in. The timer keeps running from the menu bar if you close the window. Click Clock out when you finish; you can add what you completed.',
        image: '08-start-tracking.png',
        shows: 'The WorkPulse Home screen, clocked in on a project with the timer running.',
      },
    ],
    update: {
      title: 'Updating later',
      steps: [
        'When a new version is out, WorkPulse shows a notification that opens the download page.',
        'Quit WorkPulse from the menu bar, open the new Tallywork-mac.dmg and drag Tallywork into Applications. Choose Replace.',
        'You stay signed in and your tracked time is kept. If macOS asks again for Screen Recording, allow it.',
      ],
    },
  },
  windows: {
    platform: 'windows',
    name: 'Windows',
    file: 'Tallywork-Setup.exe',
    intro: 'Install the WorkPulse desktop app on Windows 10 or 11. It takes about three minutes.',
    before: ['Your WorkPulse email and password (from your invitation).', 'No administrator rights needed: it installs for your Windows account only.'],
    steps: [
      {
        title: 'Open the downloaded file',
        body: 'Open Tallywork-Setup.exe from your Downloads folder, or click it in the browser’s downloads list.',
        image: '01-open-installer.png',
        shows: 'The browser downloads list (or File Explorer’s Downloads folder) with Tallywork-Setup.exe highlighted.',
      },
      {
        title: 'If Windows protects your PC, click More info',
        body: 'Windows may show “Windows protected your PC”, because the installer is new to it. Click More info under the message. Do not click Don’t run.',
        image: '02-more-info.png',
        shows: 'The blue “Windows protected your PC” window, with the More info link under the message.',
      },
      {
        title: 'Click Run anyway',
        body: 'Check that the app is Tallywork-Setup.exe, then click Run anyway.',
        image: '03-run-anyway.png',
        shows: 'The “Windows protected your PC” window after clicking More info, showing Tallywork-Setup.exe and the Run anyway button.',
        tip: 'Windows shows this only for the first install.',
      },
      {
        title: 'Install',
        body: 'Click Next. Keep the suggested folder (or choose another), then click Install.',
        image: '04-install.png',
        shows: 'The Tallywork setup wizard’s Welcome page, with the Next button.',
      },
      {
        title: 'Finish',
        body: 'Click Finish. WorkPulse opens and its icon appears in the system tray, next to the clock.',
        image: '05-finish.png',
        shows: 'The last setup screen, “Completing the Tallywork Setup Wizard”, with the Finish button.',
        tip: 'If you see “Run Tallywork”, leave it ticked. Updating? Run the new installer over the old version; you stay signed in.',
      },
      {
        title: 'Sign in',
        body: 'Sign in with your WorkPulse email and password.',
        image: '06-sign-in.png',
        shows: 'The WorkPulse desktop sign-in screen with the email and password fields.',
      },
      {
        title: 'Start tracking',
        body: 'On Home, choose your project and click Clock in. Closing the window keeps the timer running in the system tray. Click Clock out when you finish; you can add what you completed.',
        image: '07-start-tracking.png',
        shows: 'The WorkPulse Home screen, clocked in on a project with the timer running.',
      },
    ],
    update: {
      title: 'Updating later',
      steps: ['WorkPulse downloads updates by itself and installs them when you quit it, never while a timer is running.', 'You stay signed in and your tracked time is kept.'],
    },
  },
  linux: {
    platform: 'linux',
    name: 'Ubuntu / Debian',
    file: 'Tallywork-linux.deb',
    intro: 'Install the WorkPulse desktop app on Ubuntu 22.04 or later, or Debian 12 or later. It takes about five minutes.',
    before: [
      'Your WorkPulse email and password (from your invitation).',
      'Your computer password: installing needs administrator (sudo) rights.',
      'If your organization tracks activity or screenshots, the “Ubuntu on Xorg” session (step 5). Linux does not allow tracking under the default Wayland session.',
    ],
    steps: [
      {
        title: 'Open a terminal in your Downloads folder',
        body: 'Open Files, go to Downloads, right-click an empty area and choose Open in Terminal.',
        image: '01-open-terminal.png',
        shows: 'The Files app in the Downloads folder, with Tallywork-linux.deb and a right-click menu with Open in Terminal highlighted.',
      },
      {
        title: 'Install the package',
        body: 'Type this command, press Enter, then enter your computer password. Nothing shows while you type the password; that is normal. Type Y and press Enter if asked to continue.',
        command: 'sudo apt install ./Tallywork-linux.deb',
        image: '02-apt-install.png',
        shows: 'The terminal after running sudo apt install ./Tallywork-linux.deb, with the installation finished.',
        tip: 'This also installs everything the app needs, and a desktop keyring if you do not have one.',
      },
      {
        title: 'Open Tallywork',
        body: 'Open Show Apps (or press the Super key), type Tallywork and click it. You can right-click its icon in the dock and choose Pin to Dash.',
        image: '03-open-app.png',
        shows: 'Show Apps with “Tallywork” typed in the search and the Tallywork app icon.',
      },
      {
        title: 'Sign in',
        body: 'Sign in with your WorkPulse email and password. If Ubuntu asks you to unlock or create a keyring, use your computer password: WorkPulse keeps your sign-in there.',
        image: '04-sign-in.png',
        shows: 'The WorkPulse desktop sign-in screen with the email and password fields.',
        tip: 'If the app says no keyring was found, install one with: sudo apt install gnome-keyring, then sign out of Ubuntu and back in.',
      },
      {
        title: 'Use “Ubuntu on Xorg” if your organization tracks activity',
        body: 'Under Ubuntu’s default Wayland session, Linux does not let apps see activity, other apps or the screen. Sign out of Ubuntu, click your name, click the gear icon at the bottom right, choose Ubuntu on Xorg and sign in. Ubuntu remembers the choice.',
        image: '05-ubuntu-on-xorg.png',
        shows: 'The Ubuntu login screen with the gear menu open and “Ubuntu on Xorg” selected.',
        tip: 'To check which session you are in, run: echo $XDG_SESSION_TYPE (it should say x11).',
      },
      {
        title: 'Start tracking',
        body: 'On Home, choose your project and click Clock in. Closing the window keeps the timer running in the top bar. Click Clock out when you finish; you can add what you completed.',
        image: '06-start-tracking.png',
        shows: 'The WorkPulse Home screen, clocked in on a project with the timer running.',
      },
    ],
    update: {
      title: 'Updating later',
      steps: ['WorkPulse downloads updates by itself and installs them when you quit it, never while a timer is running. It asks for your computer password to install.', 'You stay signed in and your tracked time is kept.'],
    },
    extra: {
      title: 'Other Linux distributions (AppImage)',
      intro: 'Not on Ubuntu or Debian? Download the AppImage from the download page instead, then:',
      steps: ['Install libfuse2 (libfuse2t64 on Ubuntu 24.04) and a desktop keyring such as gnome-keyring, with your distribution’s package manager.', 'Make the file executable and run it.'],
      commands: ['chmod +x Tallywork-linux.AppImage', './Tallywork-linux.AppImage'],
    },
  },
};

export const isGuidePlatform = (p: string): p is GuidePlatform => p === 'macos' || p === 'windows' || p === 'linux';
export const guideImagePath = (platform: GuidePlatform, image: string) => `/download-guides/${platform}/${image}`;
