import { expect, label, test } from '../kit';

test('05.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Workforce' });
  await d.point(group, { hold: 1200, on: 'open Workforce' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: 'Members' }));
  await d.click(page.getByRole('button', { name: 'Invite member' }).first(), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Invite member' });
  await d.mark('zoom to the Invite member dialog', dialog, { on: 'click Invite member' });
  await d.type(dialog.getByLabel('Email'), 'leo.martins@demo.tallywork.app');
  await d.type(dialog.getByLabel(label('Name')), 'Leo Martins');
  await d.point(dialog.getByLabel('Role'), { hold: 1500 });
  await d.click(dialog.getByRole('button', { name: 'Teams' }), { settle: false, on: 'put them in teams' });
  await d.click(page.getByRole('option', { name: 'Design' }).getByRole('checkbox'), { settle: false });
  await page.keyboard.press('Escape');
  await d.click(dialog.getByRole('button', { name: 'Projects' }), { settle: false, on: 'give them projects' });
  await d.click(page.getByRole('option', { name: /Globex — Website Redesign/ }).getByRole('checkbox'), { settle: false });
  await page.keyboard.press('Escape');
  await d.click(dialog.getByRole('button', { name: 'Send invitation' }), { on: 'Click Send invitation' });
  const ready = page.getByRole('dialog', { name: 'Invitation ready' });
  const link = ready.getByLabel('Invitation link');
  await expect(link).toBeVisible();
  await d.mark('highlight the invitation link', link, { on: 'the dialog shows the invitation link' });
  await d.point(link, { hold: 3500 });
  await d.click(ready.getByRole('button', { name: 'Done' }));
  const pending = page.getByText(/Pending invitations/).first();
  await d.scrollTo(pending);
  await d.point(pending, { hold: 2000, on: 'under Pending invitations' });
  await d.finish();
});

test('05.2', async ({ d, page }) => {
  await d.go('/workers');
  d.begin();
  await d.type(page.getByLabel('Search members'), 'Ava');
  await d.settle();
  await d.click(page.getByText('Ava Okafor', { exact: true }).first());
  await expect(page.getByRole('heading', { level: 1, name: 'Ava Okafor' })).toBeVisible();
  const tabs = page.getByRole('group', { name: 'Sections' });
  await d.mark('zoom to the profile tabs', tabs, { on: 'Click a member to open their profile' });
  await d.point(page.getByText('Access', { exact: true }).first(), { hold: 2500 });
  await d.mark('highlight the Access panel', page.getByText('Access', { exact: true }).first(), { on: 'quick links and access' });
  for (const tab of ['Personal info', 'Time', 'Projects', 'Devices', 'Policy']) {
    await d.click(tabs.getByRole('button', { name: tab, exact: true }));
    await d.beat(2600);
  }
  await d.finish();
});

test('05.3', async ({ d, page }) => {
  await d.go('/workers');
  d.begin();
  await d.click(page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Teams', exact: true }).or(page.getByRole('link', { name: 'Teams', exact: true })).first(), { on: 'Teams group people' });
  await d.click(page.getByRole('button', { name: 'New team' }), { settle: false, on: 'click New team' });
  const dialog = page.getByRole('dialog', { name: 'New team' });
  await d.type(dialog.getByLabel(label('Name')), 'Video Production');
  await d.type(dialog.getByLabel('Description'), 'Product videos and tutorials');
  await d.click(dialog.getByRole('button', { name: 'Create team' }), { on: 'click Create team' });
  const drawer = page.getByRole('dialog', { name: 'Video Production' });
  await expect(drawer).toBeVisible();
  await d.mark('zoom to the team panel', drawer, { on: 'Then add people' });
  for (const m of [{ name: 'Priya Silva', role: 'MANAGER' }, { name: 'Kenji Mensah', role: 'MEMBER' }]) {
    await d.choose(drawer.getByLabel('Add member'), m.name);
    await d.select(drawer.getByLabel(label('Role')), m.role);
    if (m.role === 'MANAGER') {
      await d.point(drawer.getByLabel(label('Role')), { hold: 1200, on: 'the Manager role' });
      await d.point(drawer.getByRole('heading', { name: 'Video Production' }), { hold: 1200, on: 'the new Video Production team' });
    }
    await d.click(drawer.getByRole('button', { name: 'Add', exact: true }), { settle: false });
    await expect(drawer.getByText(m.name).first()).toBeVisible();
    await d.beat(1200);
  }
  await d.finish();
});
