import { expect, test } from '../kit';

test('07.1', async ({ d, page }) => {
  // The tutorial server has no installers to serve: answer the download like a file server would.
  await page.route('**/tutorial-installers/**', (route) => route.fulfill({ body: 'installer', headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="Tallywork-Setup.exe"' } }));
  await d.go('!/download');
  await expect(page.getByRole('heading', { name: 'Get the WorkPulse desktop app' })).toBeVisible();
  d.begin();
  const windows = page.getByRole('link', { name: 'Download for Windows' });
  await d.mark('zoom to the download buttons', windows);
  for (const name of ['Download for Windows', 'Download for macOS', 'Download for Ubuntu / Debian (.deb)']) await d.point(page.getByRole('link', { name }), { hold: 1200 });
  await d.click(windows, { settle: false });
  const dialog = page.getByRole('dialog', { name: /Your download has started/ });
  await expect(dialog).toBeVisible();
  await d.beat(4000);
  await d.click(dialog.getByRole('link', { name: 'Open the step-by-step Windows guide (with pictures)' }));
  const steps = page.getByRole('list', { name: 'Steps to set up WorkPulse on Windows' });
  await expect(steps).toBeVisible();
  await d.mark('zoom to the steps in the guide', steps);
  for (const h of ['If Windows protects your PC, click More info', 'Click Run anyway', 'Sign in']) {
    await d.scrollTo(page.getByRole('heading', { name: new RegExp(h) }).first());
    await d.beat(2200);
  }
  await d.finish();
});
