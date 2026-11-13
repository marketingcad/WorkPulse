import { DEMO_PASSWORD, PEOPLE } from '../env';
import { expect, test, useDesktopWindow } from '../kit';

useDesktopWindow();

const PROJECT = 'Globex — Website Redesign';
const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

test('07.2', async ({ d, page }) => {
  await d.desktop({ signedOut: true });
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  d.begin();
  await d.mark('zoom to the sign-in form', page.getByLabel('Email'), { on: 'sign in with the same email' });
  await d.type(page.getByLabel('Email'), PEOPLE.worker.email);
  await d.type(page.getByLabel('Password', { exact: true }), DEMO_PASSWORD);
  await d.click(page.getByRole('button', { name: 'Sign in', exact: true }));
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await expect(rail).toBeVisible();
  await d.mark('highlight the menu rail', rail, { on: 'the menu on the left' });
  for (const item of ['Home', 'Track', 'Timesheet', 'Time off', 'Schedule', 'Pay stubs', 'Settings']) await d.point(rail.getByRole('button', { name: item, exact: true }), { hold: 900 });
  await d.finish();
});

test('07.3', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  const timer = page.getByRole('region', { name: 'Timer' });
  await d.mark('zoom to the timer card', timer, { on: 'choose a project' });
  await d.choose(timer.getByRole('combobox', { name: 'Project', exact: true }), PROJECT);
  await d.click(timer.getByRole('button', { name: `Clock in to ${PROJECT}` }), { settle: false, on: 'click Clock in' });
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();
  await d.point(timer.getByText('Clocked in', { exact: true }), { hold: 2500, on: 'changes to Clocked in' });
  const breaks = timer.getByRole('group', { name: 'Breaks' });
  await d.mark('highlight the break buttons', breaks, { on: 'Below the timer are the breaks' });
  await d.point(breaks.getByRole('button').first(), { hold: 1800 });
  await d.point(breaks.getByRole('button').last(), { hold: 1800 });
  await d.type(page.getByLabel('Work note'), 'Homepage hero variations');
  await d.point(page.getByText('Today’s summary').or(page.getByText("Today's summary")).first(), { hold: 3000, on: 'summary shows your tracked time' });
  await d.finish();
});

test('07.4', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  const timer = page.getByRole('region', { name: 'Timer' });
  await d.click(timer.getByRole('group', { name: 'Breaks' }).getByRole('button', { name: /Start Lunch break/ }), { settle: false });
  const countdown = timer.getByLabel('Break time');
  await expect(countdown).toBeVisible();
  await d.mark('zoom to the break countdown', countdown, { on: 'shows how long is left' });
  await d.point(countdown, { hold: 5000 });
  await d.click(timer.getByRole('button', { name: 'Clock back in' }), { settle: false, on: 'click Clock back in' });
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible();
  await d.beat(2500);
  // Seven minutes without keyboard or mouse: what the app detects on its own.
  const now = Date.now();
  await d.desktopState({ idlePrompt: { idleId: crypto.randomUUID(), startedAt: new Date(now - 7 * 60_000).toISOString(), endedAt: new Date(now).toISOString() } });
  const idle = page.getByRole('dialog', { name: 'Idle time' });
  await expect(idle).toBeVisible();
  await d.mark('zoom to the idle prompt', idle, { on: 'it asks what to do with that time' });
  await d.beat(4500);
  await d.click(idle.getByRole('button', { name: /Keep/ }), { settle: false });
  await d.finish();
});

test('07.5', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  await d.click(page.getByRole('region', { name: 'Timer' }).getByRole('button', { name: 'Clock out' }), { settle: false });
  const sheet = page.getByRole('dialog', { name: 'Clock out' });
  await d.mark('zoom to the Clock out dialog', sheet, { on: 'click Clock out' });
  await d.type(sheet.getByLabel('End-of-day report'), 'Finished three homepage hero variations and shared them with Maya for review. Next: mobile layouts.');
  await d.click(sheet.getByLabel(/This work is finished/), { settle: false });
  await d.click(sheet.getByRole('button', { name: 'Submit and clock out' }), { settle: false, on: 'Click Submit and clock out' });
  await expect(sheet).toBeHidden();
  await d.point(page.getByText('Today’s summary').or(page.getByText("Today's summary")).first(), { hold: 3000 });
  await d.finish();
});

test('07.6', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await d.click(rail.getByRole('button', { name: 'Track', exact: true }), { on: 'Track holds your work' });
  await d.beat(3000);
  await d.click(page.getByRole('tab', { name: 'Tasks' }), { on: 'Tasks shows your tasks' });
  await d.beat(3000);
  await d.click(page.getByRole('tab', { name: 'Sessions' }), { on: 'Sessions lists the time' });
  await d.beat(2500);
  await d.click(page.getByRole('button', { name: 'Add manual time' }));
  await d.mark('zoom to the Add manual time form', page.getByRole('heading', { name: 'Add manual time' }), { on: 'Click Add manual time' });
  await d.choose(page.getByRole('combobox', { name: 'Project', exact: true }), PROJECT);
  await d.set(page.getByRole('textbox', { name: 'Date', exact: true }), isoDay(-1));
  await d.set(page.getByRole('textbox', { name: 'From', exact: true }), '18:00');
  await d.set(page.getByRole('textbox', { name: 'To', exact: true }), '19:00');
  await d.type(page.getByLabel(/^Reason/), 'Client call from my phone');
  await d.click(page.getByRole('button', { name: /^(Request time|Add time)$/ }), { settle: false });
  await expect(page.getByText(/Request sent|Saved on this computer/).first()).toBeVisible();
  await d.beat(2000);
  await d.finish();
});

test('07.7', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await d.click(rail.getByRole('button', { name: 'Timesheet', exact: true }), { on: 'Timesheet shows your time' });
  await d.point(page.getByText('Hours by day').first(), { hold: 2500, on: 'the hours for each day' });
  await d.click(page.getByRole('button', { name: 'Previous' }), { on: 'Use Previous' });
  await d.beat(1800);
  await d.click(page.getByRole('button', { name: 'Next' }), { on: 'and Next to look' });
  const submit = page.getByRole('button', { name: /^(Submit|Resubmit)$/ });
  if (await submit.isVisible()) {
    await d.mark('highlight the Submit button', submit, { on: 'click Submit' });
    await d.point(submit, { hold: 2500 });
  }
  await d.click(page.getByRole('tab', { name: 'Activity' }), { on: 'Activity shows your own' });
  await d.mark('zoom to Apps and Websites', page.getByText('Apps', { exact: true }).first(), { on: 'the apps and websites' });
  await d.point(page.getByText('Apps', { exact: true }).first(), { hold: 2500 });
  await d.point(page.getByText('Websites', { exact: true }).first(), { hold: 2500 });
  await d.click(page.getByRole('tab', { name: 'Reports' }), { on: 'Reports gives you' });
  await d.choose(page.getByLabel('Period'), 'Last week');
  await d.point(page.getByText('Hours by day', { exact: true }).first(), { hold: 1200, on: 'hours by day and by project' });
  await d.beat(2000);
  await d.finish();
});

test('07.8', async ({ d, page }) => {
  await d.desktop();
  d.begin();
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await d.click(rail.getByRole('button', { name: 'Time off', exact: true }), { on: 'ask for time off, open Time off' });
  await d.click(page.getByRole('button', { name: 'Request time off' }).first(), { settle: false });
  const type = page.getByRole('combobox', { name: 'Type', exact: true });
  await d.mark('zoom to the Request time off form', type, { on: 'click Request time off' });
  await d.choose(type, 'Paid time off');
  // A weekday two to three weeks out, so the request is a normal one for the manager to approve.
  let start = 16;
  while ([0, 6].includes(new Date(Date.now() + start * 86400_000).getUTCDay()) || [0, 6].includes(new Date(Date.now() + (start + 1) * 86400_000).getUTCDay())) start++;
  await d.set(page.getByRole('textbox', { name: 'From', exact: true }), isoDay(start));
  await d.set(page.getByRole('textbox', { name: 'To', exact: true }), isoDay(start + 1));
  await d.type(page.getByLabel(/^Reason/), 'Family trip');
  await d.click(page.getByRole('button', { name: 'Send request' }), { on: 'click Send request' });
  await expect(page.getByText(/Request sent/).first()).toBeVisible();
  await d.beat(2000);
  await d.click(rail.getByRole('button', { name: 'Schedule', exact: true }), { on: 'Schedule shows your working hours' });
  await d.beat(2800);
  await d.click(rail.getByRole('button', { name: 'Pay stubs', exact: true }), { on: 'Pay stubs lists your' });
  await d.beat(2800);
  await d.click(rail.getByRole('button', { name: 'Settings', exact: true }), { on: 'Settings shows who' });
  await d.beat(1500);
  await d.point(page.getByText('Signed in as', { exact: true }), { hold: 1200, on: 'signed in as' });
  await d.point(page.getByText('This device', { exact: true }), { hold: 1200, on: 'and this device' });
  await d.point(page.getByRole('button', { name: 'Sign out' }), { hold: 2000, on: 'lets you sign out' });
  await d.finish();
});
