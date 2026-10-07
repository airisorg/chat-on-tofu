import { evidenceDirectory } from './browser-config';
import { expect, test } from './coverage-test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
for (const [width, theme] of [
  [390, 'dark'],
  [768, 'light'],
  [1440, 'light'],
] as const) {
  test(`landing ${width}px ${theme} has readable type,working section links and FAQs`, async ({
    page,
    context,
  }, info) => {
    await context.addInitScript((value) => localStorage.setItem('relay-theme', value), theme);
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    const heading = page.getByRole('heading', { name: /^Welcome to Chat\./ });
    await expect(heading).toBeVisible();
    const font = await heading.evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, weight: s.fontWeight, size: parseFloat(s.fontSize) };
    });
    expect(font.family).toContain('Google Sans');
    expect(font.weight).toBe('700');
    expect(font.size).toBeGreaterThanOrEqual(32);
    const nav = page.getByRole('navigation', { name: 'Explore Chat', exact: true });
    const sections = [
      ['Messaging', '#messaging'],
      ['Sharing', '#sharing'],
      ['Mobile', '#mobile'],
      ['FAQs', '#questions'],
    ] as const;
    await expect(nav.getByRole('link')).toHaveCount(sections.length);
    await expect(nav.getByRole('link')).toHaveText(sections.map(([name]) => name));
    for (const [name, href] of sections) {
      const link = nav.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await nav.getByRole('link', { name: 'FAQs', exact: true }).click();
    await expect(page).toHaveURL(/#questions$/);
    const question = page.locator('summary').filter({ hasText: 'Do I need to install anything?' });
    await question.press('Enter');
    await expect(
      page.getByText(
        'You can use the app directly in your browser. Adding it to your Home Screen is optional.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const dir = evidenceDirectory(info, 'landing-refinement');
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: resolve(dir, `${info.project.name}-${width}-${theme}.png`),
      fullPage: true,
    });
  });
}
