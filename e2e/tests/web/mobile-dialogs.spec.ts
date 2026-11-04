import AxeBuilder from '@axe-core/playwright';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * The main create and edit dialogs at phone width (UX remediation, phase 4): the dialog fits the
 * screen, its form never scrolls sideways, every footer button can be reached and pressed, the
 * first field has focus, Escape closes it and focus returns to the button that opened it, and axe
 * finds nothing serious inside it.
 */
test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

const DIALOGS: Array<{ path: string; open: string | RegExp; dialog: string | RegExp; tab?: string }> = [
  { path: '/clients', open: 'New client', dialog: 'New client' },
  { path: '/projects', open: 'New project', dialog: 'New project' },
  { path: '/tasks', open: 'New task', dialog: 'New task' },
  { path: '/teams', open: 'New team', dialog: 'New team' },
  { path: '/workers', open: 'Invite member', dialog: 'Invite member' },
  { path: '/timesheets', open: 'Add time', dialog: /^Add time/ },
  // The admin gets a policy of their own in beforeAll (with none, the button is rightly disabled).
  { path: '/time-off?tab=mine', open: 'Request time off', dialog: 'Request time off' },
  { path: '/time-off?tab=admin', open: /New policy|New time off policy/, dialog: 'New time off policy' },
  { path: '/finance/expenses', open: 'New expense', dialog: 'New expense' },
  { path: '/finance/invoices/payments', open: 'Record payment', dialog: 'Record payment' },
  { path: '/finance/budgets', open: 'Set budget', dialog: 'Set budget' },
  { path: '/finance/payroll', open: 'Run payroll', dialog: 'Run payroll' },
  { path: '/finance/payroll', tab: 'Pay groups', open: /New pay group|Create pay group/, dialog: 'New pay group' },
  { path: '/settings/roles', open: /Create (custom )?role/, dialog: 'Create custom role' },
  { path: '/developer/api-keys', open: /Create (API )?key/, dialog: 'Create API key' },
  { path: '/developer/webhooks', open: /Add endpoint/, dialog: 'Add endpoint' },
];

test.beforeAll(async ({ data, adminApi }) => {
  await ok(await adminApi.api.post(adminApi.orgApi('/time-off/policies'), { data: { name: `Phone dialog leave ${uid()}`, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.admin.membershipId] } }), 'policy');
});

for (const d of DIALOGS) {
  test(`${typeof d.dialog === 'string' ? d.dialog : d.dialog.source} fits a phone`, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}${d.path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (d.tab) await page.getByRole('tab', { name: d.tab, exact: true }).or(page.getByRole('radio', { name: d.tab, exact: true })).or(page.getByRole('button', { name: d.tab, exact: true })).first().click();
    await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: d.open, exact: typeof d.open === 'string' }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: d.dialog, exact: typeof d.dialog === 'string' });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    const m =await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const sideways = Array.from(el.querySelectorAll('*')).filter((x) => {
        const s = getComputedStyle(x);
        return (s.overflowX === 'auto' || s.overflowX === 'scroll') && x.scrollWidth - x.clientWidth > 1 && !x.closest('table');
      }).length;
      return { left: r.left, right: r.right, vw: window.innerWidth, sideways };
    });
    expect(m.left, 'the dialog starts on screen').toBeGreaterThanOrEqual(0);
    expect(m.right, 'the dialog ends on screen').toBeLessThanOrEqual(m.vw);
    expect(m.sideways, 'nothing in the dialog scrolls sideways').toBe(0);

    // Every footer button is on screen and can be pressed (not covered or cut off).
    const buttons = dialog.locator('> div').last().getByRole('button');
    for (const b of await buttons.all()) {
      const box = (await b.boundingBox())!;
      expect(box.x, 'a footer button is cut off on the left').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'a footer button is cut off on the right').toBeLessThanOrEqual(m.vw);
      // A submit button waits for the form to be filled; the others must be pressable now.
      if (await b.isEnabled()) await b.click({ trial: true });
    }

    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);

    // Focus is inside the dialog, Escape closes it, and focus goes back to what opened it.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
