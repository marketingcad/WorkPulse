import { choice, expect, label, test } from '../kit';

test('04.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Settings' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
  await d.mark('zoom to the Settings tabs', page.getByRole('navigation', { name: 'Settings' }));
  await d.beat(2500);
  await d.mark('zoom to the General panel', page.getByLabel('Organization name'));
  for (const name of ['Organization name', 'Time zone', 'Week starts on', 'Currency', 'Duration format']) await d.point(page.getByLabel(label(name)), { hold: 1100 });
  const brief = page.getByLabel('Company brief');
  await d.scrollTo(brief);
  for (const name of ['Tax ID', 'Full address']) await d.point(page.getByLabel(label(name)), { hold: 1200 });
  await d.point(page.getByRole('button', { name: 'Save changes' }), { hold: 1500 });
  await d.finish();
});

test('04.2', async ({ d, page }) => {
  await d.go('/settings');
  d.begin();
  await d.click(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Time & pay' }));
  const period = page.getByLabel(label('Timesheet period'));
  await d.mark('zoom to Timesheet period', period);
  await d.point(period, { hold: 2500 });
  await d.point(page.getByLabel('Lock time older than (days)'), { hold: 2500 });
  await d.scrollTo(page.getByText('Overtime', { exact: true }).first());
  await d.beat(2500);
  await d.scrollTo(page.getByRole('button', { name: 'Add time type' }).last());
  await d.beat(2500);
  const addBreak = page.getByRole('button', { name: 'Add break type' }).last();
  for (const b of [{ name: 'Coffee', paid: true, max: '15' }, { name: 'Lunch', paid: false, max: '60' }]) {
    await d.scrollTo(addBreak);
    await d.click(addBreak, { settle: false });
    const dialog = page.getByRole('dialog', { name: 'New break type' });
    await d.mark('zoom to the New break type dialog', dialog);
    await d.type(dialog.getByLabel(label('Name')), b.name);
    const paid = dialog.getByLabel('Paid break');
    if ((await paid.isChecked()) !== b.paid) await d.click(paid, { settle: false });
    await d.type(dialog.getByLabel('Maximum length (minutes)'), b.max);
    await d.click(dialog.getByRole('button', { name: 'Add break type' }));
    await expect(dialog).toBeHidden();
  }
  await d.finish();
});

test('04.3', async ({ d, page }) => {
  await d.go('/settings/time');
  d.begin();
  await d.click(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Tracking policies' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Tracking policies' })).toBeVisible();
  await d.beat(2500);
  for (const section of ['Activity', 'Idle', 'Screenshots', 'Apps', 'URLs']) {
    const h = page.getByRole('heading', { level: 2, name: section, exact: true });
    await d.scrollTo(h);
    if (section === 'Screenshots') await d.mark('highlight the Screenshots section', h);
    await d.beat(section === 'Screenshots' ? 3500 : 2200);
  }
  await d.scroll(-3000);
  const team = choice(page.getByRole('group', { name: 'Policy scope' }).or(page.getByRole('radiogroup', { name: 'Policy scope' })), 'Team');
  await d.mark('zoom to the Policy scope switch', team);
  await d.click(team, { settle: false });
  await d.choose(page.getByLabel(label('Team')), 'Client Success');
  await d.settle();
  const reset = page.getByRole('button', { name: 'Reset to inherited' }).or(page.getByRole('link', { name: 'Reset to inherited' })).first();
  await d.scrollTo(reset);
  await d.point(reset, { hold: 3000 });
  await d.finish();
});

test('04.4', async ({ d, page }) => {
  await d.go('/settings/policies');
  d.begin();
  await d.click(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Roles & permissions' }));
  const matrix = page.getByRole('region', { name: 'Permissions by role' });
  await d.mark('zoom to the permission matrix', matrix);
  await d.point(matrix, { hold: 2500 });
  await d.scroll(600);
  await d.beat(2500);
  await d.scroll(-600);
  await d.click(page.getByRole('button', { name: 'Create custom role' }), { settle: false });
  const dialog = page.getByRole('dialog');
  await d.mark('zoom to the Create custom role dialog', dialog);
  await d.type(dialog.getByLabel(label('Name')), 'Project Coordinator');
  await d.choose(dialog.getByLabel('Start from'), 'Team Manager');
  await d.type(dialog.getByLabel('Description'), 'Plans projects and tasks; no money.');
  await d.click(dialog.getByRole('button', { name: 'Create role' }));
  await d.beat(2000);
  await d.finish();
});
