import type { Chapter } from '../scenes';

export const ch02: Chapter = {
  n: 2,
  title: 'Getting started: sign up, sign in and stay secure',
  goal: 'Create an organization, sign in, recover a password, join from an invitation and turn on two-factor sign-in.',
  scenes: [
    {
      id: '02.1',
      title: 'Create your organization',
      persona: 'guest',
      app: 'web',
      screen: 'The "Create your organization" page, then the new organization\'s Overview with the "Getting started" checklist.',
      actions: [
        'Open the sign-up page.',
        'Type "Jordan Lee" in Your name.',
        'Type "Brightside Studio" in Organization name.',
        'Type "jordan@brightside.example" in Work email.',
        'Type a password of at least 10 characters.',
        'Click "Create organization".',
        'On the new Overview, point at the "Getting started" checklist and its five steps.',
      ],
      narration:
        'To start using WorkPulse, create your organization. Enter your name, the name of your company, your work email and a password of at least ten characters. Then click Create organization. You are the owner of this new organization, and WorkPulse takes you straight to the Overview. For a new organization, the Overview shows a Getting started checklist with five steps: invite your team, create a project, set pay and bill rates, connect the desktop app, and review what is tracked. Each step links to the right page, and it ticks itself off as you go. You can hide the checklist at any time.',
      overlays: ['Callout on the password field: "At least 10 characters"', 'Checklist callout: "5 steps to get started"'],
      focus: ['Zoom to the form (125%) while typing.', 'Zoom to the "Getting started" checklist after sign-up.'],
      transition: 'Cut to the sign-in page.',
    },
    {
      id: '02.2',
      title: 'Sign in and reset a forgotten password',
      persona: 'guest',
      app: 'web',
      screen: 'The "Welcome Back" sign-in page, the "Reset your password" page, then signing in.',
      actions: [
        'Open the sign-in page.',
        'Click "Forgot password?".',
        'Type the work email and click "Send reset link"; point at the confirmation.',
        'Click "Back to sign in".',
        'Type the work email and password; click "Show password" to check it, then click "Sign in".',
      ],
      narration:
        'Next time, sign in from the Welcome Back page. If you forget your password, click Forgot password, enter your work email and click Send reset link. WorkPulse emails you a link to choose a new password. For your privacy, the message is the same whether or not the address has an account. Back on the sign-in page, enter your email and password. The eye button shows the password so you can check it. Click Sign in, and WorkPulse opens the organization you used last.',
      overlays: ['Callout: "Reset links arrive by email"'],
      focus: ['Highlight the "Forgot password?" link.', 'Zoom to the confirmation message after "Send reset link".'],
      transition: 'Cut to an invitation link opening in the browser.',
    },
    {
      id: '02.3',
      title: 'Join from an invitation',
      persona: 'guest',
      app: 'web',
      screen: 'The "You have been invited" page that opens from an invitation link, then the Overview of the organization the person joined.',
      actions: ['Open the invitation link.', 'Check the name in "Your name".', 'Type a password in "Choose a password".', 'Click "Join organization".', 'Point at the Overview that opens.'],
      narration:
        'When someone invites you to their organization, you receive an invitation link. Opening it shows this page. Check your name, choose a password and click Join organization. Managers and administrators land in the web app, ready to work. Workers are taken to a page where they download the desktop app instead, because that is where they track their time. You will see that page in the desktop chapter.',
      overlays: ['Callout: "Workers are sent to the desktop app download page"'],
      focus: ['Zoom to the invitation form.'],
      transition: 'Cut to the Profile page.',
    },
    {
      id: '02.4',
      title: 'Turn on two-factor sign-in',
      persona: 'guest',
      app: 'web',
      screen: 'Profile › Two-factor authentication: password check, QR code, the 6-digit code, then the recovery codes.',
      actions: [
        'Open the account menu, then Profile & devices, and scroll to Two-factor authentication.',
        'Click "Set up", enter the password and click "Continue".',
        'Point at the QR code (scan it with an authenticator app).',
        'Type the 6-digit code from the app in "Code" and click "Turn on".',
        'Point at the recovery codes and the "Download" button.',
        'Tick "I have saved these codes somewhere safe" and click "Done".',
      ],
      narration:
        'Protect your account with two-factor sign-in. Open the account menu, choose Profile and devices, and find Two-factor authentication. Click Set up and confirm your password. Scan the QR code with an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator, then type the six-digit code it shows and click Turn on. WorkPulse now gives you ten recovery codes. Each one works once, if you ever lose your phone. Download them and keep them somewhere safe, tick the box and click Done. From now on, signing in asks for a code from your phone. Administrators can also require two-factor for everyone, which we will see in the security chapter.',
      overlays: ['Callout on the QR code: "Scan with your authenticator app"', 'Callout on the codes: "Each recovery code works once"'],
      focus: ['Zoom to the QR code.', 'Zoom to the recovery codes, then to the "Done" button.'],
      transition: 'Wipe to a chapter card: "Chapter 3 — Finding your way".',
    },
  ],
};
