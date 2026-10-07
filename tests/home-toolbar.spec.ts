import { expect, test, type Locator, type Page, type TestInfo } from './coverage-test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// The Google reference determines the primary arrangement. App goldens guard
// regressions; they do not certify Google's private CSS or phone implementation.
const sizes = [
  { width: 1024, height: 960, touch: false },
  { width: 1440, height: 960, touch: false },
  { width: 3440, height: 960, touch: false },
  { width: 390, height: 844, touch: true },
  { width: 320, height: 568, touch: true },
  { width: 1024, height: 360, touch: false },
  { width: 1440, height: 960, touch: true },
  { width: 768, height: 960, touch: false },
  { width: 799, height: 960, touch: false },
];
const menu = (page: Page) => page.getByRole('dialog', { name: 'Home view options', exact: true });
const options = (page: Page) =>
  page.getByRole('button', { name: 'Home view options', exact: true });
const actions = (page: Page) =>
  page.getByRole('button', { name: 'More Home actions', exact: true });
const actionsMenu = (page: Page) =>
  page.getByRole('dialog', { name: 'More Home actions', exact: true });
const directSplit = (page: Page) => page.getByRole('button', { name: 'Split pane', exact: true });

async function start(page: Page, theme: 'light' | 'dark') {
  const state = createDemoState();
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('relay-theme', 'system');
    },
    { key: DEMO_STORAGE_KEY, state },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const navigation =
    page.viewportSize()!.width < 800
      ? page.getByRole('navigation', { name: 'Main navigation', exact: true })
      : page.getByRole('complementary', { name: 'Chat navigation', exact: true });
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-view .conversation-row')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
}

async function hit(control: Locator, page: Page, touch: boolean) {
  const result = await control.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      hits: [3, r.width / 2, r.width - 3].map((x) =>
        node.contains(document.elementFromPoint(r.x + x, r.y + r.height / 2)),
      ),
    };
  });
  expect(result.x).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(result.y).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(result.hits).toEqual([true, true, true]);
  if (touch) {
    expect(result.width).toBeGreaterThanOrEqual(44);
    expect(result.height).toBeGreaterThanOrEqual(44);
  }
}

async function geometry(page: Page, info: TestInfo, phase: string) {
  const home = page.locator('.home-view');
  const header = home.locator('.home-header');
  const controls = page.getByTestId('home-controls');
  await expect(home.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('.home-filter-tabs')).toHaveCount(0);
  const metrics = await header.evaluate((node) => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const controls = node.querySelector('[data-testid="home-controls"]')!;
    return {
      header: { ...box(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth },
      heading: box(node.querySelector('h1')!),
      controls: box(controls),
      coarse: matchMedia('(pointer: coarse)').matches,
      buttons: [...controls.querySelectorAll('button')].map((e) => {
        const s = getComputedStyle(e);
        return {
          name: e.getAttribute('aria-label') || e.textContent?.trim(),
          ...box(e),
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          fontFamily: s.fontFamily,
          paddingTop: s.paddingTop,
          paddingBottom: s.paddingBottom,
        };
      }),
    };
  });
  const splitAvailable =
    page.viewportSize()!.width >= 1200 && page.viewportSize()!.height > 500 && !metrics.coarse;
  expect(metrics.buttons.map((button) => button.name)).toEqual(
    splitAvailable
      ? ['Unread', 'Threads', 'Split pane', 'Home view options', 'More Home actions']
      : ['Unread', 'Threads', 'More Home actions'],
  );
  expect(metrics.header.scrollWidth).toBeLessThanOrEqual(metrics.header.clientWidth + 1);
  expect(metrics.controls.right).toBeLessThanOrEqual(metrics.header.right);
  expect(metrics.controls.x).toBeGreaterThanOrEqual(metrics.header.x);
  for (const b of metrics.buttons) {
    expect(b.fontSize).toBe('14px');
    expect(b.lineHeight).toBe('20px');
    expect(b.fontFamily).toContain('Google Sans');
    expect(b.paddingTop).toBe(b.paddingBottom);
    expect(b.height).toBe(metrics.coarse || page.viewportSize()!.width < 800 ? 44 : 32);
  }
  const boxes = [metrics.heading, ...metrics.buttons];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)),
        'controls never overlap heading or each other',
      ).toBe(0);
    }
  if (page.viewportSize()!.width >= 800) {
    expect(metrics.controls.x).toBeGreaterThan(metrics.heading.right);
    expect(metrics.header.right - metrics.controls.right).toBeGreaterThanOrEqual(12);
    expect(metrics.header.right - metrics.controls.right).toBeLessThanOrEqual(24);
    expect(
      Math.abs(
        metrics.controls.y +
          metrics.controls.height / 2 -
          metrics.heading.y -
          metrics.heading.height / 2,
      ),
    ).toBeLessThanOrEqual(1);
  }
  const folder = evidenceDirectory(info, info.project.name);
  mkdirSync(folder, { recursive: true });
  const prefix = `${page.viewportSize()!.width}x${page.viewportSize()!.height}${metrics.coarse && page.viewportSize()!.width >= 800 ? '-coarse' : ''}-${await page.locator('html').getAttribute('data-theme')}-${phase}`;
  writeFileSync(resolve(folder, prefix + '.json'), JSON.stringify(metrics, null, 2) + '\n');
  const clip = {
    x: metrics.header.x,
    y: metrics.header.y,
    width: metrics.header.width,
    height: metrics.header.height,
  };
  await page.screenshot({ path: resolve(folder, prefix + '.png'), clip });
  await expect(header).toHaveScreenshot(`home-controls-${prefix}.png`);
  return controls;
}

for (const size of sizes)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`Home controls ${size.width}x${size.height}${size.touch ? ' coarse' : ''} ${theme}`, () => {
      test.use({ viewport: size, hasTouch: size.touch, isMobile: size.touch });
      test('separate view and app controls remain reachable', async ({ page }, info) => {
        await start(page, theme);
        const home = page.locator('.home-view');
        const unread = home.getByRole('switch', { name: 'Unread', exact: true });
        const threads = home.getByRole('checkbox', { name: 'Threads', exact: true });
        const splitExpected = size.width >= 1200 && size.height > 500 && !size.touch;
        const emptyPreview = page.getByRole('region', {
          name: 'Conversation preview placeholder',
          exact: true,
        });
        await expect(emptyPreview).toHaveCount(splitExpected ? 1 : 0);
        if (splitExpected) {
          await expect(
            emptyPreview.getByRole('heading', { name: 'No conversation selected', exact: true }),
          ).toBeVisible();
          const left = (await home.boundingBox())!,
            right = (await emptyPreview.boundingBox())!;
          expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
          expect(right.x - left.x - left.width).toBe(16);
          await hit(
            emptyPreview.getByRole('button', {
              name: 'Close empty conversation preview',
              exact: true,
            }),
            page,
            false,
          );
          await expect(
            emptyPreview.getByText('Use the toggle to switch between single and split pane modes', {
              exact: true,
            }),
          ).toBeVisible();
          // Crop the content: a small text regression must not disappear into the
          // allowed ratio of a mostly blank, ultrawide preview pane.
          await expect(emptyPreview.locator(':scope > div')).toHaveScreenshot(
            `home-empty-content-${size.width}-${theme}.png`,
            { maxDiffPixels: 0, maxDiffPixelRatio: 0 },
          );
        }
        await geometry(page, info, 'initial');
        for (const control of [
          unread,
          threads,
          actions(page),
          ...(splitExpected ? [directSplit(page), options(page)] : []),
        ])
          await hit(control, page, size.touch);
        await unread.click();
        await expect(unread).toHaveAttribute('aria-checked', 'true');
        await expect(home.locator('.conversation-row')).toHaveCount(2);
        await geometry(page, info, 'unread');
        await unread.click();
        await threads.click();
        await expect(threads).toHaveAttribute('aria-checked', 'true');
        await expect(
          home.getByRole('heading', { name: 'No threads yet', exact: true }),
        ).toBeVisible();
        await threads.click();
        await expect(home.locator('.conversation-row')).toHaveCount(5);
        await threads.press(info.project.name === 'WebKit' ? 'Alt+Tab' : 'Tab');
        await expect(splitExpected ? directSplit(page) : actions(page)).toBeFocused();
        // The persistent app overflow remains the fallback even without view mode.
        await actions(page).focus();
        const focus = await actions(page).evaluate((node) => {
          const s = getComputedStyle(node);
          return {
            visible: node.matches(':focus-visible'),
            width: parseFloat(s.outlineWidth),
            offset: parseFloat(s.outlineOffset),
          };
        });
        expect(focus.visible).toBe(true);
        expect(focus.width).toBeGreaterThanOrEqual(2);
        expect(focus.width + focus.offset).toBeLessThanOrEqual(0);
        await expect(page.getByTestId('home-controls')).toHaveScreenshot(
          `home-controls-focus-${size.width}x${size.height}${size.touch && size.width >= 800 ? '-coarse' : ''}-${theme}.png`,
        );
        await actions(page).press('Enter');
        await expect(actionsMenu(page)).toBeVisible();
        await expect(
          actionsMenu(page).getByRole('menuitemcheckbox', { name: 'Split pane mode', exact: true }),
        ).toHaveCount(0);
        for (const control of await actionsMenu(page)
          .getByRole('menuitem')
          .or(actionsMenu(page).getByRole('menuitemradio'))
          .or(actionsMenu(page).getByRole('menuitemcheckbox'))
          .all())
          await hit(control, page, size.touch);
        await expect(actionsMenu(page)).toHaveScreenshot(
          `home-actions-${size.width}x${size.height}${size.touch && size.width >= 800 ? '-coarse' : ''}-${theme}.png`,
        );
        await page.keyboard.press('Escape');
        await expect(actionsMenu(page)).toHaveCount(0);
        await expect(actions(page)).toBeFocused();
        await expect(options(page)).toHaveCount(splitExpected ? 1 : 0);
        if (splitExpected) {
          await options(page).click();
          await expect(menu(page).getByRole('menuitemradio')).toHaveCount(2);
          await expect(menu(page).getByRole('menuitem')).toHaveCount(0);
          await expect(menu(page).getByRole('menuitemcheckbox')).toHaveCount(0);
          expect(await menu(page).getByRole('menuitemradio').allTextContents()).toEqual([
            'Split pane',
            'Single pane',
          ]);
          const split = menu(page).getByRole('menuitemradio', { name: 'Split pane', exact: true });
          const single = menu(page).getByRole('menuitemradio', {
            name: 'Single pane',
            exact: true,
          });
          for (const control of [split, single]) await hit(control, page, false);
          expect((await menu(page).boundingBox())!.width).toBe(200);
          for (const control of [split, single])
            expect((await control.boundingBox())!.height).toBe(40);
          expect(await split.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
            await single.evaluate((node) => getComputedStyle(node).backgroundColor),
          );
          await expect(menu(page)).toHaveScreenshot(`home-view-options-${size.width}-${theme}.png`);
          await page.keyboard.press('Escape');
          await expect(options(page)).toBeFocused();
          await home.locator('.conversation-row').filter({ hasText: 'Design team' }).click();
          await expect(
            page.getByRole('region', { name: 'Conversation preview', exact: true }),
          ).toBeVisible();
          await geometry(page, info, 'preview');
          for (const control of [unread, threads, directSplit(page), options(page), actions(page)])
            await hit(control, page, false);
          await options(page).click();
          await expect(split).toHaveAttribute('aria-checked', 'true');
          await expect(single).toHaveAttribute('aria-checked', 'false');
          await single.click();
          await expect(
            page.getByRole('region', { name: 'Conversation preview', exact: true }),
          ).toHaveCount(0);
          await expect(menu(page)).toHaveCount(0);
          await expect(options(page)).toBeFocused();
          await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'false');
          await options(page).click();
          await expect(single).toHaveAttribute('aria-checked', 'true');
          await split.click();
          await expect(emptyPreview).toBeVisible();
          await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'true');
          await emptyPreview
            .getByRole('button', { name: 'Close empty conversation preview', exact: true })
            .click();
          await expect(emptyPreview).toHaveCount(0);
          await expect(home).toBeVisible();
          await expect(actions(page)).toBeFocused();
        }
      });
    });

for (const theme of ['light', 'dark'] as const)
  test.describe(`Separate Home mode semantics ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 960 }, hasTouch: false, isMobile: false });
    test('mode choices are idempotent, direct toggle is immediate and filters and draft survive', async ({
      page,
    }) => {
      await start(page, theme);
      const home = page.locator('.home-view');
      const emptyPreview = page.getByRole('region', {
        name: 'Conversation preview placeholder',
        exact: true,
      });
      await directSplit(page).focus();
      await directSplit(page).press('Enter');
      await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(emptyPreview).toHaveCount(0);
      await expect(directSplit(page)).toBeFocused();
      await directSplit(page).press('Enter');
      await expect(emptyPreview).toHaveCount(1);
      await expect(directSplit(page)).toBeFocused();
      await options(page).click();
      await menu(page).getByRole('menuitemradio', { name: 'Single pane', exact: true }).click();
      await expect(emptyPreview).toHaveCount(0);
      await expect(options(page)).toBeFocused();
      await options(page).click();
      await menu(page).getByRole('menuitemradio', { name: 'Split pane', exact: true }).click();
      await expect(emptyPreview).toHaveCount(1);
      await expect(options(page)).toBeFocused();
      await actions(page).click();
      await actionsMenu(page)
        .getByRole('menuitemradio', { name: 'Direct messages', exact: true })
        .click();
      await home.locator('.conversation-row').filter({ hasText: 'Maya Chen' }).click();
      const composer = page.getByRole('textbox', { name: 'Message', exact: true });
      await composer.fill('Draft retained across explicit view choices');
      const originalComposer = await composer.elementHandle();
      await options(page).click();
      await composer.click();
      await expect(menu(page)).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(composer).toBeFocused();
      // The app extensions never leak into the reference view menu, and the
      // two contextual menus cannot stay open simultaneously.
      await options(page).click();
      await expect(menu(page).getByRole('menuitemradio')).toHaveCount(2);
      await expect(
        menu(page).getByRole('menuitemradio', { name: 'Direct messages', exact: true }),
      ).toHaveCount(0);
      await actions(page).click();
      await expect(menu(page)).toHaveCount(0);
      await expect(actionsMenu(page)).toHaveCount(1);
      await expect(actions(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(options(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(actionsMenu(page).getByRole('menuitemradio')).toHaveCount(2);
      await expect(
        actionsMenu(page).getByRole('menuitemradio', { name: 'Split pane', exact: true }),
      ).toHaveCount(0);
      await options(page).click();
      await expect(actionsMenu(page)).toHaveCount(0);
      await expect(menu(page)).toHaveCount(1);
      await expect(options(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(actions(page)).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Escape');
      await expect(options(page)).toBeFocused();
      await options(page).press('ArrowDown');
      const split = menu(page).getByRole('menuitemradio', { name: 'Split pane', exact: true });
      const single = menu(page).getByRole('menuitemradio', { name: 'Single pane', exact: true });
      await expect(split).toBeFocused();
      await expect(split).toHaveAttribute('aria-checked', 'true');
      await split.press('Enter');
      await expect(menu(page)).toHaveCount(0);
      await expect(options(page)).toBeFocused();
      expect(await originalComposer!.evaluate((node) => node.isConnected)).toBe(true);
      await expect(composer).toHaveValue('Draft retained across explicit view choices');
      await options(page).press('Enter');
      await split.press('ArrowDown');
      await expect(single).toBeFocused();
      await single.press('Enter');
      await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(options(page)).toBeFocused();
      await expect(composer).toHaveCount(0);
      await expect(home.locator('.conversation-row')).toHaveCount(3);
      await expect(home.getByLabel('Active Home filters', { exact: true })).toContainText(
        'Direct messages',
      );
      await options(page).press('Enter');
      await single.click();
      await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(home.locator('.conversation-row')).toHaveCount(3);
      await directSplit(page).focus();
      await directSplit(page).press('Enter');
      await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(directSplit(page)).toBeFocused();
      await expect(menu(page)).toHaveCount(0);
      await home.locator('.conversation-row').filter({ hasText: 'Maya Chen' }).click();
      await expect(composer).toHaveValue('Draft retained across explicit view choices');
      await directSplit(page).click();
      await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(directSplit(page)).toBeFocused();
      // An open mode menu must close safely when its desktop-only trigger goes away.
      await options(page).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(menu(page)).toHaveCount(0);
      await expect(options(page)).toHaveCount(0);
      await expect(actions(page)).toBeFocused();
      await hit(actions(page), page, true);
      await expect(home.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
      await expect(home.getByLabel('Active Home filters', { exact: true })).toContainText(
        'Direct messages',
      );
    });
  });

test.describe('Populated Home preview responsive focus', () => {
  test.use({ viewport: { width: 1440, height: 960 }, hasTouch: false, isMobile: false });
  test('open view menu resize keeps the selected conversation draft and focuses its composer', async ({
    page,
  }) => {
    await start(page, 'light');
    const home = page.locator('.home-view');
    await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'true');
    await home
      .locator('.conversation-row')
      .filter({
        has: page.locator('.conversation-row-content > strong').filter({ hasText: /^Maya Chen$/ }),
      })
      .click();
    const preview = page.getByRole('region', { name: 'Conversation preview', exact: true });
    await expect(preview).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    const draft = 'Keep this exact Maya draft when the open mode menu loses its desktop anchor';
    await composer.fill(draft);
    const originalComposer = await composer.elementHandle();
    await options(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(
      menu(page).getByRole('menuitemradio', { name: 'Split pane', exact: true }),
    ).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(home).toHaveCount(0);
    await expect(menu(page)).toHaveCount(0);
    await expect(options(page)).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    const conversation = page.getByRole('region', { name: 'Conversation', exact: true });
    await expect(conversation).toBeVisible();
    await expect(
      conversation.getByRole('heading', { name: 'Maya Chen', exact: true }),
    ).toBeVisible();
    expect(await originalComposer!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(conversation.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      draft,
    );
    await expect(composer).toBeFocused();
  });

  async function filledPreview(page: Page, draft: string) {
    await start(page, 'light');
    await expect(directSplit(page)).toHaveAttribute('aria-pressed', 'true');
    await page
      .locator('.home-view .conversation-row')
      .filter({
        has: page.locator('.conversation-row-content > strong').filter({ hasText: /^Maya Chen$/ }),
      })
      .click();
    const preview = page.getByRole('region', { name: 'Conversation preview', exact: true });
    await expect(preview).toBeVisible();
    const composer = preview.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill(draft);
    return composer;
  }

  async function resizeFilledPreview(page: Page, draft: string) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.home-view')).toHaveCount(0);
    await expect(menu(page)).toHaveCount(0);
    const conversation = page.getByRole('region', { name: 'Conversation', exact: true });
    await expect(
      conversation.getByRole('heading', { name: 'Maya Chen', exact: true }),
    ).toBeVisible();
    const composer = conversation.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toHaveValue(draft);
    // Observe focus after the responsive commit and any scheduled handoff,
    // rather than passing before an erroneous animation-frame focus runs.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    return composer;
  }

  test('resize retains an already focused preview composer', async ({ page }) => {
    const draft = 'Composer focus is already owned by this Maya draft';
    const before = await filledPreview(page, draft);
    await expect(before).toBeFocused();
    const original = await before.elementHandle();
    const composer = await resizeFilledPreview(page, draft);
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(composer).toBeFocused();
  });

  test('resize does not steal deliberately cleared body focus', async ({ page }) => {
    const draft = 'A neutral focus state must not automatically focus this composer';
    await filledPreview(page, draft);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    const composer = await resizeFilledPreview(page, draft);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await expect(composer).not.toBeFocused();
  });

  test('resize leaves a visible profile editor focus and unsaved edit intact', async ({ page }) => {
    const draft = 'Conversation draft remains separate from the focused profile editor';
    await filledPreview(page, draft);
    await page.getByRole('button', { name: 'Your profile', exact: true }).click();
    const profile = page.getByRole('dialog', { name: 'Your profile', exact: true });
    const name = profile.getByRole('textbox', { name: 'Display name', exact: true });
    await name.fill('Unsaved focused profile change');
    await expect(name).toBeFocused();
    const composer = await resizeFilledPreview(page, draft);
    await expect(profile).toBeVisible();
    await expect(name).toBeVisible();
    await expect(name).toHaveValue('Unsaved focused profile change');
    await expect(name).toBeFocused();
    await expect(composer).not.toBeFocused();
  });
});
