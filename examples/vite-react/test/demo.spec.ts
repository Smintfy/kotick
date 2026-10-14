import { expect, test, type Page } from '@playwright/test';

let pageErrors: Error[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const stats = (page: Page, name: string) => page.locator(`[data-stats="${name}"]`);

test('every section mounts once', async ({ page }) => {
  await page.goto('/');

  for (const name of ['checkout', 'cart', 'cart-badge', 'cart-catalog', 'cart-lines', 'uploads', 'session']) {
    await expect(stats(page, name)).toHaveAttribute('data-mounts', '1');
    await expect(stats(page, name)).toHaveAttribute('data-renders', '1');
  }
});

test.describe('checkout', () => {
  test('pays with express shipping', async ({ page }) => {
    await page.goto('/');
    const total = page.getByTestId('checkout-total');
    await expect(total).toHaveText('$48.00');

    await page.getByRole('radio', { name: /express/i }).check();
    await expect(total).toHaveText('$63.00');

    const pay = page.getByRole('button', { name: /^Pay/ });
    await expect(pay).toBeDisabled();
    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await pay.click();

    await expect(page.getByText('Processing payment…')).toBeVisible();
    await expect(page.getByText(/^Paid\. Receipt rcpt_/)).toBeVisible();
    // The shipping guard closes once payment has gone through.
    await expect(page.getByRole('radio', { name: /standard/i })).toBeDisabled();
    await expect(stats(page, 'checkout')).toHaveAttribute('data-mounts', '1');
  });

  test('a declined card can be retried, then edited', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Card number').fill('4000 0000 0000 0002');
    await page.getByRole('button', { name: /^Pay/ }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Card declined');

    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Processing payment…')).toBeVisible();
    await expect(alert).toContainText('Card declined');

    // The history state returns to editing.complete, so the card is kept and Pay stays enabled.
    await alert.getByRole('button', { name: 'Edit card' }).click();
    await expect(page.getByLabel('Card number')).toHaveValue('4000 0000 0000 0002');
    await expect(page.getByRole('button', { name: /^Pay/ })).toBeEnabled();
  });
});

test.describe('uploads', () => {
  test('a failed upload succeeds on retry', async ({ page }) => {
    await page.goto('/');
    const row = page.getByRole('listitem').filter({ hasText: 'walkthrough.mov' });

    await row.getByRole('button', { name: 'Start' }).click();
    await expect(row.getByRole('alert')).toHaveText('Connection lost');

    await row.getByRole('button', { name: 'Retry' }).click();
    await expect(row.getByText('Uploaded')).toBeVisible();
    await expect(row.getByRole('progressbar')).toHaveAttribute('value', '100');
  });

  test('rows can be added and removed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add file' }).click();
    const row = page.getByRole('listitem').filter({ hasText: 'photo-4.jpg' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toHaveCount(0);
    await expect(stats(page, 'upload-1')).toHaveAttribute('data-mounts', '1');
  });
});

test('cart: selectors update without re-rendering the catalog', async ({ page }) => {
  await page.goto('/');
  const count = page.getByTestId('cart-count');

  await page.getByRole('button', { name: 'Add Linen tote' }).click();
  await page.getByRole('button', { name: 'Add Linen tote' }).click();
  await page.getByRole('button', { name: 'Add Ceramic mug' }).click();
  await expect(count).toHaveText('3');

  await page.getByRole('button', { name: 'Remove Linen tote' }).click();
  await expect(count).toHaveText('1');

  await page.getByRole('button', { name: 'Clear cart' }).click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  await expect(stats(page, 'cart-catalog')).toHaveAttribute('data-renders', '1');
});

test.describe('session', () => {
  test('signs out and back in', async ({ page }) => {
    await page.goto('/');
    const session = page.getByLabel('Session');

    await session.getByRole('button', { name: 'Sign out' }).click();
    await session.getByRole('button', { name: 'Sign in' }).click();
    await expect(session.getByText('Signing in…')).toBeVisible();
    await expect(session).toContainText('Signed in as Ada Lovelace');
  });

  test('expires after the TTL', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    const session = page.getByLabel('Session');
    await expect(session).toContainText('Signed in as Ada Lovelace');

    await page.clock.fastForward('05:00');
    await expect(session.getByRole('alert')).toHaveText('Session expired');
  });
});
