import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// Component goldens guard this app, not Google pixel parity. Geometry and actual
// pointer hits are independent of the screenshots and must pass before updating.
const sizes = [
  { width: 1024, height: 960 }, { width: 1440, height: 960 },
  { width: 3440, height: 960 }, { width: 390, height: 844 },
  { width: 320, height: 568 }, { width: 1024, height: 360 },
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
      home: box(node), header: { ...box(header), clientWidth: header.clientWidth, scrollWidth: header.scrollWidth },
      tabs: { ...box(tabs), clientWidth: tabs.clientWidth, scrollWidth: tabs.scrollWidth },
      controls: [...node.querySelectorAll('.home-header button,.home-filter-tabs > button')].map(e => ({
        name: e.getAttribute('aria-label') || e.textContent?.trim(), ...box(e),
      })),
    };
  });
  const folder = evidenceDirectory(info, info.project.name); mkdirSync(folder, { recursive: true });
  const prefix = `${page.viewportSize()!.width}x${page.viewportSize()!.height}-${await page.locator('html').getAttribute('data-theme')}-${phase}`;
  writeFileSync(resolve(folder, prefix + '.json'), JSON.stringify(metrics, null, 2) + '\n');
  const clip = { x: metrics.home.x, y: metrics.header.y, width: metrics.home.width, height: Math.max(metrics.header.bottom, metrics.tabs.bottom) - metrics.header.y };
  await page.screenshot({ path: resolve(folder, prefix + '.png'), clip });

  expect(metrics.header.scrollWidth, 'header contents fit their allocated column').toBeLessThanOrEqual(metrics.header.clientWidth + 1);
  expect(metrics.header.x).toBeGreaterThanOrEqual(metrics.home.x);
  expect(metrics.header.right).toBeLessThanOrEqual(metrics.home.right + 1);
  const controls = [header.getByRole('heading', { name: 'Home', exact: true }), unread, ...(splitExpected ? [split] : []), all];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(overlapX * overlapY, `toolbar controls ${i}/${j} cannot intersect`).toBe(0);
  }
  if (page.viewportSize()!.width >= 800) {
    const lastHeader = boxes[splitExpected ? 2 : 1]!, firstTab = boxes.at(-1)!;
    expect(firstTab.x - lastHeader.x - lastHeader.width, 'header and All retain at least one8px control gap').toBeGreaterThanOrEqual(8);
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

for (const size of sizes) for (const theme of ['light', 'dark'] as const) test.describe(`Home toolbar ${size.width}x${size.height} ${theme}`, () => {
  const touch = size.width < 800;
  const splitExpected = size.width >= 1200 && size.height > 500;
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
    const pinned = tabs.getByRole('button', { name: 'Pinned', exact: true });
    if (!touch) {
      await hit(pinned, page, false); await pinned.click();
      await expect(home.locator('.conversation-row')).toHaveCount(1);
      await expect(home.locator('.conversation-row')).toContainText('Design team');
      await pinned.click(); await expect(home.locator('.conversation-row')).toHaveCount(5);
    }
    const threads = tabs.getByRole('checkbox', { name: 'Threads', exact: true });
    await hit(threads, page, touch); await threads.click();
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
    }
  });
});
