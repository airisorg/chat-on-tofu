import { expect, test, type Page } from './coverage-test';

type SharingFixture = {
  copies: string[];
  shares: ShareData[];
  release?: () => void;
};
declare global {
  interface Window {
    sharingFixture: SharingFixture;
  }
}

// The explicit local demo exercises browser interaction contracts. Native
// clipboard/share calls are controlled, so no system clipboard or recipient changes.
async function sharing(
  page: Page,
  mode: 'copy' | 'denied' | 'native' | 'cancel' | 'failed' | 'held-copy' | 'held-share',
) {
  await page.addInitScript((mode) => {
    const fixture: SharingFixture = { copies: [], shares: [] };
    window.sharingFixture = fixture;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          fixture.copies.push(value);
          if (mode === 'held-copy')
            await new Promise<void>((resolve) => {
              fixture.release = resolve;
            });
          if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
        },
      },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: ['native', 'cancel', 'failed', 'held-share'].includes(mode)
        ? async (value: ShareData) => {
            fixture.shares.push(value);
            if (mode === 'held-share')
              await new Promise<void>((resolve) => {
                fixture.release = resolve;
              });
            if (mode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
            if (mode === 'failed' || mode === 'held-share')
              throw new DOMException('Unavailable', 'NotAllowedError');
          }
        : undefined,
    });
  }, mode);
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Chat navigation' })
    .getByRole('button', { name: /^Design team/ })
    .click();
  await page.locator('.conversation-title').click();
  const menu = page.getByRole('dialog');
  await expect(menu.getByRole('button', { name: 'Share invitation', exact: true })).toBeVisible();
  return menu;
}

for (const mode of ['copy', 'denied', 'native', 'cancel', 'failed'] as const) {
  test(`invitation sharing ${mode} preserves the correct native or fallback contract`, async ({
    page,
  }) => {
    const menu = await sharing(page, mode);
    await menu.getByRole('button', { name: 'Share invitation', exact: true }).click();
    const result = await page.evaluate(() => ({
      copies: window.sharingFixture.copies,
      shares: window.sharingFixture.shares,
    }));
    if (mode === 'native' || mode === 'cancel') {
      expect(result.shares).toHaveLength(1);
      expect(result.copies).toEqual([]);
      expect(result.shares[0].title).toBe('Join Design team in Chat');
      expect(result.shares[0].text).toContain('using the email I added');
      expect(new URL(result.shares[0].url!).origin).toBe(new URL(page.url()).origin);
      expect(new URL(result.shares[0].url!).searchParams.get('join')).toBe('demo-design');
      expect(await page.getByRole('status').allTextContents()).toEqual([]);
    } else {
      expect(result.copies).toHaveLength(1);
      const copied = new URL(result.copies[0]);
      expect(copied.origin).toBe(new URL(page.url()).origin);
      expect(copied.pathname).toBe('/');
      expect(copied.searchParams.get('join')).toBe('demo-design');
      if (mode === 'denied')
        await expect(page.getByRole('status')).toHaveText(`Invitation link: ${copied.href}`);
      else
        await expect(page.getByRole('status')).toContainText(
          'Invitation link copied. Share it with your friend',
        );
    }
    await expect(menu).toBeVisible();
  });
}

for (const mode of ['held-copy', 'held-share'] as const) {
  test(`late ${mode} completion cannot affect a dismissed conversation menu`, async ({ page }) => {
    const menu = await sharing(page, mode);
    await menu
      .getByRole('button', {
        name: mode === 'held-copy' ? 'Copy invitation link' : 'Share invitation',
        exact: true,
      })
      .click();
    await expect.poll(() => page.evaluate(() => Boolean(window.sharingFixture.release))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.evaluate(() => window.sharingFixture.release!());
    // Wait for an independently queued browser task after the promise chain.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(await page.getByRole('status').allTextContents()).toEqual([]);
    expect(await page.evaluate(() => window.sharingFixture.copies.length)).toBe(
      mode === 'held-copy' ? 1 : 0,
    );
  });
}
