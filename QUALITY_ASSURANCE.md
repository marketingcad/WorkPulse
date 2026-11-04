# Quality Assurance: manual test guide

This guide walks a tester through WorkPulse the way real people use it: an owner sets up the organization, admins and managers run the work, and workers track their time with the desktop app. Each feature lists who uses it, the steps, what should happen, and the business rules to check.

Automated tests already run on every change (see [e2e/README.md](e2e/README.md)). This guide covers what a person should still check by hand: whole journeys, how things look and read, and the rules behind the money.

---

## 0. Before you start

### Where to test

- Test on **staging or a local copy** (`pnpm dev`, http://localhost:3000).
- **Do not create, change or delete anything on the live site.** Live production holds real customer data. On production, only sign in and look.
- Some emails (invitations, password resets) only arrive where email is set up. If email is off, use the invite link the app shows on screen.

### Test accounts

Create one organization for testing. It needs at least these people:

| Account | Role | Used for |
|---|---|---|
| Owner | System Admin, owner of the organization | Everything, including the owner-only actions |
| Admin | System Admin | Admin work without owner rights |
| Manager | Team Manager | Approving their team's time |
| Worker A | Worker, in the manager's team | Tracking time, requests |
| Worker B | Worker, in no team, no payroll | Empty states and access limits |
| Viewer | A custom role, e.g. budgets only | Checking that a narrow role sees only its part |
| Client viewer | Client portal access | The client's own dashboard |

You also need a **second organization** that Worker A is not a member of, to check that one organization never sees another's data.

### Test data

- Use names that show they are test data, e.g. "QA Client 30-Oct".
- Never use real customer names, emails, bank details or card numbers.
- Note the time zone of each account. Times on screen follow the person's time zone.

### Recording results

- Mark each step **Pass**, **Fail**, **Blocked** (could not run) or **N/A**.
- For every Fail, write a defect using the template in section 22. Attach a screenshot.
- Severity:
  - **Critical:** data loss, money wrong, or someone sees data they must not.
  - **High:** a main task cannot be done.
  - **Medium:** wrong or confusing behaviour that has a workaround.
  - **Low:** cosmetic or wording.

---

## 1. Sign-up and first steps

**Who:** a new customer creating an organization.

- [ ] Open `/signup`. Leave every field empty and submit. Each empty field says "This field is required" beside it, and nothing is created.
- [ ] Enter a password under 10 characters. "Use at least 10 characters" appears beside the password.
- [ ] Enter `name@` as the email. "Enter a valid email address…" appears beside the email.
- [ ] Use a name with accents and an apostrophe, e.g. `Zoë O'Brien-Nguyễn`. It is accepted and shown correctly everywhere afterwards.
- [ ] Sign up with an email that already has an account. It is refused, and the existing account is **not** opened.
- [ ] Complete a valid sign-up. You land on the new organization (or a "Check your email" screen when verification is on).
- [ ] The product tour starts on first visit and can be skipped. After skipping, it does not start again.
- [ ] The welcome screen and the empty pages show helpful empty states, not errors.

## 2. Signing in and account security

**Who:** everyone.

- [ ] Sign in with the right email and password. You land on the last organization you used.
- [ ] Type the email in capitals (`OWNER@…`). Sign-in still works.
- [ ] A wrong password and an unknown email give the **same** message, so nobody can tell which emails have accounts.
- [ ] After 8 wrong passwords in a row, the account is locked for about 15 minutes, and the message says to wait.
- [ ] "Remember me" off: close the browser completely and reopen it. You must sign in again.
- [ ] Sign out. The browser's back button does not show private pages.
- [ ] Open a private page while signed out (e.g. `/o/<id>/workers`). You are sent to sign-in, then back to that page after signing in.
- [ ] **Session ended:** sign in on two tabs and sign out in one. Act in the other tab. You are sent to sign-in with "Your session has ended. Sign in again to continue."
- [ ] **Forgot password:**
  - [ ] Request a reset for a known email and for an unknown one. Both show the same "If an account exists… a reset link is on its way".
  - [ ] Open the emailed link and set a new password. The old password stops working.
  - [ ] Open the same link again. It is refused ("This link is invalid or has expired").
  - [ ] Change a few letters of the link. It says the link is invalid or expired.
- [ ] **Two-factor (Profile → Security):**
  - [ ] Turn it on with an authenticator app. Save the recovery codes, then sign in again: a 6-digit code is required.
  - [ ] A wrong code is refused. A recovery code works once only.
  - [ ] Turning two-factor off asks for the password and a code.
- [ ] **Change password (Profile):**
  - [ ] A wrong current password is refused.
  - [ ] The new password must be at least 10 characters, and the confirmation must match.
- [ ] **Email verification** (where it is on): a new account cannot sign in until the emailed link is opened. "Resend link" sends a new one.

## 3. Organizations and invitations

- [ ] **Owner:** create a second organization from the organization switcher. Switch between them. Data never mixes.
- [ ] **Admin:** Members → Invite member. Enter an email, a role, optionally teams and projects.
  - [ ] An invalid email is refused beside the field.
  - [ ] Inviting someone who is already a member is refused ("already a member").
  - [ ] Inviting the same email twice leaves **one** pending invitation.
- [ ] Open the invitation link in a private window. Set a name and password. The person lands in the organization with the role given.
- [ ] Revoke a pending invitation. Its link stops working ("This invitation is invalid or has expired").
- [ ] **Worker A:** cannot see the Invite button, and cannot open the invitations page by typing its address.

## 4. Roles and permissions

**Who:** Owner/Admin sets them up; everyone is affected.

- [ ] Settings → Roles & permissions: create a custom role (e.g. "Viewer": budgets only). Give it to the Viewer account.
- [ ] Sign in as the Viewer. Only the granted areas appear in the menu. Typing another page's address shows a "no access" message, not the data.
- [ ] **Worker A sees only their own:** time, timesheet, activity, time off, schedule and pay stubs. No other people's pay, rates, invoices, payroll, audit log, API keys or webhooks.
- [ ] **Manager sees their team:** their team's time, approvals and live tracking, but not people outside their teams.
- [ ] A worker cannot give themselves a higher role. Their role is unchanged after any attempt.
- [ ] Settings → Access review: lists who has which powerful permissions.
- [ ] Deleting a role that is in use is refused or asks what to do; nobody is left without a role.

## 5. Members

**Who:** Admin.

- [ ] Open a member. Change their title, time zone, employment type and weekly expected hours. Save. "Profile saved" appears, and the values remain after reloading.
- [ ] Set personal pay and bill rates (needs the rates permission). A value like `75.50` saves; `abc` is refused with "Enter an amount like 75 or 75.50".
- [ ] Start and end dates: an end before the start is refused.
- [ ] Personal info: names, birth date, personal email, emergency contact. An invalid email is refused beside the field.
- [ ] Suspend a member. A confirmation explains what happens. The member can no longer sign in or track. Restore them.
- [ ] Remove a member. A confirmation names them. They disappear from active lists, while their past time stays in reports.
- [ ] **Owner only:** reset a member's two-factor. It asks for the owner's password.
- [ ] Export a member's personal data. Delete (anonymise) a member's personal data: you must type their name to confirm.

## 6. Teams

- [ ] Create a team with a name. A blank name cannot be saved.
- [ ] Add Worker A as Member and the Manager as Manager. The Manager now sees Worker A's time and approvals.
- [ ] Remove a member from the team. They lose the manager's view at once.
- [ ] Archive a team. A confirmation explains that members are taken off it.

## 7. Clients and the client portal

**Who:** Admin; the client viewer.

- [ ] Create a client. The Create button stays disabled while the name is blank or only spaces.
- [ ] Create a client with the same name in different capitals (`acme` vs `Acme`). It is refused: "Use another name, or archive the other client". What you typed stays in the form.
- [ ] Add a logo (PNG, JPEG or WebP). Other file types are refused.
- [ ] Press Enter twice quickly on the client form. Only **one** client is created.
- [ ] Archive a client. Its projects are archived too, and an "Undo" option appears. Restore it.
- [ ] **Delete** a client that was never used (actions menu → Delete). The confirmation says it cannot be undone. The client and its empty projects, tasks, rates and budgets disappear. Cancel keeps it.
- [ ] Try to delete a client with invoices, payments, expenses or tracked time. It is refused, the message says why and suggests archiving it instead, and the client stays.
- [ ] Workers and managers do not see Delete. The action is refused for them even if tried directly.
- [ ] **Client portal:**
  - [ ] Turn the portal on for a client, choose the sections (hours, tasks, activity, screenshots) and the projects it covers.
  - [ ] Invite the client viewer by email. They accept and see **only** that client's dashboard and the chosen sections.
  - [ ] The client viewer cannot open any workspace page.
  - [ ] The dashboard date range is limited to 93 days.
  - [ ] Revoke the client's access. Their next visit is refused.

## 8. Projects and tasks

- [ ] Create a project for a client with members, teams, an estimate (hours or days), dates and a colour.
  - [ ] An end date before the start date is refused beside the end date.
  - [ ] Only active members can be added.
- [ ] Add planned breaks to a project (up to 12). Each has a break type, an optional time and a length of 1–480 minutes.
- [ ] Upload a project document (PDF, image, Office, text, CSV or zip, up to 25 MB). Larger or other files are refused. Delete it: a confirmation appears first.
- [ ] Workers only see projects they are members of, on the web and in the desktop app.
- [ ] Archive a project. Nobody can start new time on it, while past time stays. Restore it.
- [ ] **Tasks:**
  - [ ] Create tasks with a status, priority, due date, estimate and assignees.
  - [ ] Change the status from the list.
  - [ ] Archive a task and find it under "Archived". Restore it.
  - [ ] Enter pressed twice creates one task, not two.

## 9. The desktop app (workers)

**Who:** Worker A on their own computer. Install it from `/download`.

- [ ] `/download` offers the right installer for Windows, macOS and Linux, with setup steps.
- [ ] **Sign-in:**
  - [ ] A mistyped email (e.g. `worker@`) shows "Enter a valid email address…". It never does nothing.
  - [ ] A wrong password shows a clear error.
  - [ ] A member of several organizations is asked to choose one.
  - [ ] With two-factor on, a code is asked for.
  - [ ] "Sign in with browser instead" opens the web page, and the app is connected afterwards.
- [ ] If the organization requires device approval, the app waits until an admin approves it in Devices.
- [ ] **Home:** greets the worker by first name and shows today's and this week's totals, active/away time and the current session.
- [ ] **Clock in** on a project (and task). The timer runs, and the session appears in the web app's Live page within a minute.
- [ ] Switch to another project or task without clocking out. The time is split correctly.
- [ ] Take a break of each break type, then resume. Break time is counted as the break type says (paid or unpaid).
- [ ] **Clock out:** the end-of-day report is required (up to 5000 characters, with a warning near the limit). Escape or "Keep working" closes it without clocking out.
- [ ] **Idle:** stay away longer than the idle threshold. On return, the app asks what to do with the idle time (keep, discard or reassign, as the policy allows).
- [ ] **Offline:** disconnect the network while tracking. The app shows "Offline" and keeps tracking. Reconnect: the time arrives in the web app with no gaps and no duplicates.
- [ ] **Recovery:** force-quit the app or put the computer to sleep while tracking. On restart, the app offers to recover or keep the session stopped.
- [ ] **Manual time request:** pick the date (not in the future), times and project, and a reason when the policy requires one. It is sent for approval, or saved on the computer while offline.
- [ ] **Time off request:** the end date cannot be before the start. A half day is possible. The request then appears for the manager.
- [ ] **Timesheet:** review the week and submit it.
- [ ] **Schedule:** shows the worker's shifts.
- [ ] **Pay stubs:** list them and save a PDF where you choose.
- [ ] **Settings → Sign out:** check whether a running timer is stopped, and how.
- [ ] Screenshots, activity and app/URL tracking happen only when the tracking policy turns them on, and the worker is told what is monitored.

## 10. Timer in the web app

- [ ] The timer bar at the top starts, pauses, resumes and stops time on a chosen project.
- [ ] Starting without a project asks you to choose one first.
- [ ] With "single timer: reject" in the policy, starting a second timer (e.g. web while the desktop runs) is refused. With "supersede", the older one stops.
- [ ] Admin/Manager: Time Tracking → Live shows who is working now. "Force stop" asks for confirmation, then stops that timer.

## 11. Time entries and manual time

**Who:** workers for their own time; managers and admins for their people.

- [ ] Time entries lists entries with filters (date range, member, client, project, task, search).
- [ ] **Edit an entry:** change the times, project, task, billable flag, note or time type.
  - [ ] When the policy requires a reason, it must be given.
  - [ ] The editor shows the time zone it uses.
  - [ ] **Conflict:** open the same entry in two tabs, save in one, then in the other. The second save is refused instead of overwriting.
- [ ] **Split** an entry at a time inside it. Two entries result, adding up to the original.
- [ ] **Delete** an entry. A confirmation appears, with a reason when required.
- [ ] **Add manual time.** Check each rule:
  - [ ] The end must be after the start ("End must be after start").
  - [ ] No time in the future ("Manual time cannot be in the future").
  - [ ] At most 24 hours per entry.
  - [ ] Billable time cannot be more than the time logged.
  - [ ] Time overlapping another entry is refused ("This time overlaps another time entry").
  - [ ] A reason is required when the policy says so. Spaces alone do not count.
  - [ ] When manual time needs approval, it waits as a request until a manager approves or rejects it.
- [ ] **Bulk:** select several entries and delete them or mark them billable or non-billable. A confirmation lists how many. Failed items stay selected with a reason.
- [ ] **CSV import:** a file up to 512 KB. Each row shows whether it was imported or why not.
- [ ] **Export CSV:** opens in a spreadsheet. Cells starting with `=`, `+`, `-` or `@` do not run as formulas.
- [ ] **Locked periods:** with "lock after N days" or "lock before date" set (Settings → Time & pay), workers cannot change their own time in the locked period.

## 12. Timesheets and approvals

**Business rule:** timesheet states are Draft → Submitted → Approved, or Rejected / back to Draft. Time can be edited only in Draft or Rejected. Only approved time goes into invoices and payroll.

- [ ] **Worker A:** My timesheet → Submit. A confirmation appears, and the status becomes Submitted. Entries can no longer be edited.
- [ ] **Manager:** Approvals shows the submitted timesheet. Approve it: it becomes Approved and locks.
- [ ] Reject with a comment. The worker sees the comment, can edit and submit again.
- [ ] "Request changes" returns it to Draft with a comment.
- [ ] Reopen an approved timesheet: it goes back to Draft. Its time leaves future invoices and payroll until it is approved again.
- [ ] **Bulk approve:** select several timesheets and approve them. Any that fail stay selected, with the reason.
- [ ] A manager cannot approve timesheets of people outside their teams.
- [ ] **Team week:** shows each member's hours for the week against their expected hours.
- [ ] Minimum daily/weekly hours and the missing-time reminder (Settings → Time & pay) remind people who are short.

## 13. Live tracking, sessions, activity and screenshots

- [ ] **Session history:** lists past sessions. Opening one shows its timeline, breaks and notes.
- [ ] **Activity:**
  - [ ] Shows active/idle time per day, and the apps and websites used when the policy allows.
  - [ ] Screenshots appear only when they are on, blurred when blur is on.
- [ ] **Delete a screenshot:**
  - [ ] Allowed only for those with the permission, or for workers when the policy lets them.
  - [ ] A confirmation appears.
  - [ ] "Also remove time" removes that time too.
- [ ] **End-of-day reports:** managers read the reports written at clock-out.

## 14. Schedules, attendance, holidays and pay rules

- [ ] **Schedules:**
  - [ ] Create a schedule for a member with a time zone, working days and shift times.
  - [ ] A shift that ends before it starts is refused (overnight shifts are split across two days).
  - [ ] "Effective to" before "effective from" is refused.
- [ ] **Attendance:** shows late arrivals, using the late grace minutes from Settings → Time & pay.
- [ ] **Holidays:** add a paid holiday. It appears in schedules and is paid in payroll.
- [ ] **Break types:** name, paid or unpaid, maximum minutes.
- [ ] **Time types** (e.g. Overtime): pay and bill multipliers between 0 and 10, a short name of up to 4 letters, and one default at most. Renaming one keeps its other settings.
- [ ] **Overtime rules:** daily and/or weekly thresholds. Time beyond them counts as overtime in payroll.

## 15. Time off

- [ ] **Policies:**
  - [ ] Create a policy: paid or unpaid, approval needed or not, hours per day.
  - [ ] Accrual: none, annual, monthly or per hour worked, with a maximum balance and carry-over.
  - [ ] It applies to everyone or to chosen members.
- [ ] **Worker A** requests time off. The end date cannot be before the start. A request overlapping another one is refused.
- [ ] **Manager** approves or rejects. The balance changes only on approval.
- [ ] Cancel your own request, and cancel an approved one (a confirmation appears). The balance is given back.
- [ ] **Admin adjusts a balance** by up to ±1000 hours, with a note. Zero is refused.
- [ ] Approved time off is paid in payroll at that day's rate.

## 16. Finance

### 16.1 Rates

**Business rule:** the most specific rate wins.
- **Bill rates:** project + worker → project → worker → client → organization.
- **Pay rates:** project + worker → worker → project → client → organization.

- [ ] Set an organization bill rate, then a client rate, then a project rate. Each new time entry uses the most specific one.
- [ ] A rate with a future "effective from" date only applies from that date.
- [ ] Amounts above 1,000,000.00 per hour, or negative amounts, are refused.
- [ ] Deleting a rate asks for confirmation.

### 16.2 Budgets

- [ ] Set a budget on a project or client, in hours or money, total or monthly, with a warning percentage.
- [ ] Setting a budget where one exists says it replaces it.
- [ ] Track time until the warning percentage. A notification is sent.
- [ ] The Viewer role sees budgets as granted, but not the money amounts.

### 16.3 Expenses

- [ ] **Worker A** adds an expense:
  - [ ] category, date, amount (above 0) and currency;
  - [ ] a receipt (JPEG, PNG, WebP or PDF, up to 10 MB);
  - [ ] the billable and reimbursable flags.
- [ ] The expense takes the currency of its project's client.
- [ ] **Admin** approves, rejects or marks the expense reimbursed. **You cannot approve your own expense.**
- [ ] Billable approved expenses appear on the client's next invoice when "include expenses" is on.

### 16.4 Invoices

**Business rule:** invoices are built from approved billable time and approved billable expenses for one client and period.

- [ ] New invoice: choose the client, the period, the grouping (project, task or worker), tax, extra lines, and the issue and due dates.
- [ ] The preview totals add up: each line is quantity × price, and the total is the subtotal plus tax.
- [ ] A due date before the issue date is refused beside the due date.
- [ ] A period that ends before it starts is refused.
- [ ] A period with nothing approved says "There is no approved billable time or expenses…".
- [ ] A very large quantity (over 100,000) or price is refused beside the line, not with a server error.
- [ ] Invoice numbers go up by one and never repeat.
- [ ] **Draft:** edit the dates and notes. Delete the draft (with confirmation): its time becomes available to invoice again.
- [ ] **Send:** a confirmation appears; the invoice is then sent (or marked as sent).
- [ ] **Void:** a confirmation appears; the voided invoice no longer counts in totals.
- [ ] Download the PDF. It shows the logo, address, tax ID and lines exactly as on screen, in the client's document language.
- [ ] **The same time cannot be invoiced twice.**

### 16.5 Payments received

- [ ] Record a payment with an amount, date, method and reference, allocated to one or more invoices.
- [ ] Allocations larger than the payment are refused.
- [ ] Paying more than an invoice's balance is refused.
- [ ] The same reference twice (also with extra spaces) is refused as a duplicate.
- [ ] Invoices show as partly paid or paid. Removing a payment (with confirmation) reopens the balance.

### 16.6 Payroll

**Business rule:** a member can be in only one pay group per currency. Finalizing locks the amounts and gives every member their pay stub. Time approved later goes into the next payroll.

- [ ] Create a pay group: name, pay period (weekly, biweekly, semimonthly or monthly), currency and members.
- [ ] Adding a member who is already in another pay group with the same currency is refused, and the message names the other group.
- [ ] Rename a pay group. Its members and their bank details stay.
- [ ] Enter a member's bank details. Lists show only the last 4 digits.
- [ ] **Run payroll** for a period. Each line shows approved hours, overtime, time off, holidays and gross pay. A member with no pay rate is flagged.
- [ ] Add bonuses or deductions (labels and amounts). Totals update.
- [ ] Recalculate after approving more time. The new time is included.
- [ ] **Finalize:** the confirmation says it cannot be undone. Amounts lock.
- [ ] **Mark paid:** the run is marked as paid.
- [ ] Delete a draft run (with confirmation). A finalized run cannot be deleted.
- [ ] **Worker A** sees their own pay stub only. Other people's pay stubs are not found.
- [ ] **Reconciliation:** the approved pay for the period, the payroll line and the pay stub all show the same amount.

## 17. Reports and Summary

- [ ] **Summary:** totals for the period match the report library and the time entries.
- [ ] **Report library:** open each report, then filter by members, teams, projects, clients and billable status, and group by up to 3 fields.
- [ ] A range longer than 400 days, or a start after the end, shows "Choose a valid date range".
- [ ] Export each report as CSV, XLSX and PDF. The figures match the screen.
- [ ] **Save a report.** Schedule it:
  - [ ] the schedule needs at least one recipient;
  - [ ] a wrong schedule is refused;
  - [ ] the report arrives on schedule where email is on.
- [ ] Shared saved reports are visible to others with access. Private ones are not.
- [ ] Workers can only run reports on their own data.

## 18. Settings and administration

- [ ] **Organization:**
  - [ ] name, time zone, week start, currency, duration format;
  - [ ] logo (PNG or JPEG), address, tax ID, phone, email and document language.
  - [ ] "Organization settings saved" appears, and the invoice PDF uses the new values.
- [ ] **Time & pay:**
  - [ ] pay period and anchor date, working hours per day (1–24);
  - [ ] time locks, minimum hours, missing-time reminder time, late grace minutes, budget warning percentage.
- [ ] **Tracking policies:**
  - [ ] Settings flow from the organization to teams to members, and the most specific wins.
  - [ ] Set a team override and a member override. Reset one to inherited.
  - [ ] Saving notifies affected members.
  - [ ] A number out of range shows a notice and Save stays disabled.
  - [ ] Switching scope with unsaved changes asks before discarding them.
- [ ] **Security & retention:**
  - [ ] **Require two-factor** for admins or everyone. People without it are asked to set it up. You cannot require it before turning it on yourself.
  - [ ] **Session length** of 1–2160 hours.
  - [ ] **IP allowlist:** an invalid range is refused. A list that would lock you out yourself is refused.
  - [ ] **Data retention:** keep periods per data class. Shortening a period takes effect after 7 days.
- [ ] **Screenshot retention:** set the retention days and schedule. Preview what would be deleted, approve, and run now. Each step asks for confirmation.
- [ ] **Devices:** approve, require sign-in again, or revoke a device. A revoked device is signed out and told why.
- [ ] **API keys:**
  - [ ] Create a key with scopes and an expiry. It is shown once only, and an expiry in the past is refused.
  - [ ] A key works only for its scopes, and revoking it stops it at once.
- [ ] **Webhooks:**
  - [ ] Add an endpoint: the address must use `https://` and be public (not `localhost` or a private address).
  - [ ] Choose events, send a test, rotate the secret (with confirmation), replay a delivery.
- [ ] **Audit log:** each important change above appears with who, what and when. The log can be filtered and exported.
- [ ] **Support access:** grant WorkPulse support time-limited access with a reason, then revoke it.

## 19. Everyday helpers

- [ ] **Notifications:** the bell shows new items (approvals, budget warnings, policy changes). "Mark all read" clears them.
- [ ] **Profile:**
  - [ ] Change the time zone: times move.
  - [ ] Change the language and formats: dates and numbers change.
  - [ ] Change the notification preferences.
  - [ ] Revoke a signed-in device.
- [ ] **Help:** articles open from the Help page and from the "?" links on pages. The tour can be restarted.
- [ ] **Calculator:** works out a shift, then its pay, bill and margin. Its position is remembered after a reload.

## 20. Checks across the whole app

Run these on a sample of pages in every area.

### Forms and messages

- [ ] Required fields are marked. Errors appear beside the right field in plain words. Fixing a field clears its error.
- [ ] After a failed save, what you typed is still there.
- [ ] Save buttons show progress and cannot be pressed twice.
- [ ] Success messages appear only after the save has worked. Reload to confirm.
- [ ] No message ever shows code, database or technical text (e.g. "Too small", "expected string", "SQL", "undefined").

### Lost connection and errors

- [ ] Turn off the network and save something. "We couldn't reach WorkPulse. Check your connection and try again." appears, and your input is kept.
- [ ] Open a page that does not exist (`/no-such-page`). A "Page not found" page offers "Go to your workspace".

### Destructive actions

- [ ] Delete, archive, revoke, void and finalize all ask for confirmation, and **Cancel really cancels**.

### Permissions

- [ ] For each role, type the address of a page it should not see. It shows a "no access" message, never the data.

### Separate organizations

- [ ] Signed in to organization 1, paste a link to organization 2's page. It is refused.

### Screen sizes

- [ ] At desktop (1366 px), tablet (768 px) and phone (390 px), no page scrolls sideways; wide tables scroll inside their box.
- [ ] On a phone, the menu button opens the navigation. It closes with Escape, by tapping outside, or by choosing a page.

### Keyboard and screen readers

- [ ] Every action works with the keyboard alone: Tab, Enter, Space and Escape.
- [ ] Pop-up windows keep focus inside while open, and return it to the button that opened them.
- [ ] Error messages are read out with their field by a screen reader (NVDA on Windows, VoiceOver on Mac).
- [ ] Error toasts can be dismissed and stay while you hover them.

### Browsers

- [ ] Main journeys work in Chrome, Edge, Firefox and Safari.

### Desktop app

- [ ] Main journeys work on Windows and macOS, and survive sleep, restart and network loss.

## 21. One full business cycle (do this every release)

This follows the money from first invite to pay stub, the way a real customer uses WorkPulse. Use the accounts from section 0.

1. [ ] **Owner** sets the organization's currency, time zone and pay period, and adds an organization bill rate and pay rate.
2. [ ] **Admin** creates a client, a project for it with a project bill rate, and a budget of 10 hours.
3. [ ] **Admin** invites Worker A. Worker A accepts, installs the desktop app and signs in.
4. [ ] **Worker A** clocks in on the project, takes a break, works past the idle time once, and clocks out with an end-of-day report.
5. [ ] **Worker A** adds one manual time entry with a reason, and one billable expense with a receipt.
6. [ ] **Manager** approves the manual time and the expense, then approves Worker A's submitted timesheet.
7. [ ] **Admin** checks the Summary and reports. The hours, the bill amount (project rate) and the budget used all match what Worker A tracked.
8. [ ] **Admin** creates the client's invoice for the period. It contains the approved time at the project rate plus the expense. Send it.
9. [ ] **Admin** records the client's payment against the invoice. The invoice shows Paid.
10. [ ] **Admin** runs payroll for the period. Worker A's line matches the approved hours × pay rate, plus any overtime and time off. Finalize and mark paid.
11. [ ] **Worker A** opens the pay stub in the web app and the desktop app. The amount matches the payroll line.
12. [ ] **Client viewer** sees the hours on the client portal.
13. [ ] **Audit log** shows each step.

Any amount that does not match between steps 7, 8, 10 and 11 is a **Critical** defect.

## 22. Defect report template

```
Title:        <what is wrong, in one line>
Area:         <feature / page, e.g. Finance → Invoices → New invoice>
Account/role: <e.g. Manager>
Environment:  <staging / local, browser + version, or desktop app + OS>
Severity:     Critical | High | Medium | Low

Steps:
1.
2.
3.

Expected:     <what should happen>
Actual:       <what happened, with the exact message text>
Evidence:     <screenshot / screen recording / time it happened>
```

Never paste passwords, real bank details or other customers' data into a defect.
