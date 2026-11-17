import { deflateSync } from 'node:zlib';
import { request, type APIRequestContext, type Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * The company logo on finance documents. Settings → Organization → Company profile has a
 * "Logo on documents": uncropped, any shape, printed on invoices and pay stubs (web and desktop).
 * Without one, documents use the square company logo, or the name only.
 *
 * The e2e organization is shared, so these run in order and remove the logo again at the end.
 */
test.describe.configure({ mode: 'serial' });

// A real PNG of a given size (solid colour), so the PDF check can look for its exact pixel size.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function pngFile(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let c = 0xffffffff;
    for (const x of td) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x1f)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
/** Width × height of a PNG data URL (from its header). */
const pngSize = (dataUrl: string) => {
  const b = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const settings = (page: Page, orgId: string) => page.goto(`/o/${orgId}/settings`);
const preview = (page: Page) => page.getByTestId('document-logo-preview');
const fileInput = (page: Page) => page.locator('#org-document-logo');
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Organization settings saved')).toBeVisible();
}
const as = (state: string): Promise<APIRequestContext> => request.newContext({ baseURL: WEB_URL, storageState: state, extraHTTPHeaders: { Origin: WEB_URL } });

test.describe('document logo (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test.afterAll(async ({ data }) => {
    const admin = await as(ADMIN_STATE);
    await admin.patch(`/api/v1/orgs/${data.orgId}`, { data: { document_logo: null } });
    await admin.dispose();
  });

  test('an admin uploads a wide logo and it prints on the worker’s pay stub', { tag: '@smoke' }, async ({ page, data }) => {
    await settings(page, data.orgId);
    await expect(page.getByText('Logo on documents', { exact: true })).toBeVisible();
    await expect(page.getByText(/No document logo yet|No logo yet/)).toBeVisible();

    await fileInput(page).setInputFiles({ name: 'wordmark.png', mimeType: 'image/png', buffer: pngFile(300, 100) });
    await expect(preview(page).getByRole('img', { name: 'Logo on documents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove document logo' })).toBeVisible();
    await save(page);

    // Kept after a reload, at its own shape (not cropped to a square).
    await page.reload();
    await expect(preview(page).getByRole('img', { name: 'Logo on documents' })).toBeVisible();
    const admin = await as(ADMIN_STATE);
    const org = (await (await admin.get(`/api/v1/orgs/${data.orgId}`)).json()).organization;
    expect(org.has_document_logo).toBe(true);
    expect(pngSize(org.document_logo)).toEqual({ width: 300, height: 100 });
    await admin.dispose();

    // The worker's pay stub PDF now carries the 300 × 100 image.
    const worker = await as(WORKER_STATE);
    const pdf = await worker.get(`/api/v1/orgs/${data.orgId}/pay-stubs/${data.payStub.id}/pdf`);
    expect(pdf.status()).toBe(200);
    const raw = (await pdf.body()).toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toMatch(/\/Subtype\s*\/Image/);
    expect(raw).toMatch(/\/Width 300\b/);
    expect(raw).toMatch(/\/Height 100\b/);
    await worker.dispose();
  });

  test('a large logo is scaled down to fit 600 × 200 without cropping', async ({ page, data }) => {
    await settings(page, data.orgId);
    await fileInput(page).setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: pngFile(2400, 600) });
    await expect(preview(page).getByRole('img', { name: 'Logo on documents' })).toBeVisible();
    await save(page);
    const admin = await as(ADMIN_STATE);
    const org = (await (await admin.get(`/api/v1/orgs/${data.orgId}`)).json()).organization;
    expect(pngSize(org.document_logo)).toEqual({ width: 600, height: 150 });
    await admin.dispose();
  });

  test('a file that is not an image is refused and nothing changes', async ({ page, data }) => {
    await settings(page, data.orgId);
    await fileInput(page).setInputFiles({ name: 'notes.png', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await expect(page.getByRole('alert').filter({ hasText: 'Use a PNG, JPEG, WebP or SVG image' })).toBeVisible();
    // The saved logo is still shown and the form has nothing new to save.
    await expect(preview(page).getByRole('img', { name: 'Logo on documents' })).toBeVisible();
  });

  test('removing it brings back the square logo or the name only', async ({ page, data }) => {
    await settings(page, data.orgId);
    await page.getByRole('button', { name: 'Remove document logo' }).click();
    await expect(page.getByText(/No document logo yet|No logo yet/)).toBeVisible();
    await save(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Upload document logo' })).toBeVisible();
    const admin = await as(ADMIN_STATE);
    expect((await (await admin.get(`/api/v1/orgs/${data.orgId}`)).json()).organization).toMatchObject({ document_logo: null, has_document_logo: false });
    await admin.dispose();
  });
});

test.describe('document logo: who cannot change it', () => {
  test.use({ storageState: MANAGER_STATE });

  test('a team manager has no access to the setting', async ({ page, data }) => {
    await settings(page, data.orgId);
    await expect(page.getByText(/Restricted|don.t have access/).first()).toBeVisible();
    await expect(page.getByText('Logo on documents', { exact: true })).toHaveCount(0);
    const manager = await as(MANAGER_STATE);
    const r = await manager.patch(`/api/v1/orgs/${data.orgId}`, { data: { document_logo: `data:image/png;base64,${pngFile(10, 10).toString('base64')}` } });
    expect(r.status()).toBe(403);
    expect((await (await manager.get(`/api/v1/orgs/${data.orgId}`)).json()).organization.document_logo).toBeNull();
    await manager.dispose();
  });

  test('a worker cannot change it and never receives the image', async ({ data }) => {
    const worker = await as(WORKER_STATE);
    const r = await worker.patch(`/api/v1/orgs/${data.orgId}`, { data: { document_logo: null } });
    expect(r.status()).toBe(403);
    expect((await (await worker.get(`/api/v1/orgs/${data.orgId}`)).json()).organization.document_logo).toBeNull();
    await worker.dispose();
  });
});
