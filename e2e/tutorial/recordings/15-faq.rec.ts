import { test } from '../kit';

async function openGuides(d: import('../kit').Director, page: import('@playwright/test').Page, section: string, guides: RegExp[]) {
  const heading = page.getByRole('heading', { level: 2, name: section });
  await d.scrollTo(heading);
  await d.beat(1200);
  for (const g of guides) {
    const button = page.getByRole('button', { name: g }).first();
    await d.scrollTo(button);
    await d.click(button, { settle: false });
    await d.mark('zoom to the answer', button);
    await d.beat(3200);
  }
}

test('15.1', async ({ d, page }) => {
  await d.go('/help');
  d.begin();
  await openGuides(d, page, 'Frequently asked questions', [/sent to a download page/, /approved time still be changed/, /computer is offline/, /keystrokes recorded/]);
  await d.finish();
});

test('15.2', async ({ d, page }) => {
  await d.go('/help');
  d.begin();
  await openGuides(d, page, 'Troubleshooting', [/forgot to stop their timer/, /time is missing/, /Approve button is greyed out/, /latest desktop app/]);
  await d.finish();
});
