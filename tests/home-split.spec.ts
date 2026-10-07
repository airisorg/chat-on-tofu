import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// A Google-documented navigation contract, plus our draft/geometry regressions.
// Synthetic local workspace screenshots do not certify Google pixel parity.
async function fixture(page: Page, width = 1440, theme: 'light' | 'dark' = 'light', populated = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  const state = createDemoState();
  if (populated) {
    const first = state.messages.find(m => m.conversationId === 'demo-maya-dm')!;
    state.messages = state.messages.filter(m => m.conversationId !== 'demo-maya-dm');
    for (let index = 0; index < 120; index++) state.messages.push({ ...first, id: `history-${index}`, text: `History message ${index}`, createdAt: new Date(Date.now() - (120 - index) * 60000).toISOString() });
  }
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('relay-theme', 'system');
  }, { key: DEMO_STORAGE_KEY, state });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
const home = (page: Page) => page.locator('.home-view');
const row = (page: Page, name: string) => home(page).locator('.conversation-row').filter({ hasText: name });
const input = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true });

test('Home opens a conversation beside the list, with expand and close', async ({ page }, info) => {
  await fixture(page, 3440);
  const directory = evidenceDirectory(info, info.project.name); mkdirSync(directory, { recursive: true });
  await row(page, 'Maya Chen').click();
  await page.screenshot({ path: resolve(directory, 'home-conversation.png') });
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close conversation preview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand conversation', exact: true })).toBeVisible();
  await expect(input(page)).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`sparse preview geometry and controls — ${theme}`, async ({ page }, info) => {
    await fixture(page, 3440, theme);
    await page.setViewportSize({ width: 3440, height: 1319 });
    await row(page, 'Maya Chen').click();
    const preview = page.getByRole('region', { name: 'Conversation preview', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.locator('article')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(1);
    const geometry = await preview.evaluate(element => {
      const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { pane: rect(element), home: rect(document.querySelector('.home-view')!), history: rect(element.querySelector('.messages-scroll')!), last: rect(element.querySelector('article')!), intro: rect(element.querySelector('.conversation-intro')!), introHeading: rect(element.querySelector('.conversation-intro h1')!), composer: rect(element.querySelector('.composer')!) };
    });
    expect(geometry.home.right).toBeLessThan(geometry.pane.x);
    expect(Math.abs(geometry.home.width - geometry.pane.width)).toBeLessThan(2);
    expect(geometry.last.bottom).toBeGreaterThan(geometry.history.bottom - 35);
    expect(geometry.last.bottom).toBeLessThanOrEqual(geometry.history.bottom);
    expect(geometry.intro.bottom).toBeLessThan(geometry.last.y);
    // Composition contract: the identity group occupies the free preview area.
    // The 60px allowance is for the avatar above and supporting text below,
    // not a measured Google pixel tolerance. A top-aligned intro fails this.
    expect(Math.abs(geometry.introHeading.y + geometry.introHeading.height / 2 - (geometry.intro.y + geometry.intro.height / 2))).toBeLessThan(60);
    expect(geometry.composer.y).toBeGreaterThan(geometry.last.bottom);
    const dir = evidenceDirectory(info, info.project.name); mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `split-3440-${theme}.png`) });
    await preview.screenshot({ path: resolve(dir, `preview-3440-${theme}.png`) });
    await input(page).fill('draft kept across preview navigation');
    await page.getByRole('button', { name: 'Expand conversation', exact: true }).click();
    await expect(home(page)).toHaveCount(0);
    await expect(input(page)).toHaveValue('draft kept across preview navigation');
    await expect(page.getByRole('main').locator('article')).toHaveCount(1);
    await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
    await row(page, 'Maya Chen').click();
    await expect(input(page)).toHaveValue('draft kept across preview navigation');
    await page.getByRole('button', { name: 'Close conversation preview', exact: true }).click();
    await expect(row(page, 'Maya Chen')).toBeFocused();
    await expect(input(page)).toHaveCount(0);
  });
}

test('switch, close, reopen and send keep drafts with the correct conversation', async ({ page }) => {
  await fixture(page);
  await row(page, 'Maya Chen').click();
  await input(page).fill('Only for Maya');
  await row(page, 'Jordan Lee').click();
  await expect(input(page)).toHaveValue('');
  await input(page).fill('Only for Jordan');
  await page.getByRole('button', { name: 'Close conversation preview', exact: true }).click();
  await row(page, 'Maya Chen').click();
  await expect(input(page)).toHaveValue('Only for Maya');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(input(page)).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Conversation preview', exact: true }).getByText('Only for Maya', { exact: true })).toHaveCount(1);
  await row(page, 'Jordan Lee').click();
  await expect(input(page)).toHaveValue('Only for Jordan');
  await expect(page.getByRole('region', { name: 'Conversation preview', exact: true }).getByText('Only for Maya', { exact: true })).toHaveCount(0);
  await row(page, 'Maya Chen').click();
  await expect(input(page)).toHaveValue('');
});

test('resize keeps one composer, draft, attachments and full phone navigation', async ({ page }) => {
  await fixture(page);
  await row(page, 'Maya Chen').click();
  await input(page).fill('A draft across viewports\nSecond line');
  await page.locator('input[type=file]').setInputFiles({ name: 'resize.txt', mimeType: 'text/plain', buffer: Buffer.from('small file') });
  await expect(page.getByRole('button', { name: 'Remove resize.txt' })).toBeVisible();
  const textarea = await input(page).elementHandle();
  for (const size of [{ width: 1199, height: 900 }, { width: 1200, height: 501 }, { width: 1200, height: 500 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    const split = size.width >= 1200 && size.height >= 501;
    await expect(page.getByRole('button', { name: 'Close conversation preview', exact: true })).toHaveCount(split ? 1 : 0);
    await expect(input(page)).toHaveCount(1);
    await expect(input(page)).toHaveValue('A draft across viewports\nSecond line');
    await expect(page.getByRole('button', { name: 'Remove resize.txt' })).toBeVisible();
    expect(await textarea!.evaluate(el => el.isConnected)).toBe(true);
    const button = page.getByRole('button', { name: 'Send message', exact: true });
    const box = await button.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await row(page, 'Maya Chen').click();
  await expect(home(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue('A draft across viewports\nSecond line');
});

test('split preference survives reload and sidebar opens the full conversation', async ({ page }) => {
  await fixture(page);
  const options = page.getByRole('button', { name: 'Home view options', exact: true });
  const split = page.getByRole('menuitemradio', { name: 'Split pane', exact: true });
  const single = page.getByRole('menuitemradio', { name: 'Single pane', exact: true });
  await options.click();
  await expect(split).toHaveAttribute('aria-checked', 'true');
  await expect(single).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await row(page, 'Maya Chen').click();
  await input(page).fill('Keep when disabling preview');
  await options.click(); await single.click();
  await expect(input(page)).toHaveCount(0);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
  await options.click(); await expect(split).toHaveAttribute('aria-checked', 'false');
  await expect(single).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await row(page, 'Maya Chen').click();
  await expect(home(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue('Keep when disabling preview');
  await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click();
  await options.click(); await split.click();
  await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'Maya Chen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close conversation preview' })).toHaveCount(0);
  await expect(input(page)).toHaveValue('Keep when disabling preview');
});

test('space preview opens a thread and returns without duplicating or losing the draft', async ({ page }) => {
  await fixture(page);
  await row(page, 'Design team').click();
  await input(page).fill('space draft');
  const first = page.getByRole('region', { name: 'Conversation preview', exact: true }).locator('article').first();
  await first.hover(); await first.getByRole('button', { name: 'Reply in thread', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close thread' })).toBeVisible();
  await expect(home(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue('space draft');
  await page.getByRole('textbox', { name: 'Reply in thread' }).fill('thread draft');
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(home(page)).toBeVisible();
  await expect(input(page)).toHaveValue('space draft');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(1);
  await first.hover(); await first.getByRole('button', { name: 'Reply in thread', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Reply in thread' })).toHaveValue('thread draft');
});

test('populated preview scrolls and preserves older-reading position during draft edits', async ({ page }) => {
  await fixture(page, 1440, 'light', true);
  await row(page, 'Maya Chen').click();
  const pane = page.getByRole('region', { name: 'Conversation preview', exact: true });
  await expect(pane.locator('article')).toHaveCount(120);
  const scroller = pane.locator('.messages-scroll');
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight / 3; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const readingAnchor = () => page.locator('.messages-scroll').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll('article')].find(row => row.getBoundingClientRect().bottom > top)!;
    return { id: row.id, offset: row.getBoundingClientRect().top - top };
  });
  const before = await readingAnchor();
  await input(page).fill('While reading older messages');
  const afterTyping = await readingAnchor();
  expect(afterTyping.id).toBe(before.id);
  expect(Math.abs(afterTyping.offset - before.offset)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Expand conversation', exact: true }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByRole('main').locator('article')).toHaveCount(120);
  await expect(input(page)).toHaveValue('While reading older messages');
  const afterExpand = await readingAnchor();
  expect(afterExpand.id).toBe(before.id);
  expect(Math.abs(afterExpand.offset - before.offset)).toBeLessThanOrEqual(2);
});
