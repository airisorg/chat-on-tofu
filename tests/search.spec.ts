import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import type { Message } from '../src/lib/types';
import { isStoredDemoState } from '../src/lib/demo-storage';

const main = (page: Page) => page.getByRole('main');
const results = (page: Page) => main(page).locator('button.search-result');
const filter = (page: Page, title: string) =>
  main(page).getByRole('button', { name: new RegExp(`^${title} filter`) });
const menu = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true });
const marker = 'Searchfixture';
const identityMarker = 'Identityfixture';
const duplicatePersonName = 'Taylor Lee';
const duplicateConversationName = 'Shared project';

async function choose(page: Page, title: string, option: string) {
  await filter(page, title).click();
  await menu(page, title)
    .getByRole('button', {
      name: new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    })
    .click();
  await expect(menu(page, title)).toHaveCount(0);
}
async function query(page: Page, text: string, phone = false) {
  await page
    .getByRole('textbox', {
      name: phone ? 'Search conversations' : 'Search in chat',
      exact: true,
    })
    .fill(text);
  await expect(
    main(page).getByRole('heading', { name: 'Search results', exact: true }),
  ).toBeVisible();
}
async function contrast(nodes: Locator) {
  const values = await nodes.evaluateAll((elements) =>
    elements
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => {
        let parent: Element | null = element,
          background = '';
        while (parent) {
          background = getComputedStyle(parent).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
          parent = parent.parentElement;
        }
        return {
          foreground: getComputedStyle(element).color,
          background,
          label: element.textContent,
        };
      }),
  );
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    const a = luminance(value.foreground),
      b = luminance(value.background);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      value.label || 'filter text',
    ).toBeGreaterThanOrEqual(4.5);
  }
}

test.beforeEach(async ({ page }) => {
  const state = createDemoState();
  const [self, maya, jordan, sam] = state.conversations[0].members;
  const day = 86400000;
  const create = (
    id: string,
    text: string,
    days: number,
    extra: Partial<Message> = {},
  ): Message => ({
    id,
    text: `${marker} ${text}`,
    createdAt: new Date(Date.now() - days * day).toISOString(),
    conversationId: 'demo-design',
    author: maya,
    reactions: [],
    attachments: [],
    ...extra,
  });
  const image = {
    name: 'review.png',
    type: 'image/png',
    size: 68,
    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZkAAAAASUVORK5CYII=',
  };
  state.messages.push(
    create('search-match', 'project review @Alex WWW.example.com/report', 400, {
      attachments: [image],
    }),
    create('search-newest', 'review for the project', 0),
    create('search-text', 'notes', 1, {
      author: jordan,
      attachments: [
        {
          name: 'notes.txt',
          type: 'text/plain',
          size: 5,
          url: 'data:text/plain;base64,aGVsbG8=',
        },
      ],
    }),
    create('search-pdf', 'proposal', 40, {
      author: sam,
      conversationId: 'demo-launch',
      attachments: [
        {
          name: 'proposal.pdf',
          type: 'application/pdf',
          size: 4,
          url: 'data:application/pdf;base64,JVBERg==',
        },
      ],
    }),
    create('search-audio', 'recorded update', 10, {
      attachments: [
        {
          name: 'recording.m4a',
          type: 'audio/mp4',
          size: 4,
          url: 'data:audio/mp4;base64,AAAAAA==',
        },
      ],
    }),
    create('search-no-mention', 'project review https://example.com/report', 400, {
      attachments: [image],
    }),
    create('search-dm', 'project review @Alex https://example.com/report', 400, {
      conversationId: 'demo-maya-dm',
      attachments: [image],
    }),
    create('search-deleted', 'deleted project review', 0, {
      deleted: true,
      author: self,
    }),
  );
  // Equal display labels are legal; filters must retain the underlying IDs.
  const firstPerson = {
    id: 'same-name-first',
    name: duplicatePersonName,
    email: 'first.taylor@example.test',
  };
  const secondPerson = {
    id: 'same-name-second',
    name: duplicatePersonName,
    email: 'second.taylor@example.test',
  };
  for (const kind of ['space', 'group'] as const) {
    const conversationId = `same-name-${kind}`;
    state.conversations.push({
      id: conversationId,
      name: duplicateConversationName,
      kind,
      members: [self, firstPerson, secondPerson],
      updatedAt: '2026-10-05T11:00:00.000Z',
      unread: 0,
    });
    for (const [identity, person] of [
      ['first', firstPerson],
      ['second', secondPerson],
    ] as const) {
      state.messages.push({
        id: `identity-${identity}-${kind}`,
        conversationId,
        author: person,
        text: `${identityMarker} ${identity} ${kind}`,
        createdAt: '2026-10-05T11:00:00.000Z',
        reactions: [],
        attachments: [],
      });
    }
  }
  expect(
    isStoredDemoState(state),
    'Search fixture must satisfy the stored-demo contract, including exact attachment byte sizes',
  ).toBe(true);
  await page.addInitScript(
    ({ state, key }) => {
      localStorage.setItem(key, JSON.stringify(state));
    },
    { state, key: DEMO_STORAGE_KEY },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
});

test('same-name people remain distinct through search, selection and menu reopen', async ({
  page,
}) => {
  const keyWarnings: string[] = [];
  page.on('console', (message) => {
    if (/same key|unique.*key|duplicate.*key/i.test(message.text()))
      keyWarnings.push(message.text());
  });
  await query(page, identityMarker);
  await expect(results(page)).toHaveCount(4);
  for (const identity of ['first', 'second'] as const) {
    await filter(page, 'From').click();
    const people = menu(page, 'From');
    const find = people.getByRole('textbox', { name: 'Find a person', exact: true });
    await find.fill(`${identity}.taylor@example.test`);
    await expect(people.getByRole('button').filter({ hasText: duplicatePersonName })).toHaveCount(
      1,
    );
    await find.fill(duplicatePersonName);
    await expect(people.getByRole('button').filter({ hasText: duplicatePersonName })).toHaveCount(
      2,
    );
    const option = people.getByRole('button').filter({
      has: page.locator('small', { hasText: `${identity}.taylor@example.test` }),
    });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(people).toHaveCount(0);
    await expect(results(page)).toHaveCount(2);
    await expect
      .poll(async () => (await results(page).locator('strong').allTextContents()).sort())
      .toEqual([`${identityMarker} ${identity} group`, `${identityMarker} ${identity} space`]);
    await filter(page, 'From').click();
    await expect(
      people.getByRole('button').filter({
        has: page.locator('small', { hasText: `${identity}.taylor@example.test` }),
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    const other = identity === 'first' ? 'second' : 'first';
    await expect(
      people.getByRole('button').filter({
        has: page.locator('small', { hasText: `${other}.taylor@example.test` }),
      }),
    ).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
  }
  expect(keyWarnings).toEqual([]);
});

test('same-name conversations select their own message IDs and retain the checked option', async ({
  page,
}) => {
  const keyWarnings: string[] = [];
  page.on('console', (message) => {
    if (/same key|unique.*key|duplicate.*key/i.test(message.text()))
      keyWarnings.push(message.text());
  });
  await query(page, identityMarker);
  await expect(results(page)).toHaveCount(4);
  for (const [kind, label] of [
    ['space', 'Space'],
    ['group', 'Group'],
  ] as const) {
    await filter(page, 'Said in').click();
    const places = menu(page, 'Said in');
    await places
      .getByRole('textbox', { name: 'Find a conversation', exact: true })
      .fill(duplicateConversationName);
    await expect(
      places.getByRole('button').filter({ hasText: duplicateConversationName }),
    ).toHaveCount(2);
    const option = places.getByRole('button').filter({
      hasText: duplicateConversationName,
      has: page.locator('small', { hasText: new RegExp(`^${label}$`) }),
    });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(places).toHaveCount(0);
    await expect(results(page)).toHaveCount(2);
    await expect
      .poll(async () => (await results(page).locator('strong').allTextContents()).sort())
      .toEqual([`${identityMarker} first ${kind}`, `${identityMarker} second ${kind}`]);
    await filter(page, 'Said in').click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(
      places.getByRole('button').filter({
        hasText: duplicateConversationName,
        has: page.locator('small', {
          hasText: new RegExp(`^${kind === 'space' ? 'Group' : 'Space'}$`),
        }),
      }),
    ).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
  }
  expect(keyWarnings).toEqual([]);
});

test('combined person/conversation/image/link/mention/date filters return only matching accessible messages and reset', async ({
  page,
}, testInfo) => {
  await query(page, marker);
  await expect(results(page)).toHaveCount(7);
  await choose(page, 'From', 'Maya Chen');
  await choose(page, 'Said in', 'Design team');
  await choose(page, 'Has file', 'Image');
  await main(page).getByRole('button', { name: 'Has link', exact: true }).click();
  await main(page).getByRole('button', { name: 'Mentions me', exact: true }).click();
  await choose(page, 'Date', 'Older than a year');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('project review @Alex');
  const avatar = await results(page).first().locator('.avatar').boundingBox();
  expect(avatar!.width).toBeLessThanOrEqual(44);
  expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThanOrEqual(1);
  await main(page).screenshot({
    path: testInfo.outputPath('desktop-filter-combination.png'),
  });
  await main(page).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(results(page)).toHaveCount(7);
  await expect(main(page).getByRole('button', { name: 'Has link', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('date presets and inclusive custom dates work with validated ranges', async ({ page }) => {
  await query(page, marker);
  for (const [label, count] of [
    ['Older than a week', 5],
    ['Older than a month', 4],
    ['Older than a year', 3],
  ] as const) {
    await choose(page, 'Date', label);
    await expect(results(page)).toHaveCount(count);
  }
  await filter(page, 'Date').click();
  const dates = menu(page, 'Date');
  await dates.getByRole('button', { name: 'Custom range', exact: true }).click();
  const local = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  await dates.getByLabel('On or after', { exact: true }).fill(local(0));
  await dates.getByLabel('On or before', { exact: true }).fill(local(-1));
  await dates.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(dates.getByRole('alert')).toContainText('end date');
  await dates.getByLabel('On or before', { exact: true }).fill(local(0));
  await dates.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(dates).toHaveCount(0);
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('review for the project');
});

test('local relevance, filename/media filters and existing conversation search scope remain functional', async ({
  page,
}) => {
  await query(page, 'Design team');
  const spaceResult = results(page).filter({ has: page.locator('.space-avatar') });
  await expect(spaceResult).toHaveCount(1);
  const spaceAvatar = await spaceResult.locator('.space-avatar').boundingBox();
  expect(spaceAvatar!.width).toBeLessThanOrEqual(44);
  expect(Math.abs(spaceAvatar!.width - spaceAvatar!.height)).toBeLessThanOrEqual(1);
  await query(page, 'project review');
  await expect(results(page).first()).toContainText('review for the project');
  await main(page)
    .getByRole('button', { name: /^Sort results:/ })
    .click();
  await menu(page, 'Sort results').getByRole('button', { name: 'Relevance', exact: true }).click();
  await expect(results(page).first()).toContainText('project review @Alex');
  await choose(page, 'Has file', 'PDF');
  await expect(
    main(page).getByRole('heading', {
      name: 'No matching messages',
      exact: true,
    }),
  ).toBeVisible();
  await query(page, 'proposal.pdf');
  await expect(results(page)).toHaveCount(1);
  await results(page).first().click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await main(page).getByRole('button', { name: 'Search this conversation', exact: true }).click();
  await expect(filter(page, 'Said in')).toHaveAccessibleName(
    'Said in filter, Said in: Product launch',
  );
  await query(page, marker);
  await expect(results(page)).toHaveCount(1);
  await choose(page, 'From', 'Sam Rivera');
  await expect(results(page)).toHaveCount(1);
  await main(page).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(results(page)).toHaveCount(7);
  for (const [kind, count] of [
    ['Audio', 1],
    ['Text file', 1],
    ['Any file', 6],
    ['Any message', 7],
  ] as const) {
    await choose(page, 'Has file', kind);
    await expect(results(page)).toHaveCount(count);
  }
});

test.describe('phone search', () => {
  test.use({
    viewport: { width: 390, height: 460 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  test('dark compact menus fit the visible phone, scroll filters, preserve scope on empty query and restore focus', async ({
    page,
  }, testInfo) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await query(page, marker, true);
    const filters = main(page).getByRole('group', {
      name: 'Search filters',
      exact: true,
    });
    const required = [
      'From filter',
      'Said in filter',
      'Date filter',
      'Has file filter',
      'Has link',
      'Mentions me',
      'Sort results: Most recent',
    ];
    await expect(filters.getByRole('button')).toHaveCount(required.length);
    await expect(filters.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(
      0,
    );
    for (const name of required) {
      const button = filters.getByRole('button', { name, exact: true });
      await expect(button).toHaveCount(1);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await filters.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(overflow).toBeTruthy();
    await contrast(filters.locator('button'));
    const opener = filter(page, 'From');
    await opener.click();
    const people = menu(page, 'From');
    await expect(people).toHaveAttribute('aria-modal', 'false');
    await expect(people.getByRole('textbox', { name: 'Find a person', exact: true })).toHaveCSS(
      'font-size',
      '16px',
    );
    const bounds = await people.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(12);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(378);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(448);
    await contrast(people.locator('button, small, input'));
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await choose(page, 'Said in', 'Design team');
    await page.getByRole('textbox', { name: 'Search conversations', exact: true }).fill('');
    await expect(
      main(page).getByRole('heading', { name: 'Search results', exact: true }),
    ).toBeVisible();
    await expect(filter(page, 'Said in')).toHaveAccessibleName(
      'Said in filter, Said in: Design team',
    );
    await main(page)
      .getByRole('button', { name: 'Mentions me', exact: true })
      .scrollIntoViewIfNeeded();
    await main(page).getByRole('button', { name: 'Mentions me', exact: true }).click();
    await expect(filters.getByRole('button')).toHaveCount(required.length + 1);
    const clear = filters.getByRole('button', { name: 'Clear filters', exact: true });
    await expect(clear).toHaveCount(1);
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await contrast(filters.locator('button'));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBeTruthy();
    await expect(page.locator('.mobile-new-chat')).toHaveCount(0);
    const avatar = await results(page).first().locator('.avatar').boundingBox();
    expect(avatar!.width).toBeLessThanOrEqual(44);
    expect(Math.abs(avatar!.width - avatar!.height)).toBeLessThanOrEqual(1);
    await main(page).screenshot({
      path: testInfo.outputPath('phone-dark-search.png'),
    });
  });
});

for (const preference of ['reduce', 'no-preference'] as const) {
  test(`message-result jump uses ${preference === 'reduce' ? 'immediate' : 'smooth'} scrolling for the motion preference`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: preference });
    await page.evaluate(() => {
      const record = window as unknown as {
        messageScrollCalls: { id: string; behavior?: ScrollBehavior }[];
      };
      record.messageScrollCalls = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        record.messageScrollCalls.push({
          id: this.id,
          behavior: typeof options === 'object' ? options.behavior : undefined,
        });
        return original.call(this, options);
      };
    });
    await query(page, marker);
    const target = results(page).filter({ hasText: 'project review @Alex WWW.example.com/report' });
    await expect(target).toHaveCount(1);
    await target.click();
    const message = page.locator('#message-search-match');
    await expect(message).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { messageScrollCalls: { id: string; behavior?: ScrollBehavior }[] }
          ).messageScrollCalls
            .filter((call) => call.id === 'message-search-match')
            .map((call) => call.behavior),
        ),
      )
      .toEqual([preference === 'reduce' ? 'auto' : 'smooth']);
    await expect(message).toBeInViewport();
  });
}
