import { expect, test, type Page } from './coverage-test';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { isStoredDemoState } from '../src/lib/demo-storage';
import type { Message } from '../src/lib/types';

// Loopback demo checks exercise actual UI. FileReader failures are controlled;
// no native microphone, clipboard, hosted account or database is used.
const main = (page: Page) => page.getByRole('main');
const mini = (page: Page) =>
  page.getByRole('region', { name: 'Mini conversation: Design team', exact: true });
const input = (page: Page) => mini(page).getByRole('textbox', { name: 'Message in pop-up' });
async function demo(page: Page) {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if ((page.viewportSize()?.width || 1440) < 800)
    await main(page)
      .getByRole('button', { name: /^Design team/ })
      .first()
      .click();
  else
    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Design team', exact: true })
      .click();
  await expect(main(page).getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
}
async function openMini(page: Page) {
  await demo(page);
  await main(page).getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
  await expect(input(page)).toBeFocused();
}

test('Mini partial file batches retain valid files, reject limits and keep the current text', async ({
  page,
}) => {
  await openMini(page);
  await input(page).fill('My unsent text survives file validation');
  const files = mini(page).locator('input[type="file"]');
  await files.setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') },
    { name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
  ]);
  await expect(mini(page).getByRole('alert')).toHaveText(
    'too-large.txt is too large. Choose a file 5 MB or smaller.',
  );
  await expect(
    mini(page).getByRole('button', { name: 'Remove first.txt from pop-up' }),
  ).toBeVisible();
  await expect(
    mini(page).getByRole('button', { name: 'Remove too-large.txt from pop-up' }),
  ).toHaveCount(0);
  await mini(page).getByRole('button', { name: 'Remove first.txt from pop-up' }).click();
  await files.setInputFiles([
    { name: 'safe.txt', mimeType: 'text/plain', buffer: Buffer.from('safe') },
    { name: 'unsafe.html', mimeType: 'text/html', buffer: Buffer.from('<script>bad()</script>') },
  ]);
  await expect(mini(page).getByRole('alert')).toHaveText(
    'Choose a PNG, JPG, GIF, WebP image, text file, PDF, or audio file.',
  );
  await expect(
    mini(page).getByRole('button', { name: 'Remove safe.txt from pop-up' }),
  ).toBeVisible();
  await mini(page).getByRole('button', { name: 'Remove safe.txt from pop-up' }).click();
  await files.setInputFiles(
    [1, 2, 3, 4].map((number) => ({
      name: `bounded-${number}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`file ${number}`),
    })),
  );
  await expect(mini(page).getByRole('alert')).toHaveText(
    'You can attach up to 3 files per message.',
  );
  await expect(
    mini(page).getByRole('button', { name: /^Remove bounded-\d.txt from pop-up$/ }),
  ).toHaveCount(3);
  await expect(
    mini(page).getByRole('button', { name: 'Remove bounded-4.txt from pop-up' }),
  ).toHaveCount(0);
  await expect(input(page)).toHaveValue('My unsent text survives file validation');
  await expect(
    mini(page).getByRole('button', { name: 'Send pop-up message', exact: true }),
  ).toBeEnabled();
  await mini(page).getByRole('button', { name: 'Send pop-up message', exact: true }).click();
  const sent = mini(page)
    .getByRole('article')
    .filter({ hasText: 'My unsent text survives file validation' });
  await expect(sent).toHaveCount(1);
  await expect(sent.locator('.message-attachments a[download]')).toHaveCount(3);
  await expect(input(page)).toHaveValue('');
});

test('Mini read failure preserves the earlier file and a later real read succeeds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = FileReader;
    let reads = 0;
    window.FileReader = class extends Native {
      readAsDataURL(blob: Blob) {
        reads++;
        if (reads === 2) {
          queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')));
          return;
        }
        super.readAsDataURL(blob);
      }
    };
  });
  await openMini(page);
  await input(page).fill('Keep my draft on read failure');
  const files = mini(page).locator('input[type="file"]');
  await files.setInputFiles([
    { name: 'read-ok.txt', mimeType: 'text/plain', buffer: Buffer.from('first good bytes') },
    { name: 'read-fails.txt', mimeType: 'text/plain', buffer: Buffer.from('unread bytes') },
  ]);
  await expect(mini(page).getByRole('alert')).toHaveText(
    'This file couldn’t be read. Please try again.',
  );
  await expect(
    mini(page).getByRole('button', { name: 'Remove read-ok.txt from pop-up' }),
  ).toBeVisible();
  await expect(
    mini(page).getByRole('button', { name: 'Remove read-fails.txt from pop-up' }),
  ).toHaveCount(0);
  await expect(input(page)).toHaveValue('Keep my draft on read failure');
  await files.setInputFiles({
    name: 'read-retry.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('real retry bytes'),
  });
  await expect(mini(page).getByRole('alert')).toHaveCount(0);
  await expect(
    mini(page).getByRole('button', { name: /^Remove read-(ok|retry).txt from pop-up$/ }),
  ).toHaveCount(2);
  await mini(page).getByRole('button', { name: 'Send pop-up message', exact: true }).click();
  const sent = mini(page).getByRole('article').filter({ hasText: 'Keep my draft on read failure' });
  await expect(sent).toHaveCount(1);
  await expect(sent.locator('a[download="read-retry.txt"]')).toHaveAttribute(
    'href',
    'data:text/plain;base64,cmVhbCByZXRyeSBieXRlcw==',
  );
});

test('Mini lazy emoji focus, outside dismissal and voice Escape preserve the independent draft', async ({
  page,
}) => {
  await openMini(page);
  await input(page).fill('Independent Mini draft');
  await mini(page).getByRole('button', { name: 'Add emoji to pop-up', exact: true }).click();
  await expect(
    mini(page).getByRole('textbox', { name: 'Search emoji', exact: true }),
  ).toBeFocused();
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).click();
  await expect(
    mini(page).getByRole('group', { name: 'Pop-up emoji picker', exact: true }),
  ).toHaveCount(0);
  await expect(input(page)).toHaveValue('Independent Mini draft');
  await mini(page).getByRole('button', { name: 'Add emoji to pop-up', exact: true }).click();
  await expect(
    mini(page).getByRole('textbox', { name: 'Search emoji', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    mini(page).getByRole('group', { name: 'Pop-up emoji picker', exact: true }),
  ).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await mini(page)
    .getByRole('button', { name: 'Record voice note in pop-up', exact: true })
    .click();
  const start = mini(page).getByRole('button', { name: 'Start recording', exact: true });
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press('Escape');
  await expect(start).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('Independent Mini draft');
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
});

test('a newly created empty Space opens a useful Mini and sends its first message exactly once', async ({
  page,
}) => {
  await demo(page);
  await page
    .getByRole('complementary')
    .getByRole('button', { name: 'New chat', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
  await dialog.getByRole('button', { name: 'Create a space', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Space name', exact: true })
    .fill('Coverage empty Space');
  await dialog.getByRole('button', { name: 'Create space', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
  const panel = page.getByRole('region', {
    name: 'Mini conversation: Coverage empty Space',
    exact: true,
  });
  await expect(
    panel.getByText('Start the conversation with Coverage empty Space.', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('article')).toHaveCount(0);
  const draft = panel.getByRole('textbox', { name: 'Message in pop-up', exact: true });
  await expect(draft).toBeFocused();
  await draft.fill('The first message in this Space');
  await draft.press('Enter');
  await expect(panel.getByRole('article')).toHaveCount(1);
  await expect(panel.getByRole('article').locator('.message-text')).toHaveText(
    'The first message in this Space',
  );
  await expect(draft).toHaveValue('');
  await expect(main(page).getByRole('article').locator('.message-text')).toHaveText(
    'The first message in this Space',
  );
});

test('phone recipient keyboard collapse, chip removal and kind changes retain the intended people', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  await main(page).getByRole('button', { name: 'Back to conversations', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
  const to = dialog.getByRole('combobox', { name: 'To', exact: true });
  await to.fill('first@example.test; second@example.test');
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Choose one person to start a direct message.',
  );
  await dialog.getByRole('button', { name: 'Group', exact: true }).click();
  const add = dialog.getByRole('combobox', { name: 'Add people', exact: true });
  await add.fill('Maya');
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  await add.press('Escape');
  await expect(add).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog).toBeVisible();
  await add.press('ArrowDown');
  await add.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Remove Maya Chen', exact: true })).toBeVisible();
  await add.fill('Jordan');
  await add.press('Enter');
  await expect(
    dialog.getByRole('button', { name: 'Remove Jordan Lee', exact: true }),
  ).toBeVisible();
  await add.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Remove Jordan Lee', exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByRole('button', { name: 'Remove Maya Chen', exact: true })).toBeVisible();
  await add.fill('Jordan');
  await add.press('Enter');
  await dialog.getByRole('button', { name: 'Direct message', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove Jordan Lee', exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByRole('button', { name: 'Remove Maya Chen', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main(page).getByRole('heading', { name: 'Maya Chen', exact: true })).toBeVisible();
});

test('search resets individual scopes, rejects empty custom dates and restores actual recent ordering', async ({
  page,
}) => {
  const state = createDemoState();
  const [self, maya, jordan] = state.conversations[0].members;
  const texts = [
    'CoverageOrder oldest CoverageOrder CoverageOrder',
    'CoverageOrder middle',
    'CoverageOrder newest',
  ];
  const extra: Message[] = texts.map((text, index) => ({
    id: `coverage-order-${index}`,
    text,
    author: index === 1 ? jordan : maya,
    conversationId: index === 1 ? 'demo-launch' : 'demo-design',
    createdAt: `2026-10-0${index + 1}T12:00:00.000Z`,
    reactions: [],
    attachments: [],
  }));
  expect(self.id).toBe(state.user.id);
  state.messages.push(...extra);
  expect(isStoredDemoState(state), 'Fixture must satisfy actual stored-demo validation').toBe(true);
  await page.addInitScript(({ state, key }) => localStorage.setItem(key, JSON.stringify(state)), {
    state,
    key: DEMO_STORAGE_KEY,
  });
  await demo(page);
  await page.getByRole('textbox', { name: 'Search in chat', exact: true }).fill('CoverageOrder');
  const results = main(page)
    .getByRole('button', { name: /^Message from / })
    .locator('strong');
  const choose = async (title: string, name: string) => {
    await main(page)
      .getByRole('button', { name: new RegExp(`^${title} filter`) })
      .click();
    await page
      .getByRole('dialog', { name: title, exact: true })
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: title, exact: true })).toHaveCount(0);
  };
  await expect(results).toHaveText([texts[2], texts[1], texts[0]]);
  await choose('From', 'Maya Chen maya@example.com');
  await expect(results).toHaveText([texts[2], texts[0]]);
  await choose('From', 'Anyone');
  await expect(results).toHaveText([texts[2], texts[1], texts[0]]);
  await choose('Said in', 'Design team Space');
  await expect(results).toHaveText([texts[2], texts[0]]);
  await choose('Said in', 'All conversations');
  await expect(results).toHaveText([texts[2], texts[1], texts[0]]);
  await main(page)
    .getByRole('button', { name: /^Date filter/ })
    .click();
  const date = page.getByRole('dialog', { name: 'Date', exact: true });
  await date.getByRole('button', { name: 'Custom range', exact: true }).click();
  await date.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(date.getByRole('alert')).toHaveText('Choose an on-or-after or on-or-before date.');
  await expect(results).toHaveText([texts[2], texts[1], texts[0]]);
  await date.getByLabel('On or after', { exact: true }).fill('2026-10-02');
  await date.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(results).toHaveText([texts[2], texts[1]]);
  await main(page).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await main(page).getByRole('button', { name: 'Sort results: Most recent', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Sort results', exact: true })
    .getByRole('button', { name: 'Relevance', exact: true })
    .click();
  await expect(results).toHaveText([texts[0], texts[2], texts[1]]);
  await main(page).getByRole('button', { name: 'Sort results: Relevance', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Sort results', exact: true })
    .getByRole('button', { name: 'Most recent', exact: true })
    .click();
  await expect(results).toHaveText([texts[2], texts[1], texts[0]]);
});

test('unsupported desktop installation gives browser instructions without inventing a native prompt', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
  });
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Add to Home Screen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make yourself at home', exact: true });
  await expect(dialog.locator('ol > li')).toHaveCount(2);
  await expect(dialog.locator('ol > li').nth(1)).toContainText(
    'Use the install icon in the address bar or choose Install app from the browser menu when offered.',
  );
  await expect(dialog.getByRole('button', { name: 'Install Chat', exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('Installation is optional.');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
