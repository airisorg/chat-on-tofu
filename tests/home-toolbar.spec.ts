import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// Component goldens guard this app, not Google pixel parity. Geometry and actual
// pointer hits are independent of the screenshots and must pass before updating.
const sizes: { width: number; height: number; touch?: boolean }[] = [
  { width: 1024, height: 960 }, { width: 1440, height: 960 },
  { width: 3440, height: 960 }, { width: 390, height: 844 },
  { width: 320, height: 568 }, { width: 1024, height: 360 },
  { width: 1440, height: 960, touch: true },
];

async function start(page: Page, theme: 'light' | 'dark', width: number) {
  const state = createDemoState();
  await page.clock.install({ time: new Date('2026-10-05T12:00:00Z') });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('relay-theme', 'system');
  }, { key: DEMO_STORAGE_KEY, state });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const navigation = width < 800
    ? page.getByRole('navigation', { name: 'Main navigation', exact: true })
    : page.getByRole('complementary', { name: 'Chat navigation' });
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-view')).toHaveCount(1);
  await expect(page.locator('.home-view').getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('.home-view .conversation-row')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
}

async function toolbarGeometry(page: Page, info: TestInfo, phase: string, splitExpected: boolean) {
  const home = page.locator('.home-view');
  const header = home.locator('.home-header');
  const tabs = home.locator('.home-filter-tabs');
  await expect(header).toHaveCount(1); await expect(tabs).toHaveCount(1);
  await tabs.evaluate(node => { node.scrollLeft = 0; });
  const unread = header.getByRole('button', { name: 'Unread', exact: true });
  const all = tabs.getByRole('button', { name: 'All', exact: true });
  const split = header.getByRole('button', { name: 'Split pane mode', exact: true });
  await expect(unread).toHaveCount(1); await expect(all).toHaveCount(1);
  await expect(split).toHaveCount(splitExpected ? 1 : 0);
  const metrics = await home.evaluate(node => {
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const header = node.querySelector('.home-header')!;
    const tabs = node.querySelector('.home-filter-tabs')!;
    return {
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      home: box(node), header: { ...box(header), clientWidth: header.clientWidth, scrollWidth: header.scrollWidth },
      tabs: { ...box(tabs), clientWidth: tabs.clientWidth, scrollWidth: tabs.scrollWidth },
      controls: [...node.querySelectorAll('.home-header button,.home-filter-tabs > button')].map(e => {
        const s = getComputedStyle(e);
        return { name: e.getAttribute('aria-label') || e.textContent?.trim(), ...box(e),
          label: e.textContent?.trim(), fontSize: s.fontSize, lineHeight: s.lineHeight,
          fontFamily: s.fontFamily, fontWeight: s.fontWeight,
          paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
          icons: [...e.querySelectorAll('svg')].map(box),
        };
      }),
    };
  });
  const folder = evidenceDirectory(info, info.project.name); mkdirSync(folder, { recursive: true });
  const pointer = metrics.coarsePointer && page.viewportSize()!.width >= 800 ? '-coarse' : '';
  const prefix = `${page.viewportSize()!.width}x${page.viewportSize()!.height}${pointer}-${await page.locator('html').getAttribute('data-theme')}-${phase}`;
  writeFileSync(resolve(folder, prefix + '.json'), JSON.stringify(metrics, null, 2) + '\n');
  const clip = { x: metrics.home.x, y: metrics.header.y, width: metrics.home.width, height: Math.max(metrics.header.bottom, metrics.tabs.bottom) - metrics.header.y };
  await page.screenshot({ path: resolve(folder, prefix + '.png'), clip });

  expect(metrics.header.scrollWidth, 'header contents fit their allocated column').toBeLessThanOrEqual(metrics.header.clientWidth + 1);
  expect(metrics.header.x).toBeGreaterThanOrEqual(metrics.home.x);
  expect(metrics.header.right).toBeLessThanOrEqual(metrics.home.right + 1);
  // A stable golden alone previously accepted 9–11px labels inside 34–44px chips.
  // Keep the chosen readable type scale across breakpoints, including controls
  // reached by horizontal scrolling. This is an app contract, not a Google pixel oracle.
  for (const control of metrics.controls.filter(control => control.label && control.width > 0)) {
    expect(control.fontSize, `${control.name} keeps readable text at every viewport`).toBe('14px');
    expect(control.lineHeight).toBe('20px');
    expect(control.fontWeight).toBe('500');
    expect(control.fontFamily).toContain('Google Sans');
    expect(control.paddingTop).toBe(control.paddingBottom);
    expect(control.height, `${control.name} stays on one line`).toBe(metrics.coarsePointer || page.viewportSize()!.width < 800 ? 44 : 32);
    for (const icon of control.icons) {
      expect(icon.width).toBe(18); expect(icon.height).toBe(18);
      expect(Math.abs(icon.y + icon.height / 2 - control.y - control.height / 2)).toBeLessThanOrEqual(0.5);
    }
  }
  const controls = [header.getByRole('heading', { name: 'Home', exact: true }), unread, ...(splitExpected ? [split] : []), all];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(overlapX * overlapY, `toolbar controls ${i}/${j} cannot intersect`).toBe(0);
  }
  if (page.viewportSize()!.width >= 800 && !metrics.coarsePointer) {
    const lastHeader = boxes[splitExpected ? 2 : 1]!, firstTab = boxes.at(-1)!;
    expect(firstTab.x - lastHeader.x - lastHeader.width, 'header and All retain at least one 8px control gap').toBeGreaterThanOrEqual(8);
  }
  await expect(page).toHaveScreenshot(`home-toolbar-${prefix}.png`, { clip });
}

async function hit(control: Locator, page: Page, touch: boolean) {
  await control.scrollIntoViewIfNeeded();
  const result = await control.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      hits: [3, r.width / 2, r.width - 3].map(x => node.contains(document.elementFromPoint(r.x + x, r.y + r.height / 2))) };
  });
  expect(result.x).toBeGreaterThanOrEqual(0); expect(result.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(result.y).toBeGreaterThanOrEqual(0); expect(result.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(result.hits).toEqual([true, true, true]);
  if (touch) { expect(result.width).toBeGreaterThanOrEqual(44); expect(result.height).toBeGreaterThanOrEqual(44); }
}

for (const size of sizes) for (const theme of ['light', 'dark'] as const) test.describe(`Home toolbar ${size.width}x${size.height}${size.touch ? ' coarse' : ''} ${theme}`, () => {
  const touch = size.touch || size.width < 800;
  const splitExpected = size.width >= 1200 && size.height > 500 && !touch;
  test.use({ viewport: size, hasTouch: touch, isMobile: touch });
  test('controls stay separate, reachable and functional', async ({ page }, info) => {
    await start(page, theme, size.width);
    const home = page.locator('.home-view');
    const header = home.locator('.home-header');
    const tabs = home.locator('.home-filter-tabs');
    await toolbarGeometry(page, info, 'initial', splitExpected);
    const unread = header.getByRole('button', { name: 'Unread', exact: true });
    await hit(unread, page, touch); await unread.click();
    await expect(unread).toHaveAttribute('aria-pressed', 'true');
    await expect(home.locator('.conversation-row')).toHaveCount(2);
    await toolbarGeometry(page, info, 'unread', splitExpected);
    await unread.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
    for (const name of ['All', 'Direct messages', 'Spaces']) {
      const button = tabs.getByRole('button', { name, exact: true });
      await expect(button).toHaveCount(1); await hit(button, page, touch);
    }
    // Keyboard navigation must reveal offscreen controls and retain a full ring.
    const direct = tabs.getByRole('button', { name: 'Direct messages', exact: true });
    await tabs.getByRole('button', { name: 'All', exact: true }).press(info.project.name === 'WebKit' ? 'Alt+Tab' : 'Tab');
    await expect(direct).toBeFocused();
    await hit(direct, page, touch);
    const focus = await direct.evaluate(node => {
      const s = getComputedStyle(node);
      return { visible: node.matches(':focus-visible'), width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), style: s.outlineStyle };
    });
    expect(focus.visible).toBe(true); expect(focus.style).toBe('solid');
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.width + focus.offset, 'focus paint stays within the scrollport').toBeLessThanOrEqual(0);
    await expect(tabs).toHaveScreenshot(`home-filters-focus-${size.width}x${size.height}${size.touch ? '-coarse' : ''}-${theme}.png`);
    if (size.width < 800) {
      const readAll = tabs.getByRole('button', { name: 'Mark all conversations read', exact: true });
      const before = (await readAll.boundingBox())!;
      const scrollport = (await tabs.boundingBox())!;
      expect(before.x + before.width, 'last control starts outside the phone scrollport').toBeGreaterThan(scrollport.x + scrollport.width);
      let current = direct;
      for (const next of [tabs.getByRole('button', { name: 'Spaces', exact: true }), tabs.getByRole('checkbox', { name: 'Threads', exact: true }), readAll]) {
        await current.press(info.project.name === 'WebKit' ? 'Alt+Tab' : 'Tab');
        await expect(next).toBeFocused();
        current = next;
      }
      // No scrollIntoView helper here: native Tab must reveal the entire target.
      const after = (await readAll.boundingBox())!;
      expect(after.x).toBeGreaterThanOrEqual(scrollport.x);
      expect(after.x + after.width).toBeLessThanOrEqual(scrollport.x + scrollport.width + 1);
    }
    const pinned = tabs.getByRole('button', { name: 'Pinned', exact: true });
    if (!touch) {
      await hit(pinned, page, false); await pinned.click();
      await expect(home.locator('.conversation-row')).toHaveCount(1);
      await expect(home.locator('.conversation-row')).toContainText('Design team');
      await pinned.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
    }
    const threads = tabs.getByRole('checkbox', { name: 'Threads', exact: true });
    await hit(threads, page, touch);
    if (size.width < 800) {
      await expect(tabs).toHaveScreenshot(`home-filters-scrolled-${size.width}-${theme}.png`);
    }
    await threads.click();
    await expect(threads).toHaveAttribute('aria-checked', 'true');
    await expect(home.getByRole('heading', { name: 'No threads yet', exact: true })).toBeVisible();
    await threads.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
    const read = tabs.getByRole('button', { name: 'Mark all conversations read', exact: true });
    await hit(read, page, touch); await read.click();
    await unread.click(); await expect(home.locator('.conversation-row')).toHaveCount(0);
    await unread.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
    if (splitExpected) {
      const split = header.getByRole('button', { name: 'Split pane mode', exact: true });
      await hit(split, page, false); await split.click(); await expect(split).toHaveAttribute('aria-pressed', 'false');
      await split.click(); await expect(split).toHaveAttribute('aria-pressed', 'true');
      await home.locator('.conversation-row').filter({ hasText: 'Design team' }).click();
      await expect(page.getByRole('region', { name: 'Conversation preview', exact: true })).toHaveCount(1);
      await toolbarGeometry(page, info, 'preview', true);
      await hit(header.getByRole('button', { name: 'Split pane mode', exact: true }), page, false);
      for (const name of ['All', 'Direct messages', 'Spaces', 'Pinned']) {
        await hit(tabs.getByRole('button', { name, exact: true }), page, false);
      }
      await hit(read, page, false);
      await hit(threads, page, false); await threads.click();
      await expect(home.getByRole('heading', { name: 'No threads yet', exact: true })).toBeVisible();
      await threads.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
      await direct.click();
      await expect(page.locator('.home-header').getByRole('heading', { name: 'Direct messages', exact: true })).toBeVisible();
    }
  });
});
