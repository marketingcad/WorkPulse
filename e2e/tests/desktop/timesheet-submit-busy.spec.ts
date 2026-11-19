import { expect, test } from '../../support/fixtures';

/**
 * Timesheet › Submit in the desktop app says it is working while the server answers (QA round 7,
 * OBS-R7-2: in production the button gave no sign of anything for more than 8 seconds). The answer is
 * held back by the test, as a slow connection would; the week is shown as submittable without changing
 * any real timesheet.
 */
test('Submit shows "Submitting…" until the server answers, then the result', async ({ page, openDesktop, newcomerDevice }) => {
  await openDesktop(newcomerDevice);
  await page.evaluate(() => {
    const t = (window as any).tallywork;
    const me = t.me;
    // A week with time that can be submitted.
    t.me = async (resource: string, params: unknown) => {
      const r = await me(resource, params);
      return resource === 'timesheet' ? { ...r, status: 'DRAFT', total_seconds: Math.max(r.total_seconds ?? 0, 3600) } : r;
    };
    // The submission waits until the test lets it through.
    t.submitTimesheet = () => new Promise<void>((resolve) => ((window as any).__releaseSubmit = resolve));
  });

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Timesheet' }).click();
  const submit = page.getByRole('button', { name: /^(Submit|Resubmit)$/ });
  await submit.click();
  const confirm = page.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /^Submit/ }).last().click();

  const busy = page.getByRole('button', { name: 'Submitting…' });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');

  await page.evaluate(() => (window as any).__releaseSubmit());
  await expect(page.getByText(/Timesheet submitted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submitting…' })).toHaveCount(0);
});
