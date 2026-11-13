import { test } from '../kit';

/** Opens each guide in a Help Center section; each answer is shown when the narration asks its question. */
async function openGuides(d: import('../kit').Director, page: import('@playwright/test').Page, section: string, guides: Array<{ name: RegExp; on: string }>) {
  const heading = page.getByRole('heading', { level: 2, name: section });
  await d.scrollTo(heading);
  await d.beat(1200);
  for (const g of guides) {
    const button = page.getByRole('button', { name: g.name }).first();
    await d.scrollTo(button);
    await d.click(button, { settle: false });
    await d.mark('zoom to the answer', button, { on: g.on });
    await d.beat(3200);
  }
}

test('15.1', async ({ d, page }) => {
  await d.go('/help');
  d.begin();
  await openGuides(d, page, 'Frequently asked questions', [
    { name: /sent to a download page/, on: 'Why are members sent' },
    { name: /approved time still be changed/, on: 'Can approved time still be changed' },
    { name: /computer is offline/, on: 'What happens when a computer is offline' },
    { name: /keystrokes recorded/, on: 'are keystrokes recorded' },
  ]);
  await d.finish();
});

test('15.2', async ({ d, page }) => {
  await d.go('/help');
  d.begin();
  await openGuides(d, page, 'Troubleshooting', [
    { name: /forgot to stop their timer/, on: 'A member forgot to stop their timer' },
    { name: /time is missing/, on: 'time is missing' },
    { name: /Approve button is greyed out/, on: 'The Approve button is greyed out' },
    { name: /latest desktop app/, on: 'does not have the latest desktop app' },
  ]);
  await d.finish();
});
