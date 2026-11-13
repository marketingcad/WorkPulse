import { expect, test } from '../kit';
import { AI_SCRIPT } from '../script/ch16-ai';

// Every AI text on camera is scripted (tutorial/assistant.ts): the server's test mode only makes
// WorkPulse AI appear.

test('16.1', async ({ d, page }) => {
  const { attention, howApprove } = AI_SCRIPT;
  await d.scriptAnswer(attention.question, attention.answer, attention.title);
  await d.scriptAnswer(howApprove.question, howApprove.answer);
  await d.go('');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  d.begin();
  await d.click(page.getByRole('button', { name: 'Ask WorkPulse AI' }).first(), { settle: false, on: 'Click Ask WorkPulse AI' });
  const panel = page.getByRole('dialog', { name: /WorkPulse AI/ }).or(page.getByRole('complementary', { name: /WorkPulse AI/ })).first();
  await expect(panel).toBeVisible();
  await d.mark('zoom to the WorkPulse AI panel', panel, { on: 'It suggests questions' });
  await d.click(panel.getByRole('button', { name: attention.question }), { settle: false, on: 'what needs your attention this week' });
  const answer = panel.getByText('Timesheets waiting for approval.', { exact: false }).first();
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await d.mark('zoom to the answer', answer, { on: 'looks through approvals, budgets and attendance' });
  await d.beat(3500);
  const input = panel.getByRole('textbox').first();
  await d.type(input, howApprove.question, { on: 'Ask how to do something' });
  await page.keyboard.press('Enter');
  await expect(panel.getByText('Request changes', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await d.beat(3000);
  await d.point(panel.getByText(/Answers can be wrong/).first(), { hold: 2500, on: 'It can be wrong' });
  await d.finish();
});

test('16.2', async ({ d, page }) => {
  const { explainTimesheets } = AI_SCRIPT;
  await d.scriptAnswer(explainTimesheets.question, explainTimesheets.answer, 'Timesheets waiting for approval');
  await d.go('/ai-insights');
  await expect(page.getByRole('heading', { level: 1, name: 'AI Insights' })).toBeVisible();
  d.begin();
  const tabs = page.getByRole('group', { name: 'Sections' });
  await d.mark('zoom to the period switch and tabs', tabs, { on: 'Choose a period' });
  await d.point(tabs, { hold: 2500 });
  const card = page.getByText(/timesheets? (is|are) waiting for approval/).first().locator('xpath=ancestor::article[1]');
  await d.scrollTo(card);
  await d.mark('zoom to a finding card', card, { on: 'Each finding says what was found' });
  await d.beat(4000);
  await d.click(card.getByRole('button', { name: 'Explain with WorkPulse AI' }), { settle: false, on: 'Click Explain with WorkPulse AI' });
  const panel = page.getByRole('dialog', { name: /WorkPulse AI/ }).or(page.getByRole('complementary', { name: /WorkPulse AI/ })).first();
  const explanation = panel.getByText('Why it matters:', { exact: false }).first();
  await expect(explanation).toBeVisible({ timeout: 15_000 });
  await d.mark('zoom to the explanation', explanation, { on: 'explains the finding' });
  await d.beat(3500);
  await page.keyboard.press('Escape');
  await d.finish();
});

test('16.3', async ({ d, page }) => {
  const { projectDescription, reminder } = AI_SCRIPT;
  await d.scriptDraft(projectDescription.text, projectDescription.facts);
  await d.scriptDraft(reminder.text, reminder.facts);
  await d.go('/projects');
  d.begin();
  await d.click(page.getByText('Globex — Website Redesign', { exact: true }).first());
  await d.click(page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }));
  const write = page.getByRole('button', { name: 'Write with AI' }).first();
  await d.scrollTo(write);
  await d.click(write, { settle: false, on: 'click Write with AI' });
  await d.click(page.getByRole('menuitem', { name: 'Draft from what WorkPulse knows' }), { settle: false, on: 'Draft from what WorkPulse knows' });
  const draft = page.getByText(projectDescription.text.slice(0, 40), { exact: false }).first().or(page.getByRole('textbox', { name: /Description/ }).first());
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible({ timeout: 15_000 });
  await d.mark('zoom to the description and its draft', draft, { on: 'It writes a description' });
  await d.point(page.getByRole('button', { name: 'Undo' }), { hold: 2000, on: 'click Undo' });
  await d.go('/ai-insights?tab=timesheets');
  await d.click(page.getByRole('button', { name: 'Last week', exact: true }).or(page.getByRole('radio', { name: 'Last week', exact: true })).first(), { settle: false });
  const missing = page.getByText(/not been submitted/).first().locator('xpath=ancestor::article[1]');
  await expect(missing).toBeVisible({ timeout: 15_000 });
  await d.click(missing.getByRole('button', { name: 'Draft reminder' }), { settle: false, on: 'Draft reminder' });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(reminder.text.slice(0, 40), { exact: false }).first().or(dialog.getByRole('textbox').first())).toBeVisible({ timeout: 15_000 });
  await d.mark('zoom to the reminder draft', dialog, { on: 'a friendly reminder' });
  await d.beat(3500);
  await page.keyboard.press('Escape');
  await d.finish();
});

test('16.4', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('button', { name: /^Notifications/ }), { settle: false, on: 'Notifications now come sorted by priority' });
  const panel = page.getByRole('dialog').or(page.getByRole('menu')).first();
  await d.mark('zoom to the notifications panel', panel, { on: 'similar notifications are grouped' });
  await d.point(panel.getByText(/^\+\d+ more$/).first(), { hold: 2500, on: 'Open a group' });
  await page.keyboard.press('Escape');
  await d.click(page.getByRole('button', { name: 'Account menu' }), { settle: false, on: 'open your account menu' });
  await d.click(page.getByRole('menuitem', { name: 'Profile & devices' }), { on: 'Profile and devices' });
  const weekly = page.getByText('Weekly summary of what needs my attention (AI Insights)').first();
  await d.scrollTo(weekly);
  await d.mark('highlight the weekly summary setting', weekly.locator('xpath=ancestor::*[self::li or self::label or self::tr][1]').or(weekly).first(), { on: 'a weekly summary' });
  await d.beat(3500);
  await d.finish();
});
