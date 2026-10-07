import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';

// Local, isolated demo checks. Google Comfortable mode documents opposite
// sender/recipient sides; saved Google screenshots establish only outgoing DM
// bubble appearance. These tests do not claim incoming exact pixels or device
// parity, use real accounts, or visit a hosted provider.
const main = (page: Page) => page.getByRole('main');
const ownRow = (page: Page) => main(page).locator('#message-dm-own');
const incomingRow = (page: Page) => main(page).locator('#message-dm-incoming');

async function demo(page: Page) {
  const state = createDemoState();
  const peer = state.conversations.find((c) => c.id === 'demo-maya-dm')!.members[1];
  const audio = readFileSync(resolve(process.cwd(), 'tests/fixtures/picker-tone.m4a'));
  state.messages = state.messages.filter((m) => m.conversationId !== 'demo-maya-dm');
  state.messages.push(
    {
      id: 'dm-incoming',
      conversationId: 'demo-maya-dm',
      author: peer,
      text: 'Incoming direct message',
      createdAt: '2026-10-06T12:01:00Z',
      reactions: [],
      attachments: [],
    },
    {
      id: 'dm-own',
      conversationId: 'demo-maya-dm',
      author: state.user,
      text: 'Own direct message',
      createdAt: '2026-10-06T12:02:00Z',
      reactions: [{ emoji: '👍', userIds: [state.user.id] }],
      attachments: [],
    },
    {
      id: 'dm-long',
      conversationId: 'demo-maya-dm',
      author: state.user,
      text: 'Long ' + 'unbroken'.repeat(400),
      createdAt: '2026-10-06T12:03:00Z',
      reactions: [],
      attachments: [],
    },
    {
      id: 'dm-media',
      conversationId: 'demo-maya-dm',
      author: state.user,
      text: '',
      createdAt: '2026-10-06T12:04:00Z',
      reactions: [],
      attachments: [
        {
          name: 'dm.png',
          type: 'image/png',
          size: 68,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=',
        },
        {
          name: 'W'.repeat(115) + '.txt',
          type: 'text/plain',
          size: 2,
          url: 'data:text/plain;base64,aGk=',
        },
        {
          name: 'dm.m4a',
          type: 'audio/mp4',
          size: audio.length,
          url: 'data:audio/mp4;base64,' + audio.toString('base64'),
        },
      ],
    },
  );
  await page.addInitScript(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('relay-theme', 'system');
    },
    { key: DEMO_STORAGE_KEY, state },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if (page.viewportSize()!.width < 800)
    await main(page)
      .getByRole('button', { name: /Maya Chen/ })
      .first()
      .click();
  else
    await page
      .getByRole('complementary', { name: 'Chat navigation' })
      .getByRole('button', { name: 'Maya Chen', exact: true })
      .click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function verify(page: Page, theme: 'light' | 'dark', info: TestInfo) {
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const metrics = await main(page).evaluate((element) => {
    const own = element.querySelector('#message-dm-own')!,
      incoming = element.querySelector('#message-dm-incoming')!;
    const ownText = own.querySelector('.message-text')!,
      peerText = incoming.querySelector('.message-text')!;
    const history = own.parentElement!,
      composer = element.querySelector('.composer-wrap')!;
    const rect = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const palette = (node: Element) => {
      const s = getComputedStyle(node);
      return {
        background: s.backgroundColor,
        radius: parseFloat(s.borderTopLeftRadius),
        color: s.color,
      };
    };
    const author = own.querySelector('.message-meta strong')!;
    return {
      own: rect(ownText),
      peer: rect(peerText),
      history: rect(history),
      composer: rect(composer),
      ownPalette: palette(ownText),
      peerPalette: palette(peerText),
      author: rect(author),
      more: rect(own.querySelector('button[aria-label="More actions"]')!),
      timestamp: rect(own.querySelector('time')!),
      long: [...element.querySelectorAll('#message-dm-long .message-text')].map((node) => ({
        ...rect(node),
        client: node.clientWidth,
        scroll: node.scrollWidth,
      })),
      media: [...element.querySelectorAll('#message-dm-media .message-attachments > div')].map(
        (node) => ({ ...rect(node), parent: rect(node.closest('.message-body')!) }),
      ),
      documentWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  if (process.env.CHAT_EVIDENCE_DIR) {
    const dir = resolve(process.env.CHAT_EVIDENCE_DIR, info.project.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, `${metrics.viewport}-${theme}.json`),
      JSON.stringify(metrics, null, 2) + '\n',
    );
    await ownRow(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(dir, `${metrics.viewport}-${theme}.png`) });
  }
  // The first assertion independently catches the old left-aligned own row.
  expect(metrics.own.x - metrics.peer.x).toBeGreaterThan(40);
  expect(Math.abs(metrics.own.right - metrics.history.right)).toBeLessThanOrEqual(1);
  expect(metrics.ownPalette.background).toBe(
    theme === 'light' ? 'rgb(211, 227, 253)' : 'rgb(40, 68, 109)',
  );
  expect(metrics.peerPalette.background).toBe(
    theme === 'light' ? 'rgb(240, 244, 249)' : 'rgb(40, 45, 53)',
  );
  expect(metrics.ownPalette.radius).toBeGreaterThanOrEqual(16);
  expect(metrics.peerPalette.radius).toBeGreaterThanOrEqual(16);
  expect(metrics.author.width).toBeLessThanOrEqual(1);
  await expect(ownRow(page).locator(':scope > .avatar')).toHaveCount(0);
  await expect(incomingRow(page).locator(':scope > .avatar')).toHaveCount(1);
  expect(await ownRow(page).ariaSnapshot()).toContain('Alex Morgan');
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.media).toHaveLength(3);
  const luminance = (color: string) => {
    const c = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  for (const palette of [metrics.ownPalette, metrics.peerPalette]) {
    const foreground = luminance(palette.color),
      background = luminance(palette.background);
    expect(
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
  if (metrics.viewport < 800) {
    expect(metrics.more.width).toBeGreaterThanOrEqual(44);
    expect(metrics.more.height).toBeGreaterThanOrEqual(44);
    const overlaps = (a: typeof metrics.more, b: typeof metrics.more) =>
      a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
    expect(
      overlaps(metrics.more, metrics.timestamp),
      'More actions must not cover the outgoing timestamp',
    ).toBe(false);
    expect(overlaps(metrics.more, metrics.own), 'More actions must not cover outgoing text').toBe(
      false,
    );
    await ownRow(page).scrollIntoViewIfNeeded();
    const hit = await ownRow(page)
      .getByRole('button', { name: 'More actions', exact: true })
      .evaluate((node) => {
        const r = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
    expect(hit).toBe(true);
  }
  for (const text of metrics.long) {
    expect(text.scroll).toBeLessThanOrEqual(text.client + 1);
    expect(text.right).toBeLessThanOrEqual(metrics.history.right + 1);
  }
  for (const media of metrics.media) {
    expect(media.x).toBeGreaterThanOrEqual(media.parent.x - 1);
    expect(media.right).toBeLessThanOrEqual(media.parent.right + 1);
  }
  if (metrics.viewport >= 800) {
    expect(metrics.history.width).toBeLessThanOrEqual(896.5);
    expect(Math.abs(metrics.history.x - metrics.composer.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(metrics.history.width - metrics.composer.width)).toBeLessThanOrEqual(4);
  }
}

for (const width of [375, 390, 768, 799, 1024, 3440])
  test.describe(`${width}px`, () => {
    // Narrow desktop windows remain fine-pointer even below the mobile layout breakpoint.
    test.use({
      viewport: { width, height: width < 800 ? 844 : 960 },
      hasTouch: width < 768,
      isMobile: width < 768,
    });
    test('direct-message bubbles retain opposite sides and the shared column in both themes', async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await demo(page);
      await verify(page, 'light', info);
      await verify(page, 'dark', info);
      const media = main(page).locator('#message-dm-media');
      await expect(media.locator('img')).toHaveJSProperty('naturalWidth', 1);
      await expect
        .poll(() =>
          media.locator('audio').evaluate((node) => (node as HTMLAudioElement).readyState),
        )
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(() => media.locator('audio').evaluate((node) => (node as HTMLAudioElement).duration))
        .toBeGreaterThan(0);
      await media.getByRole('button', { name: 'Play voice message', exact: true }).click();
      await expect
        .poll(() =>
          media.locator('audio').evaluate((node) => (node as HTMLAudioElement).currentTime),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          media.locator('audio').evaluate((node) => (node as HTMLAudioElement).readyState),
        )
        .toBeGreaterThanOrEqual(2);
      expect(
        await media.locator('audio').evaluate((node) => (node as HTMLAudioElement).error),
      ).toBeNull();
      if (!(await media.locator('audio').evaluate((node) => (node as HTMLAudioElement).paused))) {
        await media.getByRole('button', { name: 'Pause voice message', exact: true }).click();
        await expect(media.locator('audio')).toHaveJSProperty('paused', true);
      }
      await expect(media.getByRole('link', { name: /W{20}/ })).toHaveAttribute(
        'download',
        'W'.repeat(115) + '.txt',
      );
      await expect(media.locator('.message-text')).toBeHidden();
    });
  });

for (const width of [390, 3440])
  test.describe(`actions ${width}px`, () => {
    test.use({
      viewport: { width, height: width < 800 ? 844 : 960 },
      hasTouch: width < 800,
      isMobile: width < 800,
    });
    test('outgoing DM edit, star, reaction and delete remain usable', async ({ page }) => {
      await demo(page);
      const menu = async () => {
        await ownRow(page).hover();
        await ownRow(page).getByRole('button', { name: 'More actions', exact: true }).click();
        return page.getByRole('dialog');
      };
      await (await menu()).getByRole('button', { name: 'Star message', exact: true }).click();
      await expect(ownRow(page).locator('.message-meta .star-fill')).toHaveCount(1);
      await ownRow(page)
        .getByRole('button', { name: '👍, 1 reaction. Toggle your reaction.', exact: true })
        .click();
      await expect(ownRow(page).locator('.reaction-list')).toHaveCount(0);
      await (await menu()).getByRole('button', { name: 'Edit message', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Edited outgoing DM');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(ownRow(page).locator('.message-text')).toHaveText('Edited outgoing DM');
      await expect(ownRow(page).locator('.edited')).toBeVisible();
      await (await menu()).getByRole('button', { name: 'Delete message', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete message', exact: true })
        .click();
      await expect(
        ownRow(page).getByText('This message was deleted', { exact: true }),
      ).toBeVisible();
      await expect(ownRow(page).locator('.message-actions')).toHaveCount(0);
    });
  });

test('DM pop-up gets its own presentation while threads and spaces keep theirs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await demo(page);
  await main(page).getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
  const mini = page.getByRole('region', { name: 'Mini conversation: Maya Chen', exact: true });
  const miniOwn = mini.locator('#mini-message-dm-own');
  await expect(miniOwn).toHaveClass(/dm-own/);
  await expect(miniOwn.locator(':scope > .avatar')).toHaveCount(0);
  const compactBounds = await mini.evaluate((element) => {
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, right: r.right };
    };
    return {
      panel: box(element),
      media: [...element.querySelectorAll('#mini-message-dm-media .message-attachments > div')].map(
        (node) => ({ ...box(node), body: box(node.closest('.message-body')!) }),
      ),
      text: [...element.querySelectorAll('#mini-message-dm-long .message-text')].map((node) => ({
        ...box(node),
        client: node.clientWidth,
        scroll: node.scrollWidth,
      })),
    };
  });
  expect(compactBounds.media).toHaveLength(3);
  expect(compactBounds.text).toHaveLength(1);
  for (const media of compactBounds.media) {
    expect(media.x).toBeGreaterThanOrEqual(media.body.x - 1);
    expect(media.right).toBeLessThanOrEqual(media.body.right + 1);
    expect(media.right).toBeLessThanOrEqual(compactBounds.panel.right);
  }
  for (const text of compactBounds.text) {
    expect(text.scroll).toBeLessThanOrEqual(text.client + 1);
    expect(text.right).toBeLessThanOrEqual(compactBounds.panel.right);
  }
  await page
    .getByRole('complementary', { name: 'Chat navigation' })
    .getByRole('button', { name: 'Design team', exact: true })
    .click();
  await expect(main(page).locator('.message.dm-message')).toHaveCount(0);
  await expect(miniOwn).toHaveClass(/dm-own/);
  await mini.getByRole('button', { name: 'Close pop-up', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Chat navigation' })
    .getByRole('button', { name: 'Maya Chen', exact: true })
    .click();
  await ownRow(page).hover();
  await ownRow(page).getByRole('button', { name: 'Reply in thread', exact: true }).click();
  const thread = page.locator('.thread-panel');
  await expect(thread.getByRole('article').first()).not.toHaveClass(/dm-message/);
  await expect(thread.getByRole('article').first().locator(':scope > .avatar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close thread', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search in chat', exact: true });
  await search.fill('Own direct message');
  await search.press('Enter');
  const result = main(page).getByRole('button', {
    name: /^Message from Alex Morgan in Maya Chen: Own direct message/,
  });
  await expect(result).toBeVisible();
  await expect(result.locator(':scope > .avatar')).toHaveCount(1);
  await expect(result).not.toHaveClass(/dm-message/);
});
