import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * The video tutorial in the Help Center: system admins (who may change the organization) watch it
 * chapter by chapter; nobody else sees it. The E2E server has no storage, so nothing is published
 * there: tests that need a published tutorial answer its requests in the browser, while the
 * permission checks use the real API.
 */
const MANIFEST = {
  title: 'WorkPulse Complete Tutorial',
  chapters: [
    { n: 1, title: 'Welcome to WorkPulse', seconds: 100, video: 'ch01-aaaa1111.mp4', captions: 'ch01-aaaa1111.vtt', poster: null },
    { n: 2, title: 'Getting started', seconds: 145, video: 'ch02-bbbb2222.mp4', captions: 'ch02-bbbb2222.vtt', poster: null },
    { n: 3, title: 'Wrap-up', seconds: 58, video: 'ch03-cccc3333.mp4', captions: null, poster: null },
  ],
};

/** Publishes the tutorial for this page only: the manifest and (empty) chapter files. */
async function published(page: Page, manifest: unknown = MANIFEST) {
  await page.route(/\/api\/v1\/orgs\/[^/]+\/help\/tutorial$/, (r) => r.fulfill({ json: manifest }));
  await page.route(/\/help\/tutorial\/files\//, (r) => r.fulfill({ status: 200, contentType: r.request().url().endsWith('.vtt') ? 'text/vtt' : 'video/mp4', body: r.request().url().endsWith('.vtt') ? 'WEBVTT\n' : '' }));
}

const section = (page: Page) => page.getByRole('region', { name: 'Video tutorial' });
const player = (page: Page) => section(page).locator('video');
const chapter = (page: Page, name: string) => section(page).getByRole('list', { name: 'Chapters' }).getByRole('button', { name: new RegExp(name) });

test.describe('Help Center video tutorial (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin watches the tutorial chapter by chapter', { tag: '@smoke' }, async ({ page, data }) => {
    await published(page);
    await page.goto(`/o/${data.orgId}/help`);

    // At the top of the topics, in the topic menu, and one click from the page header.
    await expect(page.getByRole('heading', { level: 2, name: 'Video tutorial' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Help topics' }).getByRole('link', { name: 'Video tutorial' })).toHaveAttribute('href', '#topic-video');
    await expect(section(page)).toContainText('A 5 min walkthrough of WorkPulse');
    const topics = page.getByRole('heading', { level: 2 });
    await expect(topics.first()).toHaveText('Video tutorial');

    // The first chapter is ready, with captions, and no video plays until the admin asks.
    await expect(player(page)).toHaveAttribute('src', new RegExp(`/api/v1/orgs/${data.orgId}/help/tutorial/files/ch01-aaaa1111\\.mp4$`));
    await expect(player(page)).toHaveAttribute('aria-label', 'Video tutorial, chapter 1: Welcome to WorkPulse');
    await expect(player(page).locator('track')).toHaveAttribute('src', /ch01-aaaa1111\.vtt$/);
    expect(await player(page).evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false);
    await expect(chapter(page, 'Welcome to WorkPulse')).toHaveAttribute('aria-current', 'true');
    await expect(section(page).getByText('Chapter 1 of 3')).toBeVisible();
    await test.info().attach('help-video', { body: await section(page).screenshot(), contentType: 'image/png' });

    // Choosing a chapter plays it.
    await chapter(page, 'Getting started').click();
    await expect(player(page)).toHaveAttribute('src', /ch02-bbbb2222\.mp4$/);
    expect(await player(page).evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(true);
    await expect(chapter(page, 'Getting started')).toHaveAttribute('aria-current', 'true');
    await expect(chapter(page, 'Welcome to WorkPulse')).not.toHaveAttribute('aria-current', 'true');
    await expect(section(page).getByText('Chapter 2 of 3')).toBeVisible();

    // The next chapter follows when one ends; the last one has no "Next chapter".
    await player(page).evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event('ended')));
    await expect(player(page)).toHaveAttribute('src', /ch03-cccc3333\.mp4$/);
    await expect(player(page).locator('track')).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: 'Next chapter' })).toHaveCount(0);
    await player(page).evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event('ended')));
    await expect(section(page).getByText('Chapter 3 of 3')).toBeVisible();

    // "Next chapter" moves on by hand.
    await chapter(page, 'Welcome to WorkPulse').click();
    await section(page).getByRole('button', { name: 'Next chapter' }).click();
    await expect(section(page).getByText('Chapter 2 of 3')).toBeVisible();
  });

  test('"Watch the video" clears a search and brings the video into view', async ({ page, data }) => {
    await published(page);
    await page.goto(`/o/${data.orgId}/help`);
    await page.getByLabel('Search help').fill('invoice');
    await expect(section(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Watch the video' }).click();
    await expect(page.getByLabel('Search help')).toHaveValue('');
    await expect(section(page)).toBeInViewport();
  });

  test('when no tutorial is published, Help shows no video section', async ({ page, data }) => {
    const answered = page.waitForResponse((r) => /\/help\/tutorial$/.test(r.url()));
    await page.goto(`/o/${data.orgId}/help`);
    const res = await answered;
    expect(res.status()).toBe(200);
    expect(await res.json()).toBeNull();
    await expect(page.getByRole('heading', { level: 2, name: 'Getting started' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Video tutorial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Watch the video' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Video tutorial' })).toHaveCount(0);
  });

  test('a failed load says so and can be retried', async ({ page, data }) => {
    let fail = true;
    await page.route(/\/api\/v1\/orgs\/[^/]+\/help\/tutorial$/, (r) => (fail ? r.fulfill({ status: 500, json: { title: 'Internal error' } }) : r.fulfill({ json: MANIFEST })));
    await page.goto(`/o/${data.orgId}/help`);
    await expect(section(page).getByRole('alert')).toContainText('The video tutorial could not be loaded');
    fail = false;
    await section(page).getByRole('button', { name: 'Try again' }).click();
    await expect(chapter(page, 'Welcome to WorkPulse')).toBeVisible();
    await expect(section(page).getByRole('alert')).toHaveCount(0);
  });
});

test.describe('Help Center video tutorial is for system admins only', () => {
  test('someone with a custom role that cannot change the organization never sees it, and the API refuses them', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    // Even with a tutorial published, the page does not offer it.
    await published(page);
    await page.goto(`/o/${data.orgId}/help`);
    await expect(page.getByRole('heading', { level: 1, name: 'Help Center' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Video tutorial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Watch the video' })).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE });
    expect((await api.get(`/api/v1/orgs/${data.orgId}/help/tutorial`)).status()).toBe(403);
    expect((await api.get(`/api/v1/orgs/${data.orgId}/help/tutorial/files/ch01-aaaa1111.mp4`)).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });

  test('a team manager never sees it, and the API refuses them', async ({ browser, data, adminApi }) => {
    const email = `max+${data.run}-${uid()}@e2e.test`;
    const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email, name: 'Max Manager', role_id: roles.find((r) => r.key === 'TEAM_MANAGER')!.id } }), 'invite');
    const max = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL }, storageState: { cookies: [], origins: [] } });
    await ok(await max.post('/api/v1/auth/invitations/accept', { data: { token: new URL(invite.invite_url).searchParams.get('token'), name: 'Max Manager', password: PASSWORD } }), 'accept');
    await ok(await max.patch('/api/v1/me', { data: { tour: 'done' } }), 'tour seen');
    expect((await max.get(`/api/v1/orgs/${data.orgId}/help/tutorial`)).status()).toBe(403);
    expect((await max.get(`/api/v1/orgs/${data.orgId}/help/tutorial/files/ch01-aaaa1111.mp4`)).status()).toBe(403);

    const ctx = await browser.newContext({ storageState: await max.storageState() });
    const page = await ctx.newPage();
    await published(page);
    await page.goto(`/o/${data.orgId}/help`);
    await expect(page.getByRole('heading', { level: 1, name: 'Help Center' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Getting started' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Video tutorial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Watch the video' })).toHaveCount(0);
    await Promise.all([max.dispose(), ctx.close()]);
  });
});
