import { expect, label, test } from '../kit';

const settingsTab = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name, exact: true });

test('13.1', async ({ d, page }) => {
  await d.go('/settings');
  d.begin();
  await d.click(settingsTab(page, 'Devices'));
  await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
  await d.point(page.getByRole('table', { name: 'Registered devices' }), { hold: 3000 });
  await d.click(page.getByRole('button', { name: /^Actions for / }).first(), { settle: false });
  const menu = page.getByRole('menu');
  await d.mark('zoom to the device actions', menu);
  for (const item of ['Approve device', 'Require sign-in again', 'Revoke device']) {
    const el = menu.getByRole('menuitem', { name: item });
    if (await el.isVisible()) await d.point(el, { hold: 1300 });
  }
  await page.keyboard.press('Escape');
  await d.finish();
});

test('13.2', async ({ d, page }) => {
  await d.go('/devices');
  d.begin();
  await d.click(settingsTab(page, 'Security & retention'));
  const twofa = page.getByLabel(label('Require two-factor authentication'));
  await d.mark('zoom to Sign-in & access', twofa);
  for (const l of ['Require two-factor authentication', 'Session lifetime (hours)', 'Require device approval', 'Allowed networks (IP allowlist)']) await d.point(page.getByText(l, { exact: true }).first(), { hold: 1600 });
  await d.click(settingsTab(page, 'Access review'));
  await d.mark('zoom to the Access review counts', page.getByText('Active members', { exact: true }).first());
  for (const k of ['Active members', 'Without two-factor', 'Roles', 'Active API keys']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1300 });
  await d.finish();
});

test('13.3', async ({ d, page }) => {
  await d.go('/settings/security');
  d.begin();
  await d.click(settingsTab(page, 'Screenshot retention'));
  await d.point(page.getByLabel(label('Keep screenshots for')), { hold: 2000 });
  await d.point(page.getByLabel(label('How often')), { hold: 1800 });
  await d.click(page.getByRole('button', { name: 'Preview cleanup' }), { settle: false });
  const result = page.getByRole('region', { name: 'Preview result' });
  await expect(result).toBeVisible();
  await d.mark('zoom to the preview result', result);
  await d.point(result, { hold: 3500 });
  const history = page.getByRole('table', { name: 'Cleanup history' }).or(page.getByText('Cleanup history')).first();
  await d.scrollTo(history);
  await d.beat(2000);
  await d.finish();
});

test('13.4', async ({ d, page }) => {
  await d.go('/settings/screenshot-retention');
  d.begin();
  await d.click(settingsTab(page, 'API keys'));
  await d.click(page.getByRole('button', { name: 'Create API key' }).first(), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Create API key' });
  await d.mark('zoom to the Create API key dialog', dialog);
  await d.type(dialog.getByLabel(label('Name')), 'Accounting sync');
  await d.click(dialog.getByRole('checkbox').first(), { settle: false });
  await d.choose(dialog.getByLabel(label('Expires')), 'In 90 days');
  await d.click(dialog.getByRole('button', { name: 'Create key' }), { settle: false });
  const created = page.getByRole('dialog', { name: 'API key created' });
  await expect(created).toBeVisible();
  await d.beat(3000);
  await d.click(created.getByRole('button', { name: 'I have stored the key' }));
  await d.click(settingsTab(page, 'Webhooks'));
  await d.click(page.getByRole('button', { name: 'Add endpoint' }).first(), { settle: false });
  const hook = page.getByRole('dialog', { name: 'Add endpoint' });
  await d.mark('zoom to the Add endpoint dialog', hook);
  // The server checks that the host resolves; example.com is reserved for documentation.
  await d.type(hook.getByLabel(label('Endpoint URL')), 'https://example.com/workpulse-webhook');
  await d.type(hook.getByLabel(label('Description')), 'Accounting system');
  const all = hook.getByLabel(/All events/);
  if (!(await all.isChecked())) await d.click(all, { settle: false });
  else await d.point(all, { hold: 1500 });
  // Switched off, so a recording never sends anything to the outside world.
  const enabled = hook.getByRole('switch', { name: /Enabled/ });
  await d.scrollTo(enabled);
  if ((await enabled.getAttribute('aria-checked')) === 'true') await d.click(enabled, { settle: false });
  await d.click(hook.getByRole('button', { name: 'Add endpoint' }), { settle: false });
  const secret = page.getByRole('dialog', { name: 'Endpoint created' });
  await expect(secret).toBeVisible();
  await d.beat(2500);
  await d.click(secret.getByRole('button', { name: 'I have stored the secret' }));
  await d.finish();
});

test('13.5', async ({ d, page }) => {
  await d.go('/developer/webhooks');
  d.begin();
  await d.click(settingsTab(page, 'Audit log'));
  await d.type(page.getByLabel('Action starts with'), 'client');
  await d.settle();
  await d.beat(1500);
  await d.click(page.getByRole('table', { name: 'Audit log' }).getByRole('row').nth(1), { settle: false });
  const drawer = page.getByRole('dialog').first();
  await d.mark('zoom to the entry details', drawer);
  await d.beat(4000);
  await page.keyboard.press('Escape');
  await d.point(page.getByRole('button', { name: 'Export CSV' }), { hold: 2000 });
  await d.finish();
});
