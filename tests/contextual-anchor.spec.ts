import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

async function fixture(page: Page) {
  const state = createDemoState();
  const conversation = state.conversations.find(c => c.id === 'demo-design')!;
  state.messages = Array.from({ length: 25 }, (_, index) => ({
    id: `anchor-${index}`, conversationId: conversation.id,
    author: conversation.members[index % 2], text: `Anchor history ${index}`,
    createdAt: new Date(Date.parse('2026-10-06T12:00:00Z') + index * 60000).toISOString(), reactions: [], attachments: [],
  }));
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: DEMO_STORAGE_KEY, state });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'Design team', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const row = page.locator('#message-anchor-3');
  const history = page.getByRole('main').locator('.messages-scroll');
  await row.evaluate(node => { const scroll = node.closest('.messages-scroll')!; scroll.scrollTop += node.getBoundingClientRect().y - scroll.getBoundingClientRect().y - 260; });
  await row.hover();
  const opener = row.getByRole('button', { name: 'More actions', exact: true });
  await opener.click();
  const panel = page.getByRole('dialog', { name: 'Message actions', exact: true });
  await expect(panel).toBeVisible();
  return { row, opener, panel, history };
}

async function capture(page: Page, info: TestInfo, name: string, data: unknown) {
  const directory = evidenceDirectory(info, info.project.name); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, name + '.json'), JSON.stringify(data, null, 2) + '\n');
  await page.screenshot({ path: resolve(directory, name + '.png') });
}

test('context menu follows a connected opener after preceding layout growth', async ({ page }, info) => {
  const { opener, panel, history } = await fixture(page);
  const before = { anchor: await opener.boundingBox(), panel: await panel.boundingBox(), scroll: await history.evaluate(node => node.scrollTop) };
  // Deterministic layout fixture: this isolates the browser's anchor movement
  // contract. It does not claim an actual peer/network/image transport proof.
  await page.locator('#message-anchor-2 .message-text').evaluate(node => { node.textContent = 'An earlier message grew after layout.\n'.repeat(5); });
  await expect.poll(async () => Math.abs((await opener.boundingBox())!.y - before.anchor!.y)).toBeGreaterThan(40);
  const after = { anchor: await opener.boundingBox(), panel: await panel.boundingBox(), scroll: await history.evaluate(node => node.scrollTop) };
  await capture(page, info, 'anchor-layout-growth', { before, after });
  await expect.poll(async () => {
    const anchor = (await opener.boundingBox())!, box = (await panel.boundingBox())!;
    const expected = Math.max(12, Math.min(anchor.y + anchor.height + 8 + box.height > 948 ? anchor.y - box.height - 8 : anchor.y + anchor.height + 8, 948 - box.height));
    return Math.abs(box.y - expected);
  }, { message: 'an open menu remains attached to its moved opener' }).toBeLessThanOrEqual(1);
  const button = panel.getByRole('button', { name: 'Reply in thread', exact: true });
  expect(await button.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('context menu closes when its opener is removed', async ({ page }, info) => {
  const { row, panel } = await fixture(page);
  await row.evaluate(node => node.remove());
  // The repaired menu may already be gone by the diagnostic read. A locator
  // boundingBox() would wait for it to reappear and turn success into a timeout.
  const remaining = await page.evaluate(() => {
    const rect = document.querySelector('[data-context-popover]')?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  });
  await capture(page, info, 'anchor-removed', { panel: remaining });
  await expect(panel, 'an orphaned menu cannot operate on a removed opener').toHaveCount(0);
});
