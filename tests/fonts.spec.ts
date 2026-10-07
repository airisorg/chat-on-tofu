import { expect, test, type Locator, type Page } from '@playwright/test';

async function loadedFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const probe = await page.evaluate(() => {
    const faces = [...document.fonts].map((font) => ({
      family: font.family,
      status: font.status,
    }));
    const resources = performance
      .getEntriesByType('resource')
      .filter((resource) => /\/fonts\/.*\.woff2/.test(resource.name))
      .map((resource) => resource.name);
    const canvas = document.createElement('canvas').getContext('2d')!;
    const widths: Record<string, number> = {};
    for (const family of ['Google Sans', 'Roboto', 'monospace']) {
      canvas.font = `400 24px '${family}', monospace`;
      widths[family] = canvas.measureText('Home Direct messages Start chat').width;
    }
    return {
      faces,
      resources,
      widths,
      checks: [
        document.fonts.check('400 24px "Google Sans"'),
        document.fonts.check('500 14px "Google Sans"'),
        document.fonts.check('400 14px "Roboto"'),
      ],
    };
  });
  for (const family of ['Google Sans', 'Roboto']) {
    expect(
      probe.faces.some((face) => face.family === family && face.status === 'loaded'),
      `${family} loaded face`,
    ).toBeTruthy();
    expect(probe.widths[family]).not.toBeCloseTo(probe.widths.monospace, 1);
  }
  expect(probe.checks).toEqual([true, true, true]);
  expect(probe.resources.length).toBeGreaterThanOrEqual(2);
  for (const url of probe.resources) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  return probe;
}

async function metric(element: Locator) {
  return element.evaluate((node) => {
    const css = getComputedStyle(node);
    return {
      family: css.fontFamily,
      size: css.fontSize,
      weight: css.fontWeight,
      line: css.lineHeight,
      tracking: css.letterSpacing,
    };
  });
}

test.beforeEach(async ({ page }) => {
  // This establishes that rendering depends only on the app's font assets.
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
});

test('desktop loads same-origin licensed fonts and matches measured navigation, search, heading and recipient metrics', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
  const probe = await loadedFonts(page);
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Chat navigation' });
  await sidebar.getByRole('button', { name: 'Home', exact: true }).click();
  const nav = await metric(sidebar.getByRole('button', { name: 'Home', exact: true }));
  const heading = await metric(
    page.getByRole('main').getByRole('heading', { name: 'Home', exact: true }),
  );
  const search = await metric(page.getByRole('textbox', { name: 'Search in chat', exact: true }));
  expect(nav).toMatchObject({
    size: '14px',
    weight: '400',
    line: '16px',
    tracking: 'normal',
  });
  expect(nav.family).toContain('Google Sans');
  expect(heading).toMatchObject({
    size: '24px',
    weight: '400',
    line: '32px',
    tracking: 'normal',
  });
  expect(heading.family).toContain('Google Sans');
  expect(search).toMatchObject({ size: '16px', weight: '400' });
  expect(search.family).toContain('Google Sans');
  await page.locator('.home-header').screenshot({ path: testInfo.outputPath('home-heading.png') });
  await sidebar.screenshot({ path: testInfo.outputPath('navigation.png') });
  await sidebar.getByRole('button', { name: 'New chat', exact: true }).click();
  const popup = page.getByRole('dialog', {
    name: 'Start a conversation',
    exact: true,
  });
  const recipient = await metric(popup.getByRole('combobox', { name: 'To', exact: true }));
  expect(recipient).toMatchObject({
    size: '14px',
    weight: '400',
    line: '20px',
    tracking: 'normal',
  });
  expect(recipient.family).toContain('Google Sans');
  await popup.screenshot({ path: testInfo.outputPath('new-chat.png') });
  let actualFonts: unknown = undefined;
  if (testInfo.project.name === 'Chrome') {
    const session = await context.newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const document = await session.send('DOM.getDocument');
    const query = await session.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '.nav-item > span:first-of-type',
    });
    actualFonts = await session.send('CSS.getPlatformFontsForNode', {
      nodeId: query.nodeId,
    });
    expect(
      (
        actualFonts as {
          fonts: Array<{
            familyName: string;
            isCustomFont: boolean;
            glyphCount: number;
          }>;
        }
      ).fonts.some(
        (font) =>
          font.familyName.startsWith('Google Sans') && font.isCustomFont && font.glyphCount > 0,
      ),
    ).toBeTruthy();
    await session.detach();
  }
  await testInfo.attach('typography-probe.json', {
    body: JSON.stringify(
      {
        probe,
        nav,
        heading,
        search,
        recipient,
        actualFonts,
        limitation:
          'Reference styles are measured CSS; Google Sans Text/Flex exact glyph variants and physical iPhone rendering are not established.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test.describe('touch phone font rendering', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('bundled fonts render the landing and retain 16px inputs and visible touch controls', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
    await loadedFonts(page);
    await page.screenshot({ path: testInfo.outputPath('phone-landing.png') });
    await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
    const main = page.getByRole('main');
    await main
      .getByRole('button', { name: /Design team/ })
      .first()
      .click();
    await expect(main.getByRole('textbox', { name: 'Message', exact: true })).toHaveCSS(
      'font-size',
      '16px',
    );
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    const popup = page.getByRole('dialog', {
      name: 'Start a conversation',
      exact: true,
    });
    await expect(popup.getByRole('combobox', { name: 'To', exact: true })).toHaveCSS(
      'font-size',
      '16px',
    );
    for (const name of ['Direct message', 'Group', 'Space']) {
      const button = popup.getByRole('button', { name, exact: true });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(button).toHaveCSS('font-size', '14px');
    }
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(geometry.content).toBeLessThanOrEqual(geometry.viewport + 1);
    await popup.screenshot({ path: testInfo.outputPath('phone-new-chat.png') });
  });
});
