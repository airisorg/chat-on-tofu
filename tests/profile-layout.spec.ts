import { expect, test, type Locator, type Page, type TestInfo } from './coverage-test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// Local composed profile regression, not a Google pixel oracle or hosted account edit.
const longName = 'W'.repeat(80);
const longEmail = 'e'.repeat(64) + '@' + 'domain'.repeat(10) + '.example.invalid';

async function openProfile(page: Page, theme: 'light' | 'dark', stressIdentity = true) {
  const state = createDemoState();
  if (stressIdentity) state.user = { ...state.user, name: longName, email: longEmail };
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
  await page.getByRole('button', { name: 'Your profile', exact: true }).first().click();
  const profile = page.getByRole('dialog', { name: 'Your profile', exact: true });
  await expect(profile).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
  return profile;
}

async function capture(
  page: Page,
  profile: Locator,
  info: TestInfo,
  phase: string,
  identities = [longName, longEmail],
) {
  const folder = evidenceDirectory(info, info.project.name);
  mkdirSync(folder, { recursive: true });
  const prefix = `${page.viewportSize()!.width}x${page.viewportSize()!.height}-${await page.locator('html').getAttribute('data-theme')}-${phase}`;
  const metrics = await profile.evaluate((dialog, texts) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const styles = (node: Element) => {
      const s = getComputedStyle(node);
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        color: s.color,
        background: s.backgroundColor,
        padding: s.padding,
        gap: s.gap,
        borderRadius: s.borderRadius,
        overflowWrap: s.overflowWrap,
      };
    };
    const identities = [...dialog.querySelectorAll('strong, span')].filter((node) =>
      texts.includes(node.textContent || ''),
    );
    return {
      dialog: {
        ...box(dialog),
        clientWidth: dialog.clientWidth,
        scrollWidth: dialog.scrollWidth,
        scrollHeight: dialog.scrollHeight,
        clientHeight: dialog.clientHeight,
        ...styles(dialog),
      },
      title: styles(dialog.querySelector('h2')!),
      labels: [...dialog.querySelectorAll('label')].map((node) => ({
        text: node.textContent,
        ...styles(node),
      })),
      identity: identities.map((node) => ({
        text: node.textContent,
        ...box(node),
        ...styles(node),
      })),
      controls: [...dialog.querySelectorAll('button,input')].map((node) => ({
        text: node.getAttribute('aria-label') || node.textContent,
        ...box(node),
        ...styles(node),
      })),
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, identities);
  writeFileSync(resolve(folder, prefix + '.json'), JSON.stringify(metrics, null, 2) + '\n');
  await page.screenshot({ path: resolve(folder, prefix + '.png') });
}

async function hit(control: Locator, page: Page) {
  await control.scrollIntoViewIfNeeded();
  const state = await control.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      hit: node.contains(target),
      target: target?.outerHTML.slice(0, 250),
    };
  });
  expect(state.x).toBeGreaterThanOrEqual(0);
  expect(state.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(state.y).toBeGreaterThanOrEqual(0);
  expect(state.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(state.hit, JSON.stringify(state)).toBe(true);
  return state;
}

async function readable(text: Locator) {
  const contrast = await text.evaluate((node) => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const luminance = (color: number[]) => {
      const [r, g, b] = color.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let parent: Element | null = node;
    let background = '';
    while (parent) {
      background = getComputedStyle(parent).backgroundColor;
      if (background !== 'transparent' && !/rgba\(.*?,\s*0\)$/.test(background)) break;
      parent = parent.parentElement;
    }
    const foreground = luminance(rgb(getComputedStyle(node).color));
    const behind = luminance(rgb(background));
    return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
  });
  expect(
    contrast,
    (await text.textContent())?.slice(0, 30) || 'Profile text contrast',
  ).toBeGreaterThanOrEqual(4.5);
}

for (const width of [1440, 390, 320])
  for (const theme of ['light', 'dark'] as const)
    test.describe(`profile layout ${width}px ${theme}`, () => {
      test.use({
        viewport: { width, height: width === 1440 ? 960 : width === 390 ? 844 : 568 },
        isMobile: width < 800,
        hasTouch: width < 800,
      });
      test('long identity and all profile controls remain inside the visible form', async ({
        page,
      }, info) => {
        const profile = await openProfile(page, theme);
        await expect(profile.getByRole('textbox')).toHaveCount(2);
        await expect(
          profile.getByRole('textbox', { name: 'Display name', exact: true }),
        ).toHaveValue(longName);
        await expect(profile.getByRole('textbox', { name: 'Status', exact: true })).toBeVisible();
        await expect(profile.getByText(longName, { exact: true })).toHaveCount(1);
        await expect(profile.getByText(longEmail, { exact: true })).toHaveCount(1);
        await capture(page, profile, info, 'identity');
        const bounds = (await profile.boundingBox())!;
        for (const text of [longName, longEmail]) {
          const identity = (await profile.getByText(text, { exact: true }).boundingBox())!;
          expect(
            identity.x,
            'legal identity text starts inside the profile',
          ).toBeGreaterThanOrEqual(bounds.x + 1);
          expect(
            identity.x + identity.width,
            'legal identity text ends inside the profile',
          ).toBeLessThanOrEqual(bounds.x + bounds.width - 1);
          await readable(profile.getByText(text, { exact: true }));
        }
        expect(
          await profile.evaluate((node) => node.scrollWidth - node.clientWidth),
        ).toBeLessThanOrEqual(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        // Selected measured tokens are app contracts, not an exact Google profile oracle.
        await expect(profile.getByRole('heading', { name: 'Your profile', exact: true })).toHaveCSS(
          'font-size',
          '22px',
        );
        await expect(profile.getByRole('heading', { name: 'Your profile', exact: true })).toHaveCSS(
          'font-weight',
          '400',
        );
        await expect(profile.getByRole('heading', { name: 'Your profile', exact: true })).toHaveCSS(
          'line-height',
          '20px',
        );
        await expect(profile).toHaveCSS('border-radius', '28px');
        expect(
          await profile
            .getByText(longEmail, { exact: true })
            .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
        ).toBeGreaterThanOrEqual(12);
        for (const label of await profile.locator('label').all()) {
          expect(
            await label.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
          ).toBeGreaterThanOrEqual(14);
          await readable(label);
        }
        await profile.getByRole('button', { name: 'Active', exact: true }).click();
        await expect(profile).toBeVisible();
        await expect(profile.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        const save = (await profile
          .getByRole('button', { name: 'Save', exact: true })
          .boundingBox())!;
        const account = (await profile
          .getByRole('button', { name: 'Leave demo', exact: true })
          .boundingBox())!;
        expect(account.y, 'account action is below the editing footer').toBeGreaterThanOrEqual(
          save.y + save.height + 8,
        );
        for (const name of [
          'Active',
          'Away',
          'Do not disturb',
          'Cancel',
          'Save',
          'Leave demo',
          'Close dialog',
        ]) {
          const control = profile.getByRole('button', { name, exact: true });
          await expect(control).toHaveCount(1);
          const box = await hit(control, page);
          if (width < 800) {
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
          if (name !== 'Close dialog') await readable(control);
          if (['Active', 'Away', 'Do not disturb'].includes(name))
            expect(
              await control.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
            ).toBeGreaterThanOrEqual(14);
        }
        if (width < 800) {
          for (const input of await profile.getByRole('textbox').all()) {
            expect(
              await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
            ).toBeGreaterThanOrEqual(16);
            await hit(input, page);
          }
          await page.setViewportSize({ width, height: width === 320 ? 360 : 460 });
          await expect
            .poll(() =>
              page
                .locator('.app-shell')
                .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
            )
            .toBe(page.viewportSize()!.height);
          for (const name of ['Display name', 'Status'])
            await hit(profile.getByRole('textbox', { name, exact: true }), page);
          for (const name of ['Active', 'Away', 'Do not disturb', 'Cancel', 'Save', 'Leave demo'])
            await hit(profile.getByRole('button', { name, exact: true }), page);
          await capture(page, profile, info, 'short');
          await hit(profile.getByRole('button', { name: 'Close dialog', exact: true }), page);
        }
      });
    });

for (const width of [1440, 390])
  test.describe(`normal profile capture ${width}px`, () => {
    test.use({
      viewport: { width, height: width === 1440 ? 960 : 844 },
      isMobile: width < 800,
      hasTouch: width < 800,
    });
    test('default identity has readable fields and reachable account actions', async ({
      page,
    }, info) => {
      const profile = await openProfile(page, 'light', false);
      const { user } = createDemoState();
      await expect(profile.getByRole('textbox')).toHaveCount(2);
      await expect(profile.getByText(user.name, { exact: true })).toHaveCount(1);
      await expect(profile.getByText(user.email, { exact: true })).toHaveCount(1);
      for (const name of ['Save', 'Leave demo', 'Close dialog'])
        await hit(profile.getByRole('button', { name, exact: true }), page);
      await profile.evaluate((node) => {
        node.scrollTop = 0;
      });
      await capture(page, profile, info, 'normal-identity', [user.name, user.email]);
      if (width === 1440) {
        await profile.getByRole('button', { name: 'Close dialog', exact: true }).click();
        const folder = evidenceDirectory(info, info.project.name);
        await page
          .getByRole('complementary', { name: 'Chat navigation' })
          .screenshot({ path: resolve(folder, '1440-light-sidebar.png') });
      }
    });
  });
