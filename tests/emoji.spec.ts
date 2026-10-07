import { expect, test, type Page } from '@playwright/test';

async function demo(page: Page) {
  await page.goto('/');
  const preview = page.getByRole('button', {
    name: 'Explore demo',
    exact: true,
  });
  await Promise.race([
    preview.waitFor({ state: 'visible' }),
    page.locator('.app-shell').waitFor({ state: 'visible' }),
  ]);
  if (await preview.isVisible()) await preview.click();
  const main = page.getByRole('main');
  if (!(await main.getByRole('heading', { name: 'Design team', exact: true }).isVisible()))
    await main
      .getByRole('button', { name: /Design team/ })
      .first()
      .click();
}
const message = (page: Page) =>
  page.getByRole('main').getByRole('article').filter({ hasText: 'Good morning, team!' });
async function reaction(page: Page) {
  const row = message(page);
  await row.hover();
  const add = row.getByRole('button', { name: 'Add reaction', exact: true });
  if (await add.isVisible()) await add.click();
  else {
    await row.getByRole('button', { name: 'More actions', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Message actions', exact: true })
      .getByRole('button', { name: 'Add reaction', exact: true })
      .click();
  }
  const picker = page.getByRole('dialog', {
    name: 'Add a reaction',
    exact: true,
  });
  await expect(picker.getByRole('textbox', { name: 'Search emoji' })).toBeVisible();
  return picker;
}
test.beforeEach(async ({ page }) => {
  await demo(page);
});

test('desktop emoji window matches measured geometry and alias search creates a real reaction', async ({
  page,
}, testInfo) => {
  const picker = await reaction(page);
  await expect(picker).toHaveAttribute('aria-modal', 'false');
  await expect(picker.getByRole('button', { name: 'Close dialog' })).toHaveCount(0);
  const panel = await picker.boundingBox();
  expect(panel!.width).toBe(370);
  expect(panel!.height).toBe(386);
  const search = picker.getByRole('textbox', { name: 'Search emoji' });
  expect((await search.locator('..').boundingBox())!.height).toBe(32);
  await expect(search).toHaveCSS('font-size', '14px');
  const categories = picker.getByRole('tablist', { name: 'Emoji categories' });
  expect((await categories.boundingBox())!.height).toBe(32);
  await expect(categories.getByRole('tab')).toHaveCount(9);
  const emoji = picker
    .getByRole('region', { name: 'Suggested', exact: true })
    .getByRole('button', { name: 'React 👍', exact: true });
  const cell = await emoji.boundingBox();
  expect(cell!.width).toBe(40);
  expect(cell!.height).toBe(40);
  await expect(emoji).toHaveCSS('font-size', '28px');
  const columns = await emoji
    .locator('..')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(9);
  await picker.screenshot({
    path: testInfo.outputPath('desktop-full-emoji-picker.png'),
  });
  await search.fill(':thumbsup:');
  await expect(picker.getByRole('button', { name: 'React 👍', exact: true })).toBeVisible();
  await search.press('ArrowDown');
  await expect(picker.getByRole('button', { name: 'React 👍', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(message(page).getByRole('button', { name: /^👍,/ })).toBeVisible();
  await page.reload();
  await demo(page);
  await expect(message(page).getByRole('button', { name: /^👍,/ })).toBeVisible();
});

test('all catalog categories work, tab arrows navigate and search finds keywords and native emoji', async ({
  page,
}) => {
  const picker = await reaction(page);
  const groups = [
    'Smileys & people',
    'Animals & nature',
    'Food & drink',
    'Activities',
    'Travel & places',
    'Objects',
    'Symbols',
    'Flags',
  ];
  for (const name of groups) {
    const tab = picker.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = picker.getByRole('tabpanel', { name, exact: true });
    await expect(panel).toBeVisible();
    expect(await tab.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));
    expect(await panel.getAttribute('aria-labelledby')).toBe(await tab.getAttribute('id'));
    expect(await picker.locator('[data-emoji-id]').count()).toBeGreaterThan(70);
  }
  await expect(picker.locator('[data-emoji-id="flag-gr"]')).toHaveText('🇬🇷');
  const flags = picker.getByRole('tab', { name: 'Flags', exact: true });
  await flags.focus();
  await flags.press('ArrowLeft');
  await expect(picker.getByRole('tab', { name: 'Symbols', exact: true })).toBeFocused();
  const search = picker.getByRole('textbox', { name: 'Search emoji' });
  await search.fill('   ');
  await expect(picker.getByRole('tab', { name: 'Symbols', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(picker.getByRole('tabpanel', { name: 'Symbols', exact: true })).toBeVisible();
  await search.fill('melting');
  await expect(
    picker.getByRole('region', { name: 'Emoji search results', exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole('tabpanel')).toHaveCount(0);
  await expect(picker.locator('[data-emoji-id="melting_face"]')).toHaveText('🫠');
  await search.fill('🇬🇷');
  await expect(picker.locator('[data-emoji-id="flag-gr"]')).toHaveText('🇬🇷');
  await search.fill('a-word-that-no-emoji-has');
  await expect(picker.getByText('No emoji found. Try a name or keyword.')).toBeVisible();
  await picker.getByRole('button', { name: 'Clear emoji search' }).click();
  await expect(search).toHaveValue('');
  await expect(picker.getByRole('tabpanel', { name: 'Symbols', exact: true })).toBeVisible();
  await picker.getByRole('tab', { name: 'Food & drink', exact: true }).click();
  const first = picker.locator('[data-emoji-id]').first();
  await first.focus();
  await first.press('ArrowRight');
  await expect(picker.locator('[data-emoji-id]').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(picker.locator('[data-emoji-id]').nth(10)).toBeFocused();
});

test('skin tones and actual frequently used choices persist without reading another account’s preferences', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'chat-emoji-preferences:demo-you',
      JSON.stringify({
        tone: 99,
        recents: [
          { id: 'constructor', tone: 0 },
          { id: 'toString', tone: 0 },
          { id: 'unknown', tone: 0 },
          { id: '+1', tone: 999 },
        ],
      }),
    ),
  );
  let picker = await reaction(page);
  await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
  await expect(picker.getByText('Emoji you choose will appear here.')).toBeVisible();
  await picker.getByRole('tab', { name: 'Smileys & people', exact: true }).click();
  await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
  await expect(
    picker.getByRole('menuitemradio', {
      name: 'Default skin tone',
      exact: true,
    }),
  ).toBeFocused();
  await picker.getByRole('menuitemradio', { name: 'Medium dark skin tone', exact: true }).click();
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('thumbsup');
  await picker.getByRole('button', { name: 'React 👍🏾', exact: true }).click();
  await expect(message(page).getByRole('button', { name: /^👍🏾,/ })).toBeVisible();
  await page.reload();
  await demo(page);
  picker = await reaction(page);
  await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'React 👍🏾', exact: true })).toBeVisible();
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('chat-emoji-preferences:demo-you') || 'null'),
  );
  expect(preferences).toMatchObject({
    tone: 4,
    recents: [{ id: '+1', tone: 4 }],
  });
  await page.evaluate(() => {
    localStorage.setItem(
      'chat-emoji-preferences:another-account',
      localStorage.getItem('chat-emoji-preferences:demo-you')!,
    );
    localStorage.removeItem('chat-emoji-preferences:demo-you');
  });
  await page.reload();
  await demo(page);
  picker = await reaction(page);
  await picker.getByRole('tab', { name: 'Frequently used', exact: true }).click();
  await expect(picker.getByText('Emoji you choose will appear here.')).toBeVisible();
  await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
  await expect(
    picker.getByRole('menuitemradio', {
      name: 'Default skin tone',
      exact: true,
    }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('composer emoji replaces its selection and Escape restores the anchored opener', async ({
  page,
}) => {
  const composer = page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Hello replace me friend');
  await composer.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 16));
  const opener = page.getByRole('main').getByRole('button', { name: 'Add emoji', exact: true });
  await opener.click();
  let picker = page.getByRole('dialog', { name: 'Add emoji', exact: true });
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('red heart');
  await picker.getByRole('button', { name: 'Insert ❤️', exact: true }).click();
  await expect(composer).toHaveValue('Hello ❤️ friend');
  await expect(composer).toBeFocused();
  await opener.click();
  picker = page.getByRole('dialog', { name: 'Add emoji', exact: true });
  await expect(picker.getByRole('textbox', { name: 'Search emoji' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(opener).toBeFocused();
  await composer.fill('a'.repeat(6000));
  await opener.click();
  picker = page.getByRole('dialog', { name: 'Add emoji', exact: true });
  await picker.getByRole('textbox', { name: 'Search emoji' }).fill('melting');
  await picker.getByRole('button', { name: 'Insert 🫠', exact: true }).click();
  await expect(composer).toHaveValue('a'.repeat(6000));
  await expect(page.getByRole('status')).toContainText('6,000 characters');
});

test.describe('phone touch emoji picker', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  test('short dark viewport retains search, tones and 44px category and emoji targets', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 460 });
    const picker = await reaction(page);
    const box = await picker.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(12);
    expect(box!.x + box!.width).toBeLessThanOrEqual(378);
    expect(box!.y + box!.height).toBeLessThanOrEqual(448);
    const search = picker.getByRole('textbox', { name: 'Search emoji' });
    await expect(search).toHaveCSS('font-size', '16px');
    const undersized = await picker
      .locator('[role="tab"], [data-emoji-id]')
      .evaluateAll((controls) =>
        controls
          .map((control) => ({
            label: control.getAttribute('aria-label'),
            rect: control.getBoundingClientRect(),
          }))
          .filter(({ rect }) => rect.width < 44 || rect.height < 44)
          .map(({ label }) => label),
      );
    expect(undersized).toEqual([]);
    const selected = picker.getByRole('tab', {
      name: 'Smileys & people',
      exact: true,
    });
    await expect(selected).toHaveCSS('color', 'rgb(168, 199, 250)');
    await expect(search).toHaveCSS('color', 'rgb(227, 227, 227)');
    const sample = await search.evaluate((element) => {
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (color: number[]) =>
        color
          .map((channel) => {
            const v = channel / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(rgb(getComputedStyle(element).color));
      const background = luminance(rgb(getComputedStyle(element.parentElement!).backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(sample).toBeGreaterThanOrEqual(4.5);
    await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
    const tones = picker.getByRole('menu', { name: 'Skin tones' });
    const toneBox = await tones.boundingBox();
    expect(toneBox!.y + toneBox!.height).toBeLessThanOrEqual(box!.y + box!.height);
    for (const tone of await tones.getByRole('menuitemradio').all())
      expect((await tone.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(picker).toBeVisible();
    await picker.screenshot({
      path: testInfo.outputPath('iphone-dark-full-emoji-picker.png'),
    });
    await search.fill('thumbsup');
    await picker.getByRole('button', { name: 'React 👍', exact: true }).click();
    await expect(message(page).getByRole('button', { name: /^👍,/ })).toBeVisible();
    const reopened = await reaction(page);
    await page.getByRole('main').getByRole('textbox', { name: 'Message', exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await reaction(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add a reaction', exact: true })).toHaveCount(0);
  });
});
