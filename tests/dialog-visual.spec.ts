import { expect, test, type Locator, type Page } from '@playwright/test';

// Reviewed app baselines, not Google pixel-parity evidence. Geometry and hit
// assertions run before snapshots so a new baseline cannot hide inaccessible UI.
async function reachable(dialog: Locator, page: Page) {
  const viewport = page.viewportSize()!;
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  for (const control of await dialog.locator('button, input, select').all()) {
    if (!await control.isVisible()) continue;
    await control.scrollIntoViewIfNeeded();
    expect(await control.evaluate(node => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), await control.getAttribute('aria-label') || await control.textContent() || 'control hit target').toBe(true);
  }
  await dialog.evaluate(node => { node.scrollTop = 0; });
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark'] as const) test.describe(`${width}px ${theme} dialogs`, () => {
  test.use({ viewport: { width, height: width === 1440 ? 960 : width === 390 ? 844 : 568 }, isMobile: width < 800, hasTouch: width < 800 });
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  });

  test('Settings default and changed draft preference remain readable and reachable', async ({ page }) => {
    if (width < 800) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('dialog', { name: 'More in Chat', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    } else await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await reachable(settings, page);
    const appearance = settings.getByRole('combobox', { name: 'Appearance', exact: true });
    const originalBox = (await appearance.boundingBox())!;
    expect(originalBox.width).toBe(92);
    if (width < 800) expect(originalBox.height).toBeGreaterThanOrEqual(44);
    // Native selection remains functional while the field keeps a stable box.
    for (const option of ['light', 'dark', 'system']) {
      await appearance.selectOption(option);
      await expect(appearance).toHaveValue(option);
      const bounds = (await appearance.boundingBox())!;
      expect(bounds.x).toBe(originalBox.x);
      expect(bounds.width).toBe(originalBox.width);
      expect(bounds.height).toBe(originalBox.height);
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(settings).toHaveScreenshot(`settings-${width}-${theme}.png`);
    const drafts = settings.getByRole('switch', { name: 'Save drafts on this device' });
    await drafts.click();
    await expect(drafts).toHaveAttribute('aria-checked', 'false');
    await expect(settings).toContainText('They won’t be restored after a reload.');
    await reachable(settings, page);
    await expect(settings).toHaveScreenshot(`settings-drafts-off-${width}-${theme}.png`);
    await settings.getByRole('button', { name: 'Close dialog' }).click();
    await expect(settings).toHaveCount(0);
  });

  test('Profile selected preset and keyboard focus stay separate from Save and account actions', async ({ page }) => {
    await page.getByRole('banner').getByRole('button', { name: 'Your profile', exact: true }).click();
    const profile = page.getByRole('dialog', { name: 'Your profile', exact: true });
    await reachable(profile, page);
    await expect(profile).toHaveScreenshot(`profile-${width}-${theme}.png`);
    await profile.getByRole('button', { name: 'Away', exact: true }).click();
    await expect(profile.getByRole('button', { name: 'Away', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const save = profile.getByRole('button', { name: 'Save', exact: true });
    await page.keyboard.press('Tab');
    await save.focus();
    await expect(save).toBeFocused();
    expect(await save.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    await reachable(profile, page);
    await save.scrollIntoViewIfNeeded();
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.y).toBeGreaterThanOrEqual(0);
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(profile).toHaveScreenshot(`profile-away-focus-${width}-${theme}.png`);
    await profile.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(profile).toHaveCount(0);
  });
});

for (const theme of ['light', 'dark'] as const) test(`desktop ${theme} availability menu focus and active selection`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const opener = page.getByRole('banner').getByRole('button', { name: 'Active', exact: true });
  await opener.click();
  const menu = page.getByRole('dialog', { name: 'Availability', exact: true });
  await expect(menu.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await menu.getByRole('button', { name: 'Away', exact: true }).focus();
  await reachable(menu, page);
  await expect(menu).toHaveScreenshot(`availability-focus-${theme}.png`);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
});
