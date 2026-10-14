// The overlay in the running demo (spec §12, §13): every state listed and previewable, blocked events, release, deep
// links, keyboard, persisted UI and style isolation. Playwright's CSS and role locators pierce the open shadow root.

import { expect, test, type Page } from '@playwright/test';

let pageErrors: Error[];
let consoleErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

/** Every non-history state of every demo machine, by machine id. */
const STATES: Record<string, string[]> = {
  session: ['signedOut', 'signingIn', 'signedIn', 'expired'],
  checkout: [
    'shipping.standard',
    'shipping.express',
    'shipping.pickup',
    'payment.editing.incomplete',
    'payment.editing.complete',
    'payment.processing',
    'payment.error',
    'payment.success',
  ],
  cart: ['empty', 'filled'],
  upload: ['queued', 'uploading', 'failed', 'done'],
};

const MOUNT_COUNTERS = ['checkout', 'cart', 'cart-badge', 'cart-catalog', 'cart-lines', 'uploads', 'session'];

const bubble = (page: Page) => page.getByRole('button', { name: /^State viewer/ });
const panel = (page: Page) => page.getByRole('region', { name: 'State viewer' });
const leaf = (page: Page, id: string) => panel(page).locator(`[data-leaf="${id}"]`);
const machineSelect = (page: Page) => panel(page).getByRole('combobox', { name: 'Machine' });
const stats = (page: Page, name: string) => page.locator(`[data-stats="${name}"]`);

async function openPanel(page: Page): Promise<void> {
  await bubble(page).click();
  await expect(panel(page)).toBeVisible();
}

async function chooseMachine(page: Page, machineId: string): Promise<void> {
  await machineSelect(page).selectOption(machineId);
  await expect(machineSelect(page)).toHaveValue(machineId);
}

async function leafIds(page: Page): Promise<string[]> {
  return panel(page)
    .locator('[data-leaf]')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.leaf!));
}

async function expectMountedOnce(page: Page): Promise<void> {
  for (const name of MOUNT_COUNTERS) await expect(stats(page, name)).toHaveAttribute('data-mounts', '1');
}

test('lists every non-history state of every demo machine, including never-visited ones', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);

  const machines = await machineSelect(page).locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(machines.toSorted()).toEqual(Object.keys(STATES).toSorted());
  for (const machineId of machines) {
    await chooseMachine(page, machineId);
    expect(await leafIds(page)).toEqual(STATES[machineId]);
  }
  await chooseMachine(page, 'checkout');
  await expect(panel(page).getByRole('combobox', { name: 'Instance' }).locator('option')).toHaveCount(1);
  await chooseMachine(page, 'upload');
  await expect(panel(page).getByRole('combobox', { name: 'Instance' }).locator('option')).toHaveText([
    'upload · 1',
    'upload · 2',
    'upload · 3',
  ]);
});

test('previews every state of every machine without errors or remounts', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);

  for (const [machineId, leaves] of Object.entries(STATES)) {
    await chooseMachine(page, machineId);
    for (const id of leaves) {
      // Selecting the previewed leaf again would release it.
      if ((await leaf(page, id).getAttribute('aria-selected')) === 'true') continue;
      await leaf(page, id).click();
      await expect(leaf(page, id)).toHaveAttribute('aria-selected', 'true');
    }
  }
  await expect(bubble(page)).toHaveAccessibleName(/previews? active/);
  await expectMountedOnce(page);

  await panel(page).getByRole('button', { name: 'Release all' }).click();
  await expect(bubble(page)).toHaveAccessibleName('State viewer');
  await expect(page.getByTestId('checkout-total')).toHaveText('$48.00');
  await expectMountedOnce(page);
});

test('components reading through useSelector and createActorContext show the preview', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);

  // createActorContext, read with useSelector, with fixture context.
  await chooseMachine(page, 'cart');
  await leaf(page, 'filled').click();
  await expect(page.getByTestId('cart-count')).toHaveText('3');
  await expect(page.getByRole('button', { name: 'Remove Ceramic mug' })).toBeVisible();
  await expect(panel(page).getByRole('radio', { name: 'Fixture' })).toBeChecked();

  // connect(), read with useSelector.
  await chooseMachine(page, 'session');
  await leaf(page, 'signedOut').click();
  await expect(page.getByLabel('Session').getByRole('button', { name: 'Sign in' })).toBeVisible();

  // The catalog only holds the actor ref, so previews don't re-render it.
  await expect(stats(page, 'cart-catalog')).toHaveAttribute('data-renders', '1');
  await expectMountedOnce(page);
});

test('events sent during a preview are blocked and logged', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);
  await chooseMachine(page, 'checkout');
  await leaf(page, 'payment.error').click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Card declined');
  await alert.getByRole('button', { name: 'Retry' }).click();
  await alert.getByRole('button', { name: 'Edit card' }).click();

  // Still in the preview: nothing reached the machine.
  await expect(alert).toContainText('Card declined');
  await expect(page.getByText('Processing payment…')).toHaveCount(0);
  const entries = panel(page).locator('.sv-log-entry');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('EDIT_CARD');
  await expect(entries.nth(1)).toContainText('RETRY');
  await expect(entries.nth(1)).toContainText('checkout · 1 · in payment.error, shipping.standard');

  await panel(page).getByRole('button', { name: 'Clear' }).click();
  await expect(entries).toHaveCount(0);
});

test('releasing restores the real, current state, which kept running underneath', async ({ page }) => {
  await page.goto('/');
  const row = page.getByRole('listitem').filter({ hasText: 'hero.png' });
  await openPanel(page);
  await chooseMachine(page, 'upload');

  await row.getByRole('button', { name: 'Start' }).click();
  await leaf(page, 'failed').click();
  await expect(row.getByRole('alert')).toBeVisible();
  // The real upload finishes during the preview.
  await page.waitForTimeout(1200);
  await expect(row.getByText('Uploaded')).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Release', exact: true }).click();
  await expect(row.getByText('Uploaded')).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('value', '100');
});

test('a copied deep link reproduces the previews after a reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?keep=1');
  await openPanel(page);
  await chooseMachine(page, 'checkout');
  await leaf(page, 'payment.error').click();
  await leaf(page, 'shipping.express').click();
  await chooseMachine(page, 'session');
  await leaf(page, 'expired').click();

  await panel(page).getByRole('button', { name: 'Copy link' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  // Machines in registration order; the session's actor registers when its module loads.
  expect(new URL(link).search).toBe('?keep=1&debug-state=session:expired,checkout:shipping.express;payment.error');

  await page.goto(link);
  await expect(page.getByRole('radio', { name: /express/i })).toBeChecked();
  await expect(page.getByRole('alert').filter({ hasText: 'Card declined' })).toBeVisible();
  await expect(page.getByLabel('Session').getByRole('alert')).toHaveText('Session expired');
  await expect(bubble(page)).toHaveAccessibleName('State viewer, 2 previews active');
  await expectMountedOnce(page);

  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Card declined' })).toBeVisible();
});

test('keyboard: toggle, move through states, preview, release and switch machines', async ({ page }) => {
  await page.goto('/');
  // Ignored while typing.
  await page.getByLabel('Card number').focus();
  await page.keyboard.press('Alt+KeyS');
  await expect(panel(page)).toHaveCount(0);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+KeyS');
  await expect(panel(page)).toBeVisible();
  await chooseMachine(page, 'checkout');
  await leaf(page, 'shipping.standard').focus();

  await page.keyboard.press('ArrowDown');
  await expect(leaf(page, 'shipping.express')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: /express/i })).toBeChecked();

  await page.keyboard.press(']');
  await expect(machineSelect(page)).not.toHaveValue('checkout');
  await page.keyboard.press('[');
  await expect(machineSelect(page)).toHaveValue('checkout');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('radio', { name: /standard/i })).toBeChecked();
  await expect(bubble(page)).toHaveAccessibleName('State viewer');

  await page.keyboard.press('Alt+KeyS');
  await expect(panel(page)).toHaveCount(0);
});

test('the panel remembers whether it’s open, its corner and the selected machine', async ({ page }) => {
  await page.goto('/');
  await openPanel(page);
  await chooseMachine(page, 'cart');
  await panel(page).getByRole('button', { name: 'Move to the next corner' }).click();
  const box = await bubble(page).boundingBox();
  expect(box!.x).toBeLessThan(100);

  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(machineSelect(page)).toHaveValue('cart');
  expect((await bubble(page).boundingBox())!.x).toBeLessThan(100);
});

test.describe('style isolation', () => {
  /** Boxes and computed styles of the host and the overlay's parts, with the panel open on the checkout. */
  async function measureOverlay(page: Page, path: string) {
    await page.goto(path);
    // The first page left the panel open, and the second remembers it.
    if ((await panel(page).count()) === 0) await openPanel(page);
    await chooseMachine(page, 'checkout');
    // Off the bubble, whose hover scales it, then let the panel's entry and the bubble's transitions finish.
    await page.mouse.move(0, 0);
    await page
      .locator('[data-state-viewer-root]')
      .evaluate((host) => Promise.all(host.shadowRoot!.getAnimations().map((animation) => animation.finished)));
    const parts = [
      '.sv-bubble',
      '.sv-panel',
      '.sv-header',
      '.sv-title',
      '.sv-select',
      '.sv-icon-button',
      '[role="tree"]',
      '[data-leaf="payment.error"]',
      '[data-leaf="payment.error"] .sv-key',
      '.sv-data',
      '.sv-json',
      '.sv-footer .sv-button',
    ];
    return page.locator('[data-state-viewer-root]').evaluate((host, selectors) => {
      const properties = [
        'display',
        'position',
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'line-height',
        'letter-spacing',
        'text-transform',
        'text-align',
        'direction',
        'color',
        'background-color',
        'margin',
        'padding',
        'border',
        'border-radius',
        'box-sizing',
        'box-shadow',
        'outline-style',
        'opacity',
        'transform',
        'filter',
        'white-space',
        'cursor',
        'color-scheme',
      ];
      const describe = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          box: [box.x, box.y, box.width, box.height].map(Math.round),
          style: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])),
        };
      };
      const hostStyle = getComputedStyle(host);
      return {
        host: {
          display: hostStyle.display,
          position: hostStyle.position,
          zIndex: hostStyle.zIndex,
          opacity: hostStyle.opacity,
          transform: hostStyle.transform,
          filter: hostStyle.filter,
          pointerEvents: hostStyle.pointerEvents,
          zoom: hostStyle.getPropertyValue('zoom'),
        },
        parts: Object.fromEntries(
          selectors.map((selector) => {
            const element = host.shadowRoot!.querySelector(selector);
            return [selector, element && describe(element)];
          }),
        ),
      };
    }, parts);
  }

  test('hostile global CSS doesn’t change the overlay', async ({ page }) => {
    const plain = await measureOverlay(page, '/');
    const hostile = await measureOverlay(page, '/hostile.html');

    expect(plain.host).toEqual({
      display: 'block',
      position: 'fixed',
      zIndex: '2147483647',
      opacity: '1',
      transform: 'none',
      filter: 'none',
      pointerEvents: 'none',
      zoom: '1',
    });
    expect(hostile.host).toEqual(plain.host);
    for (const [selector, measured] of Object.entries(plain.parts)) {
      expect(measured, selector).not.toBeNull();
      expect(hostile.parts[selector], selector).toEqual(measured);
    }
  });

  test('the overlay adds no styles to the page and doesn’t move the app', async ({ page }) => {
    await page.goto('/');
    const measureApp = () =>
      page.locator('#root').evaluate((root) =>
        [...root.querySelectorAll('*')].map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return [box.x, box.y, box.width, box.height, style.color, style.font, style.backgroundColor].join(' ');
        }),
      );
    const before = await measureApp();
    await openPanel(page);
    await chooseMachine(page, 'checkout');
    await leaf(page, 'payment.editing.complete').click();
    await panel(page).getByRole('button', { name: 'Release all' }).click();

    expect(await measureApp()).toEqual(before);
    const leaked = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) =>
        [...sheet.cssRules].map((rule) => rule.cssText).filter((text) => /\.sv-|:host/.test(text)),
      ),
    );
    expect(leaked).toEqual([]);
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
    // The host is the only element the overlay adds to the page.
    const added = await page.evaluate(() =>
      [...document.body.children]
        .filter((element) => element.id !== 'root' && element.localName !== 'script')
        .map((element) => element.outerHTML),
    );
    expect(added).toEqual(['<div data-state-viewer-root=""></div>']);
  });
});
