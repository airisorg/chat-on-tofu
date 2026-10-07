import { expect, test, type Locator, type Page } from './coverage-test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evidenceDirectory } from './browser-config';
import {
  SAMPLE_MESSAGE,
  PREVIEW_MESSAGE_LIMIT,
  PREVIEW_TEXT_LIMIT,
} from '../src/components/landing-preview-state';

const preview = (page: Page) =>
  page.getByRole('region', { name: 'Interactive chat preview', exact: true });
const input = (page: Page) =>
  preview(page).getByRole('textbox', { name: 'Sample message', exact: true });
const messages = (page: Page) =>
  preview(page).getByRole('log', { name: 'Sample messages' }).getByRole('article');
const send = (page: Page) =>
  preview(page).getByRole('button', { name: 'Send sample message', exact: true });

async function load(page: Page, width: number, theme: 'light' | 'dark', height = 960) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((value) => localStorage.setItem('relay-theme', value), theme);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(preview(page)).toBeVisible();
  await expect(messages(page)).toHaveCount(2);
}

async function controlsAreReachable(panel: Locator) {
  const controls = panel.locator('button,textarea');
  await expect(controls).toHaveCount(5);
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(
      await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !!hit && element.contains(hit);
      }),
    ).toBe(true);
  }
}

async function contrast(panel: Locator) {
  const values = await panel
    .locator('h2,p,strong,button:not(:disabled),textarea')
    .evaluateAll((elements) =>
      elements.map((element) => {
        let ancestor: Element | null = element;
        let background = '';
        while (ancestor) {
          background = getComputedStyle(ancestor).backgroundColor;
          if (!['rgba(0, 0, 0, 0)', 'transparent'].includes(background)) break;
          ancestor = ancestor.parentElement;
        }
        return {
          text: element.textContent,
          foreground: getComputedStyle(element).color,
          background,
        };
      }),
    );
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  // Heading, identity, four paragraphs, three enabled buttons and textarea.
  expect(values).toHaveLength(10);
  for (const value of values) {
    const a = luminance(value.foreground),
      b = luminance(value.background);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      value.text || 'sample control',
    ).toBeGreaterThanOrEqual(4.5);
  }
}

for (const width of [320, 390, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`sample ${width}px ${theme}: usable bounded interaction and composed screenshots`, async ({
      page,
    }, info) => {
      const requests: string[] = [];
      page.on('request', (request) => {
        if (request.method() !== 'GET') requests.push(request.url());
      });
      await load(page, width, theme);
      const panel = preview(page);
      await expect(
        panel.getByText('A local sample. Nothing here is sent or saved.', { exact: true }),
      ).toBeVisible();
      const beforeStorage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      await expect(send(page)).toBeDisabled();
      expect(
        await input(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBe(16);
      await input(page).fill('   ');
      await expect(send(page)).toBeDisabled();
      await input(page).fill('');
      await controlsAreReachable(panel);
      await contrast(panel);
      const historyBox = (await panel.getByRole('log').boundingBox())!;
      for (const body of await messages(page).locator('p').all()) {
        const bodyBox = (await body.boundingBox())!;
        expect(bodyBox.y).toBeGreaterThanOrEqual(historyBox.y);
        expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(historyBox.y + historyBox.height);
      }
      await expect(panel).toHaveScreenshot(`preview-initial-${width}-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0,
      });
      const initialHeight = (await panel.boundingBox())!.height;
      const reaction = panel.getByRole('button', {
        name: 'React to sample message with raised hands',
        exact: true,
      });
      await reaction.click();
      await expect(reaction).toHaveAttribute('aria-pressed', 'true');
      await expect(reaction).toHaveText('🙌 4');
      await reaction.press('Space');
      await expect(reaction).toHaveAttribute('aria-pressed', 'false');
      await expect(reaction).toHaveText('🙌 3');
      await panel.getByRole('button', { name: 'Use a sample message', exact: true }).click();
      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveValue(SAMPLE_MESSAGE);
      await input(page).press('Enter');
      await expect(messages(page)).toHaveCount(4);
      await expect(messages(page).nth(2)).toHaveAccessibleName(`You: ${SAMPLE_MESSAGE}`);
      await expect(messages(page).last()).toContainText('Sample reply');
      await expect(input(page)).toHaveValue('');
      await expect(input(page)).toBeFocused();
      await expect(panel.getByRole('status')).toHaveText(
        'Sample message added. An illustrative reply is shown below.',
      );
      expect(Math.abs((await panel.boundingBox())!.height - initialHeight)).toBeLessThanOrEqual(1);
      await expect(panel).toHaveScreenshot(`preview-sent-${width}-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0,
      });
      for (let i = 0; i < 8; i++) {
        await input(page).fill(`Bounded sample ${i}`);
        await send(page).click();
      }
      await expect(messages(page)).toHaveCount(PREVIEW_MESSAGE_LIMIT);
      await expect(messages(page).nth(6)).toHaveText(/Bounded sample 7/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await controlsAreReachable(panel);
      await panel.getByRole('button', { name: 'Reset sample conversation', exact: true }).click();
      await expect(messages(page)).toHaveCount(2);
      await expect(input(page)).toHaveValue('');
      await expect(reaction).toHaveAttribute('aria-pressed', 'false');
      await expect(panel.getByRole('status')).toHaveText('Sample conversation reset.');
      expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(beforeStorage);
      expect(requests).toEqual([]);
      const dir = evidenceDirectory(info, 'landing-preview');
      await mkdir(dir, { recursive: true });
      await panel.screenshot({
        path: resolve(dir, `${info.project.name}-${width}-${theme}.png`),
        animations: 'disabled',
        caret: 'hide',
      });
    });
  }

test('keyboard input, IME, unsafe sample text and reset never change the real workspace', async ({
  page,
}) => {
  await load(page, 390, 'light', 500);
  const panel = preview(page);
  await input(page).fill('First line');
  await input(page).press('Shift+Enter');
  await input(page).pressSequentially('Second line');
  await expect(input(page)).toHaveValue('First line\nSecond line');
  await expect(messages(page)).toHaveCount(2);
  await input(page).fill('Composing');
  await input(page).dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  });
  await expect(messages(page)).toHaveCount(2);
  await expect(input(page)).toHaveValue('Composing');
  const unsafe = '<img src=x onerror="window.previewInjected=true">';
  await input(page).fill(unsafe);
  await send(page).click();
  await expect(messages(page).nth(2)).toHaveAccessibleName(`You: ${unsafe}`);
  expect(await page.evaluate(() => 'previewInjected' in window)).toBe(false);
  await expect(panel.locator('img,iframe,script')).toHaveCount(0);
  await input(page).fill('x'.repeat(PREVIEW_TEXT_LIMIT + 100));
  await expect(input(page)).toHaveValue('x'.repeat(PREVIEW_TEXT_LIMIT));
  await controlsAreReachable(panel);
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: 'Add to Home Screen', exact: true })).toHaveCount(
    1,
  );
  await page.reload();
  await expect(messages(page)).toHaveCount(2);
  await expect(input(page)).toHaveValue('');
  await expect(page.getByText(/Invitation emails aren’t sent automatically/)).toHaveCount(1);
});

for (const reduced of [false, true])
  test(`user-triggered entry motion honors reduced motion ${reduced}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await load(page, 1440, 'dark');
    await preview(page).getByRole('button', { name: 'Use a sample message', exact: true }).click();
    await send(page).click();
    const entries = preview(page).locator('[data-entry="new"]');
    await expect(entries).toHaveCount(2);
    const styles = await entries.evaluateAll((elements) =>
      elements.map((element) => ({
        name: getComputedStyle(element).animationName,
        duration: parseFloat(getComputedStyle(element).animationDuration),
      })),
    );
    for (const style of styles) {
      if (reduced) expect(style.name).toBe('none');
      else {
        expect(style.name).not.toBe('none');
        expect(style.duration).toBeGreaterThan(0);
        expect(style.duration).toBeLessThanOrEqual(0.2);
      }
    }
    const duration = await preview(page)
      .getByRole('button', { name: 'Reset sample conversation', exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
    expect(duration).toBe(reduced ? 0 : 0.15);
  });

test('landing offers a clearly labelled usable sample conversation', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome to Chat\./ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const dir = evidenceDirectory(info, 'landing-preview');
  await mkdir(dir, { recursive: true });
  await page.locator('.welcome-content').screenshot({
    path: resolve(dir, `${info.project.name}-hero.png`),
  });
  const preview = page.getByRole('region', { name: 'Interactive chat preview', exact: true });
  await expect(preview).toHaveCount(1);
  await expect(preview.getByRole('textbox', { name: 'Sample message', exact: true })).toBeVisible();
  await expect(
    preview.getByRole('button', { name: 'Send sample message', exact: true }),
  ).toBeDisabled();
});
