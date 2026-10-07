import { expect, test, type Page } from './coverage-test';
import { draftSavingKey } from '../src/lib/draft-preference';

// Explicit demo data is isolated per context. Native capabilities are synthetic;
// this suite never changes a user's clipboard, installed apps or production data.
const nav = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const main = (page: Page) => page.getByRole('main');
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function design(page: Page) {
  await nav(page).getByRole('button', { name: 'Design team', exact: true }).click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}
async function details(page: Page) {
  await page.locator('.conversation-title').click();
  return page.getByRole('dialog');
}

test('conversation settings persist section, mute and pin changes and permit safe cancellation', async ({
  page,
}) => {
  await demo(page);
  await design(page);
  let menu = await details(page);
  await menu.getByRole('button', { name: 'Edit details and section', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Release planning');
  await form
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('A private demo planning area');
  await form.getByRole('combobox', { name: /^Section/ }).fill('Projects');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    main(page).getByRole('heading', { name: 'Release planning', exact: true }),
  ).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  menu = await details(page);
  await expect(menu).toContainText('A private demo planning area');
  await menu.getByRole('button', { name: 'Unpin conversation', exact: true }).click();
  await expect(menu).toHaveCount(0);
  menu = await details(page);
  await menu.getByRole('button', { name: 'Pin conversation', exact: true }).click();
  menu = await details(page);
  await menu.getByRole('button', { name: 'Mute conversation', exact: true }).click();
  menu = await details(page);
  await menu.getByRole('button', { name: 'Unmute conversation', exact: true }).click();
  menu = await details(page);
  await menu.getByRole('button', { name: 'Leave conversation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    nav(page).getByRole('button', { name: 'Release planning', exact: true }),
  ).toBeVisible();
  await page.reload();
  await nav(page).getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Sections', exact: true })).toBeVisible();
  await main(page)
    .getByRole('button', { name: /Release planning/ })
    .click();
  menu = await details(page);
  await expect(menu.getByRole('button', { name: 'Unpin conversation', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Mute conversation', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Mark as unread', exact: true }).click();
  await expect(menu).toHaveCount(0);
  const entry = nav(page).getByRole('button', { name: 'Release planning', exact: true });
  await expect(entry.locator('.unread-dot')).toHaveCount(1);
  await expect(entry.locator('span.unread')).toHaveText('Release planning');
  await expect(entry.locator('.lucide-pin')).toHaveCount(1);
  await entry.click();
  await expect(entry.locator('.unread-dot')).toHaveCount(0);
  await expect(entry.locator('span.unread')).toHaveCount(0);
  await expect(entry.locator('.lucide-pin')).toHaveCount(1);
});

for (const denied of [false, true]) {
  test(`message menu copy ${denied ? 'failure keeps readable text' : 'success closes the menu'}`, async ({
    page,
  }) => {
    await page.addInitScript((denied) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.testCopied = text;
            if (denied) throw new DOMException('Denied', 'NotAllowedError');
          },
        },
      });
    }, denied);
    await demo(page);
    await design(page);
    const row = main(page).getByRole('article').filter({ hasText: 'Good morning, team!' });
    const original = await row.locator('.message-text').textContent();
    await row.hover();
    await row.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Copy text', exact: true }).click();
    expect(await page.locator('html').getAttribute('data-test-copied')).toBe(original);
    if (denied) {
      await expect(page.getByRole('status')).toContainText('Select the message text to copy it.');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(row).toContainText(original!);
    } else {
      await expect(page.getByRole('status')).toHaveText('Message copied');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
}

test('message menu star and thread actions update their destination views', async ({ page }) => {
  await demo(page);
  await design(page);
  const row = main(page).getByRole('article').filter({ hasText: 'Good morning, team!' });
  await row.hover();
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Star message', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Starred', exact: true }).click();
  await expect(main(page)).toContainText('Good morning, team!');
  await design(page);
  await row.hover();
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Unstar message', exact: true })
    .click();
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reply in thread', exact: true })
    .click();
  const thread = page.locator('.thread-panel');
  await thread.getByRole('textbox').fill('Reply submitted using Enter');
  await thread.getByRole('textbox').press('Enter');
  await expect(
    thread.getByRole('article').filter({ hasText: 'Reply submitted using Enter' }),
  ).toHaveCount(1);
  await expect(thread.getByRole('textbox')).toHaveValue('');
  await page.getByRole('button', { name: 'Close thread', exact: true }).click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: 'Search in chat', exact: true })).toBeFocused();
});

test('phone overflow destinations retain navigation and empty sections offer recovery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  const tabs = page.getByRole('navigation', { name: 'Main navigation' });
  await tabs.getByRole('button', { name: 'Sections', exact: true }).click();
  await expect(main(page)).toContainText('A place for everything');
  await main(page).getByRole('button', { name: 'Browse conversations', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  for (const destination of ['Spaces', 'Mentions', 'Starred']) {
    await tabs.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: destination, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(main(page).getByRole('heading', { name: destination, exact: true })).toBeVisible();
  }
  for (const destination of ['Your profile', 'Settings', 'Add to Home Screen']) {
    await tabs.getByRole('button', { name: 'More', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: new RegExp(`${destination}$`) })
      .click();
    await expect(
      page.getByRole('dialog', {
        name: destination === 'Add to Home Screen' ? 'Make yourself at home' : destination,
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

for (const fail of [false, true]) {
  test(`signed-in install prompt ${fail ? 'failure' : 'completion'} clears the consumed browser event`, async ({
    page,
  }) => {
    await demo(page);
    await page.evaluate((fail) => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', {
        value: async () => {
          document.documentElement.dataset.testPrompted = 'yes';
          if (fail) throw new Error('Synthetic install rejection');
        },
      });
      window.dispatchEvent(event);
      document.documentElement.dataset.testInstallPrevented = String(event.defaultPrevented);
    }, fail);
    expect(await page.locator('html').getAttribute('data-test-install-prevented')).toBe('true');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Install', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Install Chat', exact: true })
      .click();
    expect(await page.locator('html').getAttribute('data-test-prompted')).toBe('yes');
    await expect(page.getByRole('button', { name: 'Install Chat', exact: true })).toHaveCount(0);
    if (fail) await expect(page.getByRole('status')).toContainText('Installation did not complete');
    else expect(await page.getByRole('status').allTextContents()).toEqual([]);
  });
}

test('draft saving refuses to claim persistence when the preference cannot be written', async ({
  page,
}) => {
  await demo(page);
  await design(page);
  await main(page)
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Keep this draft in memory');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Save drafts on this device', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage denied', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, draftSavingKey('demo-you'));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('status')).toContainText('Draft saving could not be enabled');
  await page.keyboard.press('Escape');
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft in memory',
  );
});
