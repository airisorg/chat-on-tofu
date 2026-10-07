import { expect, test, type Locator, type Page, type TestInfo } from './coverage-test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import type { ChatState, Message } from '../src/lib/types';
import { evidenceDirectory } from './browser-config';

// This is a cross-view app density contract, not an observed Google Starred oracle.
const marker = 'Densityfixture';
const home = (page: Page) => page.locator('.home-view');
const messageRows = (page: Page) =>
  home(page).locator('button.search-result[aria-label^="Message from "]');
function fixtureState(): ChatState {
  const state = createDemoState();
  const design = state.conversations.find((c) => c.id === 'demo-design')!;
  const launch = state.conversations.find((c) => c.id === 'demo-launch')!;
  const maya = design.members.find((p) => p.id !== state.user.id)!;
  const longAuthor = {
    ...maya,
    id: 'density-long-author',
    name: 'Taylor ' + 'W'.repeat(73),
    email: 'density-long@example.com',
  };
  design.name = 'Density room';
  launch.name = marker + ' ' + 'W'.repeat(65);
  for (const c of [design, launch]) {
    c.unread = 0;
    c.pinned = false;
    c.updatedAt = '2026-10-05T11:30:00.000Z';
    c.lastMessage = 'A compact Home preview';
    c.members.push(longAuthor);
  }
  state.conversations = [design, launch];
  const file = (suffix: string) => ({
    name: marker + '-' + 'W'.repeat(120 - marker.length - suffix.length - 1) + suffix,
    type: 'text/plain',
    size: 5,
    url: 'data:text/plain;base64,aGVsbG8=',
  });
  const message = (
    id: string,
    conversationId: string,
    text: string,
    createdAt: string,
    files = false,
  ): Message => ({
    id,
    conversationId,
    author: conversationId === launch.id ? longAuthor : maya,
    text,
    createdAt,
    reactions: [],
    attachments: files ? [file('-a.txt'), file('-b.txt')] : [],
    starred: true,
  });
  state.messages = [
    message('density-short', design.id, marker + ' brief @Alex', '2026-10-05T11:05:00.000Z'),
    message(
      'density-long',
      launch.id,
      (marker + ' @Alex ' + 'W'.repeat(6000)).slice(0, 5989) + '\nFinal line',
      '2025-01-01T07:05:00.000Z',
    ),
    message(
      'density-mixed',
      design.id,
      marker + ' @Alex with two picked files',
      '2026-10-04T08:15:00.000Z',
      true,
    ),
    message('density-files', launch.id, '', '2025-03-02T09:45:00.000Z', true),
    {
      ...message(
        'density-reply',
        design.id,
        marker + ' @Alex exact thread child',
        '2026-10-05T11:25:00.000Z',
      ),
      parentId: 'density-short',
    },
  ];
  for (const [i, root] of state.messages.slice(1, 4).entries())
    state.messages.push({
      ...message(
        'density-support-' + i,
        root.conversationId,
        'Supporting thread reply ' + i,
        '2026-10-05T11:35:00.000Z',
      ),
      author: state.user,
      parentId: root.id,
      starred: false,
    });
  return state;
}
async function navigate(page: Page, name: string) {
  const closeThread = page.getByRole('button', { name: 'Close thread', exact: true });
  if (await closeThread.isVisible()) await closeThread.click();
  const back = page.getByRole('button', { name: 'Back to conversations', exact: true });
  if (await back.isVisible()) await back.click();
  const desktop = page.getByRole('complementary', { name: 'Chat navigation', exact: true });
  if (await desktop.isVisible()) {
    await desktop.getByRole('button', { name, exact: true }).click();
    return;
  }
  const mobile = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  if (name === 'Home') await mobile.getByRole('button', { name, exact: true }).click();
  else {
    await mobile.getByRole('button', { name: 'More', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'More in Chat', exact: true })
      .getByRole('button', { name, exact: true })
      .click();
  }
}
async function start(page: Page, theme: 'light' | 'dark') {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00.000Z') });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('relay-theme', 'system');
    },
    { key: DEMO_STORAGE_KEY, state: fixtureState() },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await navigate(page, 'Home');
  await page.evaluate(() => document.fonts.ready);
}
async function rect(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}
async function captureRows(page: Page, rows: Locator, info: TestInfo, name: string) {
  const directory = evidenceDirectory(
    info,
    info.project.name + '/' + info.titlePath.join('-').replace(/[^a-z0-9]+/gi, '-'),
  );
  mkdirSync(directory, { recursive: true });
  await rows.first().evaluate((element) => {
    const list = element.closest('.conversation-list');
    if (list)
      list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top;
  });
  await expect(rows.first()).toBeInViewport();
  const bounds = await Promise.all((await rows.all()).map(rect));
  writeFileSync(join(directory, name + '-bounds.json'), JSON.stringify(bounds, null, 2));
  const first = bounds[0];
  const last = bounds[Math.min(2, bounds.length - 1)];
  const viewport = page.viewportSize()!;
  const clip = {
    x: Math.max(0, first.x),
    y: Math.max(0, first.y),
    width: Math.min(first.width, viewport.width - Math.max(0, first.x)),
    height: Math.min(last.y + last.height - first.y, viewport.height - first.y),
  };
  await page.screenshot({
    path: join(directory, name + '.png'),
    clip,
    animations: 'disabled',
    caret: 'hide',
  });
  return clip;
}

type Surface = 'Starred' | 'Mentions' | 'Search' | 'Threads';
async function showSurface(page: Page, surface: Surface) {
  if (surface === 'Starred' || surface === 'Mentions') await navigate(page, surface);
  else {
    await navigate(page, 'Home');
    if (surface === 'Threads')
      await home(page).getByRole('checkbox', { name: 'Threads', exact: true }).click();
    else {
      const field = page.getByRole('textbox', { name: /^(Search in chat|Search conversations)$/ });
      await field.fill(marker);
      await expect(
        home(page).getByRole('heading', { name: 'Search results', exact: true }),
      ).toBeVisible();
    }
  }
  await home(page)
    .locator('.conversation-list')
    .evaluate((element) => {
      element.scrollTop = 0;
    });
}
function accessibleMessage(state: ChatState, message: Message): string {
  const conversation = state.conversations.find((c) => c.id === message.conversationId)!;
  return (
    'Message from ' +
    message.author.name +
    ' in ' +
    conversation.name +
    ': ' +
    (message.text || message.attachments.map((file) => file.name).join(', '))
  );
}
async function checkDensity(
  page: Page,
  row: Locator,
  baseline: { x: number; y: number; width: number; height: number },
  avatarSize: number,
  textInset: number,
) {
  await row.scrollIntoViewIfNeeded();
  const bounds = await rect(row);
  expect(
    bounds.height,
    'Result row preserves a minimum44px interaction target independently of Home',
  ).toBeGreaterThanOrEqual(44);
  expect(
    Math.abs(bounds.height - baseline.height),
    'Result and Home row heights at identical viewport',
  ).toBeLessThanOrEqual(1);
  const avatar = await rect(row.locator('.avatar,.space-avatar').first());
  expect(Math.abs(avatar.width - avatarSize)).toBeLessThanOrEqual(1);
  expect(Math.abs(avatar.height - avatarSize)).toBeLessThanOrEqual(1);
  expect(Math.abs(avatar.y + avatar.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(
    1,
  );
  const strong = row.locator('strong');
  await expect(strong).toHaveCount(1);
  const body = await rect(strong);
  expect(Math.abs(body.x - bounds.x - textInset), 'Shared avatar/text column').toBeLessThanOrEqual(
    1,
  );
  expect(
    body.height,
    'One line preview even for embedded newlines and file names',
  ).toBeLessThanOrEqual(21);
  const styles = await strong.evaluate((element) => ({
    fontSize: getComputedStyle(element).fontSize,
    lineHeight: getComputedStyle(element).lineHeight,
  }));
  expect(styles).toEqual({ fontSize: '14px', lineHeight: '20px' });
  expect(
    await row.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await row.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
    'Row receives actual pointer at its center',
  ).toBe(true);
}
async function checkMessageMetadata(page: Page, row: Locator, state: ChatState) {
  const label = await row.getAttribute('aria-label');
  const message = state.messages.find((item) => accessibleMessage(state, item) === label);
  expect(message, 'Every rendered row corresponds to one exact fixture message').toBeDefined();
  const m = message!;
  expect(await row.locator('strong').textContent()).toBe(
    m.text || m.attachments.map((file) => file.name).join(', '),
  );
  await expect(row).toHaveAccessibleName(accessibleMessage(state, m));
  const date = row.locator('time');
  await expect(date).toHaveCount(1);
  await expect(date).toHaveAttribute('datetime', m.createdAt);
  const compactDates: Record<string, string> = {
    'density-short': '11:05 AM',
    'density-long': 'Jan 1, 2025',
    'density-mixed': 'Oct 4',
    'density-files': 'Mar 2, 2025',
    'density-reply': '11:25 AM',
  };
  await expect(date).toHaveText(compactDates[m.id]);
  const fullDate = await page.evaluate(
    (iso) =>
      new Date(iso).toLocaleString([], {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    m.createdAt,
  );
  await expect(date).toHaveAttribute('title', fullDate);
  const description =
    fullDate +
    (m.attachments.length
      ? '; Attachments: ' + m.attachments.map((file) => file.name).join(', ')
      : '');
  await expect(row).toHaveAccessibleDescription(description);
  const context = row.locator('.search-result-context');
  await expect(context).toHaveCount(1);
  expect(await context.textContent()).toBe(
    m.author.name + ' · ' + state.conversations.find((c) => c.id === m.conversationId)!.name,
  );
  const contextRect = await rect(context),
    dateRect = await rect(date);
  expect(contextRect.height).toBeLessThanOrEqual(21);
  expect(dateRect.height).toBeLessThanOrEqual(21);
  expect(Math.abs(contextRect.y - dateRect.y), 'Date shares the context line').toBeLessThanOrEqual(
    1,
  );
  expect(contextRect.x + contextRect.width, 'Date cannot overlap context text').toBeLessThanOrEqual(
    dateRect.x,
  );
  const badge = row.locator('.search-result-files');
  if (m.text && m.attachments.length) {
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText(String(m.attachments.length));
    await expect(badge).toHaveAttribute('title', m.attachments.map((file) => file.name).join(', '));
    const badgeRect = await rect(badge),
      previewRect = await rect(row.locator('strong'));
    expect(Math.abs(badgeRect.y - previewRect.y)).toBeLessThanOrEqual(1);
    expect(previewRect.x + previewRect.width).toBeLessThanOrEqual(badgeRect.x);
  } else await expect(badge).toHaveCount(0);
}
async function rowFor(page: Page, id: string) {
  const state = fixtureState();
  return home(page).getByRole('button', {
    name: accessibleMessage(
      state,
      state.messages.find((message) => message.id === id)!,
    ),
    exact: true,
  });
}

for (const size of [
  { width: 1440, height: 960, touch: false },
  { width: 3440, height: 1100, touch: false },
  { width: 768, height: 900, touch: false },
  { width: 799, height: 900, touch: false },
  { width: 390, height: 844, touch: true },
  { width: 320, height: 568, touch: true },
  { width: 844, height: 390, touch: true },
]) {
  for (const theme of ['light', 'dark'] as const)
    test.describe(size.width + 'x' + size.height + ' ' + theme, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
      });
      test('Populated result rows match Home density and preserve original content', async ({
        page,
      }, info) => {
        await start(page, theme);
        const originalRows = home(page).locator('.conversation-row');
        await expect(originalRows).toHaveCount(2);
        const baseline = await rect(originalRows.first());
        const avatar = await rect(originalRows.first().locator('.avatar,.space-avatar').first());
        if (!size.touch && size.width >= 800) {
          expect(baseline.height).toBe(60);
          expect(avatar.width).toBe(40);
        }
        const textInset =
          (await rect(originalRows.first().locator('.conversation-row-content > strong'))).x -
          baseline.x;
        const nextHome = await rect(originalRows.nth(1));
        const homeRhythm = nextHome.y - baseline.y;
        if (!size.touch && size.width >= 800) expect(homeRhythm).toBe(62);
        const expectedCounts: Record<Surface, number> = {
          Starred: 5,
          Mentions: 4,
          Search: 5,
          Threads: 4,
        };
        for (const surface of ['Starred', 'Mentions', 'Search', 'Threads'] as const) {
          await showSurface(page, surface);
          const rows = messageRows(page);
          await expect(rows).toHaveCount(expectedCounts[surface]);
          // Keep before-assertion evidence when a first-red density check fails.
          await captureRows(page, rows, info, surface.toLowerCase() + '-before-assertions');
          for (const row of await rows.all()) {
            await checkDensity(page, row, baseline, avatar.width, textInset);
            await checkMessageMetadata(page, row, fixtureState());
          }
          const positions = await rows.evaluateAll((elements) =>
            elements.map((element) => (element as HTMLElement).offsetTop),
          );
          for (let index = 1; index < positions.length; index++)
            expect(
              Math.abs(positions[index] - positions[index - 1] - homeRhythm),
              'Cross-view row rhythm matches Home',
            ).toBeLessThanOrEqual(1);
          if (surface === 'Search') {
            const conversations = home(page).locator(
              'button.search-result:not([aria-label^="Message from "])',
            );
            await expect(conversations).toHaveCount(1);
            await checkDensity(page, conversations.first(), baseline, avatar.width, textInset);
            expect(await conversations.first().locator('strong').textContent()).toBe(
              fixtureState().conversations[1].name,
            );
            await expect(conversations.first().locator('small')).toHaveText(
              'A compact Home preview',
            );
          }
        }
        // Exact-result navigation remains functional after truncating its visual preview.
        await showSurface(page, 'Starred');
        await (await rowFor(page, 'density-short')).click();
        const short = page.locator('.messages-scroll #message-density-short');
        await expect(short).toHaveCount(1);
        await expect(short).toBeInViewport();
        await showSurface(page, 'Starred');
        await (await rowFor(page, 'density-reply')).click();
        await expect(page.locator('.thread-panel #message-density-short')).toHaveCount(1);
        await expect(page.locator('.thread-panel #message-density-reply')).toHaveCount(1);
        await expect(page.locator('.thread-panel #message-density-reply')).toBeInViewport();
        await showSurface(page, 'Starred');
        await (await rowFor(page, 'density-files')).click();
        const fileArticle = page.locator('.messages-scroll #message-density-files');
        await expect(fileArticle).toHaveCount(1);
        await expect(fileArticle).toBeInViewport();
        for (const file of fixtureState().messages.find(
          (message) => message.id === 'density-files',
        )!.attachments) {
          const original = fileArticle.locator('a').filter({ hasText: file.name });
          await expect(original).toHaveCount(1);
          await expect(original).toHaveAttribute('download', file.name);
        }
        await showSurface(page, 'Starred');
        await (await rowFor(page, 'density-long')).click();
        const longArticle = page.locator('.messages-scroll #message-density-long');
        await expect(longArticle).toHaveCount(1);
        await expect(longArticle).toBeInViewport();
        expect(await longArticle.locator('.message-text').textContent()).toBe(
          fixtureState().messages.find((message) => message.id === 'density-long')!.text,
        );
        await showSurface(page, 'Threads');
        await (await rowFor(page, 'density-mixed')).click();
        await expect(page.locator('.thread-panel #message-density-mixed')).toHaveCount(1);
        await showSurface(page, 'Search');
        await home(page).locator('button.search-result:not([aria-label^="Message from "])').click();
        await expect(page.locator('.conversation-header .conversation-title > strong')).toHaveText(
          fixtureState().conversations[1].name,
        );
        // Real committed app goldens are created only after all semantic geometry gates.
        // Each crop contains the first three populated rows, not a mostly empty pane.
        for (const surface of ['Starred', 'Mentions', 'Search', 'Threads'] as const) {
          await showSurface(page, surface);
          const clip = await captureRows(
            page,
            messageRows(page),
            info,
            surface.toLowerCase() + '-final',
          );
          await expect(page).toHaveScreenshot(
            'results-' +
              surface.toLowerCase() +
              '-' +
              size.width +
              'x' +
              size.height +
              '-' +
              theme +
              '.png',
            { clip },
          );
        }
        await showSurface(page, 'Starred');
        const fileOnlyClip = await captureRows(
          page,
          await rowFor(page, 'density-files'),
          info,
          'starred-file-only-final',
        );
        await expect(page).toHaveScreenshot(
          'results-starred-file-only-' + size.width + 'x' + size.height + '-' + theme + '.png',
          { clip: fileOnlyClip },
        );
      });
    });
}
