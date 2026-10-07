import { expect, test, type Page, type Locator, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// App consistency and supported navigation checks. The 24px inset adapts measured
// Google Home spacing, not an observed Google Space-header pixel oracle.
async function fixture(page: Page, theme: 'light' | 'dark') {
  const state = createDemoState();
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('relay-theme', 'system');
  }, { key: DEMO_STORAGE_KEY, state });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
}
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const full = (page: Page) => page.getByRole('region', { name: 'Conversation', exact: true });
const preview = (page: Page) => page.getByRole('region', { name: 'Conversation preview', exact: true });

async function hit(control: Locator) {
  await expect(control).toHaveCount(1);
  const result = await control.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), width: r.width, height: r.height, x: r.x, right: r.right };
  });
  expect(result.hit).toBe(true);
  return result;
}
async function headings(page: Page) {
  const result = [];
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    const button = sidebar(page).getByRole('button', { name, exact: true });
    await expect(button).toHaveCount(1);
    result.push(await button.evaluate(node => {
      const s = getComputedStyle(node);
      return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, height: s.lineHeight, color: s.color };
    }));
  }
  return result;
}
async function headingGeometry(page: Page) {
  const result = [];
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    result.push(await sidebar(page).getByRole('button', { name, exact: true }).evaluate(node => {
      const icon = node.querySelector('svg')!.getBoundingClientRect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode()) && !text.textContent?.trim()) { /* Skip formatting whitespace. */ }
      if (!text) throw new Error('Disclosure label is missing');
      const range = document.createRange(); range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      return { iconX: icon.x, iconWidth: icon.width, labelX: label.x, gap: label.x - icon.right };
    }));
  }
  return result;
}
async function capture(page: Page, info: TestInfo, kind: string, region: Locator) {
  const folder = evidenceDirectory(info, info.project.name); mkdirSync(folder, { recursive: true });
  const prefix = `${page.viewportSize()!.width}-${await page.locator('html').getAttribute('data-theme')}-${kind}`;
  const header = await region.locator('header').first().evaluate(node => {
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
    const s = getComputedStyle(node);
    return { ...box(node), paddingLeft: s.paddingLeft, paddingRight: s.paddingRight,
      avatar: box(node.querySelector('.avatar,.space-avatar')!),
      title: [...node.querySelectorAll('button')].map(e => ({ text: e.textContent, ...box(e) })) };
  });
  writeFileSync(resolve(folder, prefix + '.json'), JSON.stringify({ header, headings: await headings(page), headingGeometry: await headingGeometry(page) }, null, 2) + '\n');
  await page.screenshot({ path: resolve(folder, prefix + '.png') });
}

for (const width of [1024, 1440, 3440]) for (const theme of ['light', 'dark'] as const) test.describe(`header/sidebar ${width}px ${theme}`, () => {
  test.use({ viewport: { width, height: 960 } });
  test('full and preview kinds retain their controls with coherent geometry', async ({ page }, info) => {
    await fixture(page, theme);
    await sidebar(page).getByRole('button', { name: 'Design team', exact: true }).click();
    await expect(full(page)).toHaveCount(1);
    await expect(full(page).locator('header > .space-avatar')).toHaveCount(1);
    await capture(page, info, 'full-space', full(page));
    if (width >= 1200) {
      await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
      await page.locator('.home-view .conversation-row').filter({ hasText: 'Design team' }).click();
      await expect(preview(page)).toHaveCount(1);
      await expect(preview(page).locator('header > .space-avatar')).toHaveCount(1);
      await capture(page, info, 'preview-space', preview(page));
      const avatar = (await preview(page).locator('header > .space-avatar').boundingBox())!;
      expect(avatar.width, 'space preview avatar matches compact DM24px').toBe(24);
      expect(avatar.height).toBe(24);
      await hit(preview(page).getByRole('button', { name: 'Expand conversation', exact: true }));
      await preview(page).getByRole('button', { name: 'Expand conversation', exact: true }).click();
    }
    const values = await headings(page);
    for (const value of values) expect(value).toEqual(values[0]);
    expect(values[0].family).toContain('Google Sans');
    expect(values[0].size).toBe('12px'); expect(values[0].weight).toBe('500'); expect(values[0].height).toBe('24px');
    const origins = await headingGeometry(page);
    for (const origin of origins) {
      expect(origin.iconWidth).toBe(17);
      expect(origin.gap).toBe(8);
      expect(Math.abs(origin.iconX - origins[0].iconX)).toBeLessThanOrEqual(1);
      expect(Math.abs(origin.labelX - origins[0].labelX)).toBeLessThanOrEqual(1);
    }
    for (const name of ['Design team', 'Weekend plans', 'Maya Chen']) {
      await sidebar(page).getByRole('button', { name, exact: true }).click();
      await expect(full(page)).toHaveCount(1);
      await expect(preview(page)).toHaveCount(0);
      const header = full(page).locator('.conversation-header');
      await expect(header).toHaveCSS('padding-left', '24px'); await expect(header).toHaveCSS('padding-right', '24px');
      const avatar = (await header.locator(':scope > .avatar,:scope > .space-avatar').boundingBox())!;
      expect(avatar.width).toBe(40); expect(avatar.height).toBe(40);
      await expect(full(page).locator('.conversation-tabs > .current')).toHaveText('Chat');
      await expect(full(page).getByRole('button', { name: /^Shared/ })).toHaveCount(1);
      await expect(header.locator('.conversation-title small')).not.toHaveText('');
      await hit(header.getByRole('button', { name: 'Conversation details', exact: true }));
      await capture(page, info, 'full-' + name.replaceAll(' ', '-'), full(page));
    }
    for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
      const disclosure = sidebar(page).getByRole('button', { name, exact: true });
      await hit(disclosure); await disclosure.click(); await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.click(); await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    }
  });
});

test.describe('coarse desktop headings', () => {
  test.use({ viewport: { width: 1440, height: 960 }, hasTouch: true, isMobile: true });
  test('all disclosure controls preserve44px touch targets', async ({ page }) => {
    await fixture(page, 'dark');
    for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
      const control = sidebar(page).getByRole('button', { name, exact: true });
      const bounds = await hit(control); expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await sidebar(page).getByRole('button', { name: 'Design team', exact: true }).click();
    await expect(full(page)).toHaveCount(1); await expect(preview(page)).toHaveCount(0);
    const bounds = await hit(full(page).getByRole('button', { name: 'Conversation details', exact: true }));
    expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
  });
});
