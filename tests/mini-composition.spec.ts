import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { evidenceDirectory } from './browser-config';

// Local synthetic composition only; no hosted identity, OS keyboard, database
// or Google reference parity is established by these tests.
async function demo(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if (!await page.getByRole('main').getByRole('heading', { name: 'Design team', exact: true }).isVisible())
    await page.getByRole('main').getByRole('button', { name: /Design team/ }).first().click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
}
const mini = (page: Page) => page.getByRole('region', { name: 'Mini conversation: Design team', exact: true });
async function openMini(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
  await expect(mini(page)).toBeVisible();
}
async function geometry(locator: Locator) {
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hit: !!hit && element.contains(hit) };
  });
}
async function capture(page: Page, info: TestInfo, name: string, details: unknown) {
  const dir = evidenceDirectory(info, info.project.name); mkdirSync(dir, { recursive: true });
  // Page capture never invokes locator.scrollIntoView and cannot mask clipping.
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
  writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(details, null, 2));
}
async function toneChoices(page: Page, picker: Locator, info: TestInfo, name: string) {
  await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
  const menu = picker.getByRole('menu', { name: 'Skin tones', exact: true });
  const box = await geometry(picker), tones = await geometry(menu);
  await capture(page, info, name, { picker: box, tones });
  expect(tones.y).toBeGreaterThanOrEqual(box.y);
  expect(tones.bottom).toBeLessThanOrEqual(box.bottom);
  const buttons = menu.getByRole('menuitemradio');
  await expect(buttons).toHaveCount(6);
  for (let index = 0; index < 6; index++) {
    const button = buttons.nth(index);
    // Deliberate menu scrolling is a reachable interaction; never scroll the
    // picker/panel ancestor to make a clipped control appear to fit.
    await button.evaluate(element => {
      const menu = element.parentElement!;
      menu.scrollTop += element.getBoundingClientRect().top - menu.getBoundingClientRect().top - menu.clientTop;
    });
    const target = await geometry(button), visibleMenu = await geometry(menu);
    expect(target.y).toBeGreaterThanOrEqual(visibleMenu.y);
    expect(target.bottom).toBeLessThanOrEqual(visibleMenu.bottom);
    expect(target.hit).toBe(true);
    if (index === 5) await capture(page, info, `${name}-last-choice`, { picker: await geometry(picker), tones: visibleMenu, lastChoice: target });
    await button.click();
    await expect(menu).toHaveCount(0);
    await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
    await expect(buttons.nth(index)).toHaveAttribute('aria-checked', 'true');
    if (index === 5) await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
  }
}

test('short Mini retains multiline draft, two audio previews, validation error and offline guidance with a reachable Send', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 360 });
  await demo(page); await openMini(page);
  const panel = mini(page), input = panel.getByRole('textbox', { name: 'Message in pop-up', exact: true });
  const text = Array(10).fill('A retained multiline pop-up draft').join('\n');
  await input.fill(text);
  const audio = readFileSync(resolve('tests/fixtures/picker-tone.m4a'));
  await panel.locator('input[type=file]').setInputFiles([
    { name: 'first-preview.m4a', mimeType: 'audio/mp4', buffer: audio },
    { name: 'second-preview.m4a', mimeType: 'audio/mp4', buffer: audio },
    { name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5_242_881, 65) },
  ]);
  await expect(panel.getByRole('alert')).toContainText('too large');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(panel.getByRole('status')).toContainText('may be offline');
  await expect(panel.locator('audio')).toHaveCount(2);
  const send = panel.getByRole('button', { name: 'Send pop-up message', exact: true });
  const bounds = { panel: await geometry(panel), input: await geometry(input), send: await geometry(send), error: await geometry(panel.getByRole('alert')), notice: await geometry(panel.getByRole('status')) };
  await capture(page, info, 'short-mini-retained-composition', bounds);
  for (const [name, rect] of Object.entries(bounds).filter(([name]) => name !== 'panel')) {
    expect(rect.y, `${name} top`).toBeGreaterThanOrEqual(bounds.panel.y);
    expect(rect.bottom, `${name} bottom`).toBeLessThanOrEqual(bounds.panel.bottom);
  }
  expect(bounds.send.hit).toBe(true);
  expect(bounds.send.height).toBeGreaterThanOrEqual(32);
  await expect(input).toHaveValue(text);
  const files = panel.getByRole('button', { name: /^Remove .* from pop-up$/ });
  await expect(files).toHaveCount(2);
  await files.last().evaluate(element => {
    const list = element.parentElement!.parentElement!;
    list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop;
  });
  expect((await geometry(files.last())).hit).toBe(true);
  await files.last().click(); await expect(panel.locator('audio')).toHaveCount(1);
  await expect(input).toHaveValue(text);
  expect((await geometry(send)).hit).toBe(true);
  expect(await panel.evaluate(element => element.scrollTop)).toBe(0);
  await send.click();
  await expect(panel.getByRole('article').filter({ has: page.locator('.message-text').filter({ hasText: 'A retained multiline pop-up draft' }) })).toHaveCount(1);
  await expect(input).toHaveValue('');
});

test('compact Mini exposes every skin tone without clipping or moving its ancestor', async ({ page }, info) => {
  await demo(page); await openMini(page);
  await mini(page).getByRole('button', { name: 'Add emoji to pop-up', exact: true }).click();
  const picker = mini(page).getByRole('group', { name: 'Pop-up emoji picker', exact: true });
  await expect(picker.getByRole('textbox', { name: 'Search emoji', exact: true })).toBeVisible();
  await toneChoices(page, picker, info, 'compact-mini-skin-tones');
  expect(await mini(page).evaluate(element => element.scrollTop)).toBe(0);
});

test.describe('phone keyboard viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('a shrunken reaction picker retains all six skin tones as usable touch targets', async ({ page }, info) => {
    await demo(page);
    const row = page.getByRole('main').getByRole('article').filter({ hasText: 'Good morning, team!' });
    await row.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('dialog', { name: 'Message actions', exact: true }).getByRole('button', { name: 'Add reaction', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a reaction', exact: true });
    await expect(picker.getByRole('textbox', { name: 'Search emoji', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 300 });
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))).toBe('300px');
    await toneChoices(page, picker, info, 'short-phone-skin-tones');
    await picker.getByRole('button', { name: 'Skin tone', exact: true }).click();
    for (const button of await picker.getByRole('menuitemradio').all()) {
      expect((await geometry(button)).height).toBeGreaterThanOrEqual(44);
    }
  });
});
