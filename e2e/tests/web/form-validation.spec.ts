import { expect, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Form validation audit (20 Nov 2026): phone numbers with a country picker, stored in E.164; names,
 * birth dates and new passwords checked in the browser with the server's rules, so a mistake is shown
 * beside its field and nothing is sent; and the server refusing the same values when called directly.
 */

test.describe('Phone numbers and personal info', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin picks a country, types a local number, and it is saved in international format', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/workers/${data.newcomer.membershipId}`);
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Personal info', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    // The country list is searchable.
    await page.getByRole('button', { name: /^Country code:/ }).first().click();
    await page.getByRole('textbox', { name: 'Search countries' }).fill('phil');
    await page.getByRole('option', { name: /Philippines/ }).getByRole('button').click();
    await expect(page.getByRole('button', { name: 'Country code: Philippines +63' })).toBeVisible();

    const phone = page.locator('#pd-phone');
    await phone.fill('9171234567');
    await phone.blur();
    await expect(phone).toHaveValue('0917 123 4567'); // formatted the way the Philippines writes it
    await page.getByRole('button', { name: 'Save personal info' }).click();
    await expect(page.getByText('Personal info saved')).toBeVisible();
    await expect(page.getByText('+63 917 123 4567')).toBeVisible();

    // Stored in E.164.
    const details = await page.request.get(`/api/v1/orgs/${data.orgId}/workers/${data.newcomer.membershipId}/details`);
    expect((await details.json()).phone).toBe('+639171234567');
  });

  test('an invalid phone, a future birth date and a name of digits are shown beside their fields, and nothing is sent', async ({ page, data }) => {
    const sent: string[] = [];
    page.on('request', (r) => void (r.method() === 'PATCH' && r.url().includes('/details') && sent.push(r.url())));
    await page.goto(`/o/${data.orgId}/workers/${data.newcomer.membershipId}`);
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Personal info', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    await page.getByLabel('First name').fill('12345');
    await page.locator('#pd-birth_date').fill('2099-01-01');
    await page.locator('#pd-emergency_contact_phone').fill('12345');
    await page.getByRole('button', { name: 'Save personal info' }).click();

    await expect(page.getByLabel('First name')).toHaveAccessibleDescription('A name needs at least one letter');
    await expect(page.locator('#pd-birth_date')).toHaveAccessibleDescription('Choose a date in the past');
    await expect(page.locator('#pd-emergency_contact_phone')).toHaveAccessibleDescription('Enter a valid phone number');
    await expect(page.locator('#pd-emergency_contact_phone')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);

    // Letters are named as such.
    await page.locator('#pd-emergency_contact_phone').fill('call me');
    await page.getByRole('button', { name: 'Save personal info' }).click();
    await expect(page.locator('#pd-emergency_contact_phone')).toHaveAccessibleDescription('Use digits only (spaces, dashes and brackets are fine)');
    expect(sent).toEqual([]);
  });

  test('a client phone that is too short is refused in the dialog', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await dialog.getByLabel('Company / client name').fill(`Phoneless ${data.run} ${uid()}`);
    await dialog.getByLabel('Phone number').fill('555 01');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(dialog.getByLabel('Phone number')).toHaveAccessibleDescription('Enter a valid phone number');
    await expect(dialog).toBeVisible();
  });

  test('the API refuses invalid phones, names and emails on its own', async ({ adminApi, data }) => {
    const path = adminApi.orgApi(`/workers/${data.newcomer.membershipId}/details`);
    const field = async (body: object) => {
      const r = await adminApi.api.patch(path, { data: body });
      expect(r.status()).toBe(400);
      return ((await r.json()) as { errors: Array<{ field: string; message: string }> }).errors[0];
    };
    expect(await field({ phone: '9171234567' })).toEqual({ field: 'phone', message: 'Include the country code, like +1 or +63' });
    expect(await field({ phone: '+63 917' })).toEqual({ field: 'phone', message: 'Enter a valid phone number' });
    expect(await field({ last_name: '<script>' })).toMatchObject({ field: 'last_name' });
    expect(await field({ personal_email: 'user@gmail' })).toMatchObject({ field: 'personal_email' });
    // A valid number with spaces is stored in E.164.
    const ok = await adminApi.api.patch(path, { data: { emergency_contact_phone: '+44 20 7946 0958' } });
    expect((await ok.json()).emergency_contact_phone).toBe('+442079460958');
  });
});

test.describe('Personal info (no access)', () => {
  test.use({ storageState: WORKER_STATE });

  test("a worker cannot change another member's phone number", async ({ page, data }) => {
    const r = await page.request.patch(`/api/v1/orgs/${data.orgId}/workers/${data.newcomer.membershipId}/details`, { data: { phone: '+14155550123' }, headers: { Origin: WEB_URL } });
    expect([403, 404]).toContain(r.status());
  });
});

test.describe('New passwords are typed twice', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sign-up refuses a name of digits and a confirmation that does not match, without sending', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (r) => void (r.url().includes('/api/v1/auth/signup') && sent.push(r.method())));
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('12345');
    await page.getByLabel('Work email').fill(`qa-confirm-${uid()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('long-enough-password');
    await page.getByLabel('Confirm password').fill('long-enough-passwort');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByLabel('Your name')).toHaveAccessibleDescription('A name needs at least one letter');
    await expect(page.getByLabel('Confirm password')).toHaveAccessibleDescription('The passwords do not match');
    expect(sent).toEqual([]);
  });

  test('a password reset needs the new password twice', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (r) => void (r.url().includes('/api/v1/auth/password/reset') && sent.push(r.method())));
    await page.goto(`/reset-password?token=${'x'.repeat(43)}`);
    await page.getByLabel('New password').fill('long-enough-password');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByLabel('Confirm password')).toHaveAccessibleDescription('Type the password again');
    expect(sent).toEqual([]);
    // With both typed, the link itself is checked, and that is said above the button, not under the password.
    await page.getByLabel('Confirm password').fill('long-enough-password');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired' })).toBeVisible();
    await expect(page.getByLabel('New password')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
