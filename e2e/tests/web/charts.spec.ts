import AxeBuilder from '@axe-core/playwright';
import { request, type Page } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Charts (analytics redesign): the Summary and Overview charts draw the server's numbers, compare
 * with the previous period fairly, read out with the keyboard, keep missing days apart from zero,
 * and stay accessible in light and dark themes and at phone width. A role that sees only its own
 * time sees only its own numbers.
 */
test.use({ storageState: ADMIN_STATE });

const pad = (n: number) => String(n).padStart(2, '0');
const utcDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const now = new Date();
const firstThisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
const firstLastMonth = utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
// The first of the month is the seeded day for "this month", so it must already be over.
test.skip(now.getUTCDate() === 1, 'needs a finished day in the current month');

const serious = async (page: Page, include: string) =>
  (await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);

test.beforeAll(async ({ data }) => {
  // An hour this month and two hours last month for the admin, at times no other spec uses.
  const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  const add = async (day: string, h: number, hours: number) =>
    api.post(`/api/v1/orgs/${data.orgId}/manual-time`, { data: { project_id: data.projects.website.id, started_at: `${day}T${pad(h)}:07:00.000Z`, ended_at: `${day}T${pad(h + hours)}:07:00.000Z`, reason: 'E2E charts' } });
  for (const [day, h, hours] of [[firstThisMonth, 2, 1], [firstLastMonth, 2, 2]] as const) {
    const r = await add(day, h, hours);
    // A retry finds them already there (overlap): that is fine.
    if (!r.ok() && r.status() !== 422) await ok(r, `seed ${day}`);
  }
  await api.dispose();
});

test('Summary: hours per day read out with the keyboard, the legend toggles, and the period is compared', { tag: '@smoke' }, async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/insights`);
  const chart = page.getByRole('group', { name: /Hours logged per day/ });
  await expect(chart).toBeVisible();
  // Keyboard: the last day first, then one day back; the reading names the day and its values.
  await chart.focus();
  await page.keyboard.press('Home');
  const live = page.locator('p[aria-live="polite"]').filter({ hasText: /total|no data/ }).first();
  await expect(live).toContainText(/total/);
  await page.keyboard.press('End');
  // Days still to come this month are "no data", never zero.
  if (now.getUTCDate() < 28) await expect(live).toContainText('no data');

  // The legend shows or hides a series (a toggle button).
  const nonBillable = page.getByRole('button', { name: 'Non-billable', exact: true });
  await expect(nonBillable).toHaveAttribute('aria-pressed', 'true');
  await nonBillable.click();
  await expect(nonBillable).toHaveAttribute('aria-pressed', 'false');
  await nonBillable.click();

  // Compared with last month (the same days so far), from the server's own numbers.
  await expect(page.getByText(/Compared with/)).toBeVisible();
  await expect(page.getByText(/vs the same days of the previous period|vs previous period/).first()).toBeVisible();
  // The billable share: both parts with their time.
  const donut = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Billable share' }) });
  await expect(donut.getByRole('button', { name: /^Billable/ })).toBeVisible();
  // A part with no time stays listed (with 0), so the breakdown is complete.
  await expect(donut.getByRole('button', { name: /^Non-billable/ })).toBeVisible();
  // Regression: the axis labels ("40h 00m") wrapped onto two lines and the top one ran into the
  // chart's title. They are short ("40h"), on one line, and inside the chart's own box.
  const axis = await page.locator('[data-chart-axis]').first().evaluate((el) => {
    const fig = el.closest('figure')!.getBoundingClientRect();
    const labels = Array.from(el.querySelectorAll('span')).map((s) => ({ text: s.textContent ?? '', rect: s.getBoundingClientRect() }));
    const box = el.getBoundingClientRect();
    const top = Math.max(...labels.map((l) => parseInt(l.text, 10)));
    // How far each label's middle is from its gridline (value / top of the axis, up from the bottom).
    const offLine = labels.map((l) => Math.abs((l.rect.top + l.rect.bottom) / 2 - (box.bottom - (parseInt(l.text, 10) / top) * box.height)));
    return { texts: labels.map((l) => l.text), tallest: Math.max(...labels.map((l) => l.rect.height)), fontSize: parseFloat(getComputedStyle(el).fontSize), offLine: Math.max(...offLine), above: fig.top - Math.min(...labels.map((l) => l.rect.top)) };
  });
  expect(axis.texts.every((s) => /^\d+h$/.test(s)), axis.texts.join(', ')).toBe(true);
  expect(axis.tallest, 'each axis label is on one line').toBeLessThan(axis.fontSize * 1.5);
  expect(axis.offLine, 'each axis label sits on its gridline').toBeLessThanOrEqual(2);
  expect(axis.above, 'the top label stays inside the chart').toBeLessThanOrEqual(0);
  // A screen-reader table carries every value.
  await expect(page.locator('table.sr-only caption', { hasText: 'Hours logged per day' })).toHaveCount(1);
  expect(await serious(page, 'main')).toEqual([]);
});

test('Summary: a period with no time says so instead of drawing empty charts', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/insights`);
  await expect(page.getByRole('group', { name: /Hours logged per day/ })).toBeVisible();
  // Two years back: nothing was tracked then.
  for (let i = 0; i < 24; i++) await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByText('No time in this period').first()).toBeVisible();
  await expect(page.getByRole('group', { name: /Hours logged per day/ })).toHaveCount(0);
});

test('Overview: this week’s chart, the change against last week, and the activity ring', async ({ browser, data }) => {
  // A personal layout with these widgets, for an account no other Overview check uses; reset after.
  const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  await ok(await api.put(`/api/v1/orgs/${data.orgId}/dashboard/layout`, { data: { scope: 'ME', widgets: [{ key: 'tracked_week', size: 'M' }, { key: 'activity', size: 'S' }] } }), 'layout');
  const ctx = await browser.newContext({ storageState: VIEWER_STATE });
  const page = await ctx.newPage();
  try {
  await page.goto(`/o/${data.orgId}`);
  const week = page.getByRole('group', { name: /Hours per day this week/ });
  await expect(week).toBeVisible();
  await week.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /total|no data/ }).first()).not.toBeEmpty();
  await expect(page.getByRole('img', { name: /Average activity this week/ })).toBeVisible();
  } finally {
    await ctx.close();
    await api.delete(`/api/v1/orgs/${data.orgId}/dashboard/layout?scope=ME`);
    await api.dispose();
  }
});

test('charts are readable in the dark theme and on a phone', async ({ page, data }) => {
  await page.addInitScript(() => localStorage.setItem('tw.theme', 'dark'));
  await page.goto(`/o/${data.orgId}/insights`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('group', { name: /Hours logged per day/ })).toBeVisible();
  expect(await serious(page, 'main')).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('group', { name: /Hours logged per day/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('someone who sees only their own time sees only their own numbers', async ({ browser, data }) => {
  const ctx = await browser.newContext({ storageState: VIEWER_STATE });
  const page = await ctx.newPage();
  await page.goto(`/o/${data.orgId}/insights`);
  await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible();
  // The admin's hours this month are not theirs: no chart of them, the empty state instead.
  await expect(page.getByText('No time in this period').first()).toBeVisible();
  await ctx.close();
});
