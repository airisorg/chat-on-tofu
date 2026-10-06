import { expect, test } from '@playwright/test';

// Reviewed synthetic component baselines protect our renderer from drift.
// Google reference parity is separately checked with measured DOM geometry;
// these images do not assert that unsupported Google integrations exist.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} desktop compact navigation and Home component`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const nav = page.getByRole('complementary', { name: 'Chat navigation' });
    await nav.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await expect(nav).toHaveScreenshot(`navigation-${theme}.png`);
    await expect(page.getByRole('main')).toHaveScreenshot(`home-${theme}.png`);
  });

  test(`${theme} completed desktop recipient picker`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'New chat', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
    await popup.getByRole('combobox').fill('maya');
    await expect(popup.getByRole('option').filter({ hasText: 'Maya Chen' })).toBeVisible();
    expect(Math.round((await popup.boundingBox())!.width)).toBe(296);
    await expect(popup).toHaveScreenshot(`recipient-${theme}.png`);
  });

  test(`${theme} full emoji and compact message actions`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole('button', { name: 'Add emoji', exact: true }).click();
    const emoji = page.getByRole('dialog', { name: 'Add emoji', exact: true });
    await expect(emoji.getByRole('textbox')).toBeVisible();
    await expect(emoji).toHaveScreenshot(`emoji-${theme}.png`);
    await page.keyboard.press('Escape');
    const row = page.getByRole('main').getByRole('article').filter({ hasText: 'Good morning, team!' });
    await row.hover();
    await row.getByRole('button', { name: 'More actions', exact: true }).click();
    const actions = page.getByRole('dialog', { name: 'Message actions', exact: true });
    expect(Math.round((await actions.boundingBox())!.width)).toBe(178);
    await expect(actions).toHaveScreenshot(`message-actions-${theme}.png`);
  });
}

test('dark phone recipient modes and message actions', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
  await expect(popup.getByRole('button', { name: 'Direct message', exact: true })).toBeVisible();
  await expect(popup).toHaveScreenshot('phone-recipient-dark.png');
  await popup.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: /^Design team / }).click();
  const row = page.getByRole('main').getByRole('article').filter({ hasText: 'Good morning, team!' });
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  const actions = page.getByRole('dialog', { name: 'Message actions', exact: true });
  for (const button of await actions.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(actions).toHaveScreenshot('phone-message-actions-dark.png');
});
