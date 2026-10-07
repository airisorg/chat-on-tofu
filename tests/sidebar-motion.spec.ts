import { expect, test, type Locator, type Page, type TestInfo } from './coverage-test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// App-owned paint/motion contracts. The supplied still Google screenshot proves
// group + hovered row + selected row coexistence, not timing or dark/focus parity.
async function fixture(
  page: Page,
  theme: 'light' | 'dark',
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
) {
  const state = createDemoState();
  await page.emulateMedia({ colorScheme: theme, reducedMotion });
  await page.addInitScript(
    ({ state, key }) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('relay-theme', 'system');
    },
    { state, key: DEMO_STORAGE_KEY },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1200, 800);
  await expect
    .poll(async () => {
      const p = await paint(nav(page));
      return p.content === 'none' || p.opacity === 0;
    })
    .toBe(true);
  // Home was just selected. Wait for that real paint transition to settle
  // before using its selected color as the invariant for a different hover.
  await expect
    .poll(() =>
      nav(page).evaluate(
        (node) =>
          node.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0);
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const nav = (page: Page) => sidebar(page).locator('nav');
const row = (page: Page, name: string) => sidebar(page).getByRole('button', { name, exact: true });

async function paint(element: Locator) {
  return element.evaluate((node) => {
    const s = getComputedStyle(node, '::before');
    return {
      opacity: Number(s.opacity),
      color: s.backgroundColor,
      display: s.display,
      content: s.content,
      radius: s.borderRadius,
      transitionDuration: s.transitionDuration,
    };
  });
}
async function background(element: Locator) {
  return element.evaluate((node) => getComputedStyle(node).backgroundColor);
}
async function geometry(page: Page) {
  return sidebar(page).evaluate((node) => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      scrollTop: node.scrollTop,
      scrollWidth: node.scrollWidth,
      width: node.clientWidth,
      controls: [...node.querySelectorAll('button')]
        .filter((e) => e.getClientRects().length)
        .map((e) => ({
          name: e.getAttribute('aria-label') || e.textContent?.trim(),
          box: box(e),
          children: [...e.children].map(box),
        })),
    };
  });
}
async function hit(element: Locator) {
  await expect(element).toHaveCount(1);
  expect(
    await element.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
}

async function actualFade(group: Locator) {
  // Seek a real browser-created CSS transition, not a fake animation/style.
  // Sampling currentTime avoids flaky wall-clock midpoint capture under CI load.
  return group.evaluate((node) => {
    const animation = node
      .getAnimations({ subtree: true })
      .find(
        (a) =>
          a instanceof CSSTransition &&
          a.transitionProperty === 'opacity' &&
          a.effect instanceof KeyframeEffect &&
          a.effect.target === node,
      );
    if (!animation || !(animation.effect instanceof KeyframeEffect))
      throw new Error('The group did not create a real opacity CSS transition');
    const duration = Number(animation.effect.getComputedTiming().duration);
    const easings = [
      animation.effect.getTiming().easing,
      ...animation.effect.getKeyframes().map((frame) => frame.easing),
    ];
    animation.pause();
    const sample = (time: number) => {
      animation.currentTime = time;
      return { time, opacity: Number(getComputedStyle(node, '::before').opacity) };
    };
    const phases = [sample(0), sample(duration / 2), sample(duration)];
    animation.finish();
    return { duration, easings, phases };
  });
}

async function capture(page: Page, info: TestInfo, name: string, metrics: unknown) {
  const folder = evidenceDirectory(info, info.project.name);
  mkdirSync(folder, { recursive: true });
  const box = (await nav(page).boundingBox())!;
  const clip = { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 };
  writeFileSync(resolve(folder, name + '.json'), JSON.stringify(metrics, null, 2) + '\n');
  await page.screenshot({ path: resolve(folder, name + '.png'), clip });
  await expect(page).toHaveScreenshot(name + '.png', { clip, animations: 'disabled' });
}

for (const theme of ['light', 'dark'] as const)
  test.describe(`sidebar states ${theme}`, () => {
    test('real group fade preserves selected Home and geometry while another row is hovered', async ({
      page,
    }, info) => {
      await fixture(page, theme);
      const before = await geometry(page);
      const home = row(page, 'Home');
      const starred = row(page, 'Starred');
      const selected = await background(home);
      await starred.hover();
      const entry = await actualFade(nav(page));
      expect(entry.duration).toBe(150);
      expect(entry.easings).toContain('cubic-bezier(0.2, 0, 0, 1)');
      expect(entry.phases[0].opacity).toBe(0);
      expect(entry.phases[1].opacity).toBeGreaterThan(0);
      expect(entry.phases[1].opacity).toBeLessThan(1);
      expect(entry.phases[2].opacity).toBe(1);
      await expect.poll(() => paint(nav(page))).toMatchObject({ opacity: 1, radius: '16px' });
      await expect.poll(() => background(starred)).not.toBe((await paint(nav(page))).color);
      expect(await background(home)).toBe(selected);
      await expect(home).toHaveClass(/selected/);
      await expect(starred).not.toHaveClass(/selected/);
      await expect(
        page.getByRole('main').getByRole('heading', { name: 'Home', exact: true }),
      ).toBeVisible();
      expect(await geometry(page)).toEqual(before);
      await hit(starred);
      await hit(home);
      await capture(page, info, `shortcuts-${theme}-selected-hover`, {
        before,
        after: await geometry(page),
        entry,
        paint: await paint(nav(page)),
        selected,
        hovered: await background(starred),
      });
      await page.mouse.move(1200, 800);
      const exit = await actualFade(nav(page));
      expect(exit.phases[0].opacity).toBe(1);
      expect(exit.phases[1].opacity).toBeGreaterThan(0);
      expect(exit.phases[1].opacity).toBeLessThan(1);
      expect(exit.phases[2].opacity).toBe(0);
      expect(await geometry(page)).toEqual(before);
      expect(await background(home)).toBe(selected);

      // A conversation group uses the same independent group/row paint layers.
      const direct = sidebar(page)
        .locator('.sidebar-group')
        .filter({ has: page.getByRole('button', { name: 'Direct messages', exact: true }) });
      const peer = row(page, 'Maya Chen');
      await peer.hover();
      const peerEntry = await actualFade(direct);
      expect(peerEntry.phases[2].opacity).toBe(1);
      await expect.poll(() => background(peer)).not.toBe((await paint(direct)).color);
      expect(await geometry(page)).toEqual(before);
      await hit(peer);
    });

    test('pointer focus cannot latch group paint; keyboard and press states preserve selection and hit targets', async ({
      page,
    }, info) => {
      await fixture(page, theme);
      const home = row(page, 'Home');
      const starred = row(page, 'Starred');
      const before = await geometry(page);
      const selected = await background(home);
      await home.hover();
      await expect.poll(() => paint(nav(page))).toMatchObject({ opacity: 1 });
      await page.mouse.down();
      expect(await background(home)).toBe(selected);
      expect(await geometry(page)).toEqual(before);
      await page.mouse.up();
      await page.mouse.move(1200, 800);
      await expect(home).toBeFocused();
      expect(await home.evaluate((node) => node.matches(':focus-visible'))).toBe(false);
      await expect.poll(() => paint(nav(page))).toMatchObject({ opacity: 0 });

      // Establish keyboard modality via real traversal (macOS WebKit Alt+Tab).
      await row(page, 'Mentions').focus();
      await page.keyboard.press(info.project.name === 'WebKit' ? 'Alt+Tab' : 'Tab');
      await expect(starred).toBeFocused();
      expect(await starred.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
      await expect.poll(() => paint(nav(page))).toMatchObject({ opacity: 1 });
      const focus = await starred.evaluate((node) => {
        const s = getComputedStyle(node);
        return {
          width: parseFloat(s.outlineWidth),
          offset: parseFloat(s.outlineOffset),
          style: s.outlineStyle,
        };
      });
      expect(focus).toEqual({ width: 2, offset: -2, style: 'solid' });
      expect(await background(home)).toBe(selected);
      expect(await geometry(page)).toEqual(before);
      await hit(starred);
      await capture(page, info, `shortcuts-${theme}-keyboard`, {
        before,
        focus,
        group: await paint(nav(page)),
      });
      await page.keyboard.press('Enter');
      await expect(starred).toHaveClass(/selected/);
      await expect(
        page.getByRole('main').getByRole('heading', { name: 'Starred', exact: true }),
      ).toBeVisible();
      await row(page, 'Shortcuts').click();
      await expect(row(page, 'Shortcuts')).toHaveAttribute('aria-expanded', 'false');
      await expect(nav(page).getByRole('button', { name: 'Home', exact: true })).toHaveCount(0);
      await row(page, 'Shortcuts').click();
      await expect(row(page, 'Shortcuts')).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: 'Main menu', exact: true }).click();
      await starred.hover();
      expect((await paint(nav(page))).display).toBe('none');
      await expect(starred).toHaveClass(/selected/);
      await hit(starred);
    });

    test('reduced motion applies state immediately without active group or row transitions', async ({
      page,
    }, info) => {
      await fixture(page, theme, 'reduce');
      const before = await geometry(page);
      const selected = await background(row(page, 'Home'));
      await row(page, 'Starred').hover();
      expect(await paint(nav(page))).toMatchObject({ opacity: 1, transitionDuration: '0s' });
      expect(
        await row(page, 'Starred').evaluate((node) => ({
          duration: getComputedStyle(node).transitionDuration,
          animations: node.getAnimations().length,
        })),
      ).toEqual({ duration: '0s', animations: 0 });
      expect(await nav(page).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(
        0,
      );
      expect(await geometry(page)).toEqual(before);
      expect(await background(row(page, 'Home'))).toBe(selected);
      await page.mouse.move(1200, 800);
      expect((await paint(nav(page))).opacity).toBe(0);
      await capture(page, info, `shortcuts-${theme}-reduced-motion-out`, {
        before,
        paint: await paint(nav(page)),
      });
    });
  });

test.describe('coarse pointer sidebar', () => {
  test.use({ viewport: { width: 1440, height: 960 }, isMobile: true, hasTouch: true });
  for (const theme of ['light', 'dark'] as const)
    test(`no hover-only group layer or loss of touch targets ${theme}`, async ({ page }) => {
      await fixture(page, theme);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      for (const name of [
        'Home',
        'Mentions',
        'Starred',
        'Shortcuts',
        'Direct messages',
        'Maya Chen',
      ]) {
        const control = row(page, name);
        await expect(control).toHaveCount(1);
        const b = (await control.boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
        await hit(control);
      }
      await row(page, 'Starred').hover();
      expect((await paint(nav(page))).content).toBe('none');
      expect(
        await nav(page).evaluate(
          (node) =>
            node
              .getAnimations({ subtree: true })
              .filter((a) => a instanceof CSSTransition && a.transitionProperty === 'opacity')
              .length,
        ),
      ).toBe(0);
      await row(page, 'Starred').click();
      await expect(row(page, 'Starred')).toHaveClass(/selected/);
      await expect(
        page.getByRole('main').getByRole('heading', { name: 'Starred', exact: true }),
      ).toBeVisible();
    });
});
