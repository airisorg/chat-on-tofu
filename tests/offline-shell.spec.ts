import { evidenceDirectory } from './browser-config';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} cold offline launch keeps a public shell and recovers through Retry`, async ({
    page,
    context,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      return Promise.all(
        names
          .filter((name) => name.startsWith('relay-public-'))
          .map(async (name) => {
            const entries = await (await caches.open(name)).keys();
            return { name, paths: entries.map((entry) => new URL(entry.url).pathname).sort() };
          }),
      );
    });
    expect(cached).toEqual([
      {
        name: 'relay-public-v2',
        paths: [
          '/fonts/google-sans-latin-variable.woff2',
          '/icons/icon-180.png',
          '/icons/icon-192.png',
          '/icons/icon-512.png',
          '/offline.html',
        ],
      },
    ]);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Check your connection', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: 'Chat', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(await page.evaluate(() => document.fonts.check('16px "Google Sans"'))).toBe(true);
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await retry.click();
    await expect(
      page.getByRole('heading', { name: 'Check your connection', exact: true }),
    ).toBeVisible();
    const dir = evidenceDirectory(info, 'offline-shell');
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: resolve(dir, `${theme}.png`) });
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Continue with Google', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Check your connection', exact: true }),
    ).toHaveCount(0);
  });
}
