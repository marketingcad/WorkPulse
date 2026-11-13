import { type Anchor, choice, expect, label, test } from '../kit';

test('04.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }));
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Organization' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
  await d.mark('zoom to the Settings menu', page.getByRole('complementary', { name: 'Primary' }).getByRole('navigation', { name: 'Settings' }), { on: 'Open Settings' });
  await d.beat(2500);
  await d.mark('zoom to the General panel', page.getByLabel('Organization name'), { on: 'the General panel' });
  for (const name of ['Organization name', 'Time zone', 'Week starts on', 'Currency', 'Duration format']) await d.point(page.getByLabel(label(name)), { hold: 1100 });
  const brief = page.getByLabel('Company brief');
  await d.scrollTo(brief);
  await d.point(page.getByRole('heading', { level: 2, name: 'Company profile' }), { hold: 1200, on: 'The Company profile below' });
  for (const name of ['Tax ID', 'Full address']) await d.point(page.getByLabel(label(name)), { hold: 1200 });
  await d.point(page.getByRole('button', { name: 'Save changes' }), { hold: 1500, on: 'click Save changes' });
  await d.finish();
});

test('04.2', async ({ d, page }) => {
  await d.go('/settings');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Time & pay' }), { on: 'The Time and pay page' });
  const period = page.getByLabel(label('Timesheet period'));
  await d.mark('zoom to Timesheet period', period, { on: 'The timesheet period' });
  await d.point(period, { hold: 2500 });
  await d.point(page.getByLabel('Lock time older than (days)'), { hold: 2500, on: 'Timesheet rules can lock old time' });
  await d.scrollTo(page.getByText('Overtime', { exact: true }).first(), { on: 'the overtime rules' });
  await d.beat(2500);
  await d.scrollTo(page.getByRole('button', { name: 'Add time type' }).last(), { on: 'your time types' });
  await d.beat(2500);
  const addBreak = page.getByRole('button', { name: 'Add break type' }).last();
  // One break type; called once per break so each call's anchors sit in narration order in the source.
  const addBreakType = async (b: { name: string; paid: boolean; max: string }, on: { scroll?: Anchor; open?: Anchor; dialog?: Anchor; paid?: Anchor } = {}) => {
    await d.scrollTo(addBreak, on.scroll);
    await d.click(addBreak, { settle: false, ...on.open });
    const dialog = page.getByRole('dialog', { name: 'New break type' });
    await d.mark('zoom to the New break type dialog', dialog, on.dialog);
    await d.type(dialog.getByLabel(label('Name')), b.name);
    const paid = dialog.getByLabel('Paid break');
    if (on.paid) await d.point(paid, { hold: 1200, ...on.paid });
    if ((await paid.isChecked()) !== b.paid) await d.click(paid, { settle: false });
    await d.type(dialog.getByLabel('Maximum length (minutes)'), b.max);
    await d.click(dialog.getByRole('button', { name: 'Add break type' }));
    await expect(dialog).toBeHidden();
  };
  await addBreakType({ name: 'Coffee', paid: true, max: '15' }, { scroll: { on: 'Break types define' }, dialog: { on: 'add a coffee break' }, paid: { on: 'make it a paid break' } });
  await addBreakType({ name: 'Lunch', paid: false, max: '60' }, { open: { on: 'And a lunch break' } });
  await d.finish();
});

test('04.3', async ({ d, page }) => {
  await d.go('/settings/time');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Tracking policies' }), { on: 'Tracking policies decide' });
  await expect(page.getByRole('heading', { level: 1, name: 'Tracking policies' })).toBeVisible();
  const confirm = page.getByLabel(/Wait for the desktop app to confirm a new timer for/).first();
  await d.scrollTo(confirm);
  await d.point(confirm, { hold: 2500, on: 'once the app confirms it is running' });
  for (const section of ['Activity', 'Idle', 'Screenshots', 'Apps', 'URLs']) {
    const h = page.getByRole('heading', { level: 2, name: section, exact: true });
    await d.scrollTo(h);
    if (section === 'Screenshots') await d.mark('highlight the Screenshots section', h, { on: 'Screenshots can be switched on' });
    await d.beat(section === 'Screenshots' ? 3500 : 2200);
  }
  await d.scroll(-3000);
  const team = choice(page.getByRole('group', { name: 'Policy scope' }).or(page.getByRole('radiogroup', { name: 'Policy scope' })), 'Team');
  await d.mark('zoom to the Policy scope switch', team, { on: 'override any setting for a team' });
  await d.click(team, { settle: false });
  await d.choose(page.getByLabel(label('Team')), 'Client Success');
  await d.settle();
  await d.point(page.getByLabel(label('Team')), { hold: 1500, on: 'the Client Success team' });
  const reset = page.getByRole('button', { name: 'Reset to inherited' }).or(page.getByRole('link', { name: 'Reset to inherited' })).first();
  await d.scrollTo(reset);
  await d.point(reset, { hold: 3000, on: 'shows Reset to inherited' });
  await d.finish();
});

test('04.4', async ({ d, page }) => {
  await d.go('/settings/policies');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Roles & permissions' }));
  const matrix = page.getByRole('region', { name: 'Permissions by role' });
  await d.point(matrix.getByText('Team Manager', { exact: true }).first(), { hold: 1500, on: 'Team Manager for running teams' });
  await d.mark('zoom to the permission matrix', matrix, { on: 'The matrix shows every permission' });
  await d.point(matrix, { hold: 2500 });
  await d.scroll(600);
  await d.beat(2500);
  await d.scroll(-600);
  await d.click(page.getByRole('button', { name: 'Create custom role' }), { settle: false });
  const dialog = page.getByRole('dialog');
  await d.mark('zoom to the Create custom role dialog', dialog, { on: 'create a custom role' });
  await d.type(dialog.getByLabel(label('Name')), 'Project Coordinator');
  await d.point(dialog.getByLabel('Start from'), { hold: 1200, on: 'start from an existing role' });
  await d.choose(dialog.getByLabel('Start from'), 'Team Manager');
  await d.type(dialog.getByLabel('Description'), 'Plans projects and tasks; no money.');
  await d.click(dialog.getByRole('button', { name: 'Create role' }));
  await d.beat(2000);
  await d.finish();
});
