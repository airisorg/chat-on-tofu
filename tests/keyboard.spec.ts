import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';

// Keep this contract mobile even when included by the shared desktop/platform
// configuration; the stable layout viewport is part of these test fixtures.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Controlled visualViewport API/layout contracts in desktop browser engines.
// Unlike page.setViewportSize, these simulate a stable layout viewport with a
// smaller, vertically panned visual viewport, including scroll-only events.
// They do not emulate an OS keyboard or prove physical iPhone/Android behavior.
type ViewportUpdate = {
  height: number;
  offsetTop?: number;
  scale?: number;
  event?: 'resize' | 'scroll';
};
declare global {
  interface Window {
    keyboardViewport: (update: ViewportUpdate) => void;
  }
}

const main = (page: Page) => page.getByRole('main');
const thread = (page: Page) =>
  page.getByRole('complementary').filter({
    has: page.getByRole('heading', { name: 'Thread', exact: true }),
  });
const fixtureRoot = 'Keyboard fixture thread anchor';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return route.continue();
    return route.abort('blockedbyclient');
  });
  const state = createDemoState();
  const message = state.messages.find((m) => m.id === 'demo-message-5')!;
  for (let index = 0; index < 60; index++) {
    state.messages.push({
      ...message,
      id: `keyboard-main-${index}`,
      text: `Earlier conversation ${index + 1}: a deliberately long line of synthetic content for scroll retention.`,
      createdAt: new Date(Date.now() - (61 - index) * 60_000).toISOString(),
      reactions: [],
      attachments: [],
    });
  }
  state.messages.push({
    ...message,
    id: 'keyboard-root',
    text: fixtureRoot,
    reactions: [],
    attachments: [],
  });
  for (let index = 0; index < 30; index++) {
    state.messages.push({
      ...message,
      id: `keyboard-thread-${index}`,
      parentId: 'keyboard-root',
      text: `Earlier thread reply ${index + 1}: more synthetic scrollable history.`,
      reactions: [],
      attachments: [],
    });
  }
  await page.addInitScript(
    ({ state, key }) => {
      localStorage.setItem(key, JSON.stringify(state));
      const viewport = Object.assign(new EventTarget(), {
        width: 390,
        height: 844,
        scale: 1,
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.keyboardViewport = (update) => {
        viewport.height = update.height;
        viewport.offsetTop = update.offsetTop ?? 0;
        viewport.pageTop = viewport.offsetTop + window.scrollY;
        viewport.scale = update.scale ?? 1;
        viewport.dispatchEvent(new Event(update.event ?? 'resize'));
      };
    },
    { state, key: DEMO_STORAGE_KEY },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await main(page)
    .getByRole('button', { name: /Design team/ })
    .first()
    .click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

async function viewport(page: Page, update: ViewportUpdate) {
  await page.evaluate((value) => window.keyboardViewport(value), update);
}
async function bottomDistance(scroller: Locator) {
  return scroller.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
}
async function scrollToEnd(scroller: Locator) {
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(2);
}
async function fitsVisualViewport(page: Page, panel: Locator, composer: Locator) {
  await expect
    .poll(
      async () => {
        const visual = await page.evaluate(() => ({
          top: window.visualViewport!.offsetTop,
          height: window.visualViewport!.height,
        }));
        const top = await panel.evaluate((node) => node.getBoundingClientRect().top);
        const bottom = await composer.evaluate((node) => node.getBoundingClientRect().bottom);
        return Math.max(
          Math.abs(top - visual.top),
          Math.abs(bottom - (visual.top + visual.height)),
        );
      },
      { message: 'panel top and composer bottom must follow the visible viewport' },
    )
    .toBeLessThanOrEqual(1);
}
async function openThread(page: Page) {
  const row = main(page).getByRole('article').filter({ hasText: fixtureRoot });
  await row.getByRole('button', { name: '30 replies', exact: true }).click();
  await expect(
    thread(page).getByRole('textbox', { name: 'Reply in thread', exact: true }),
  ).toBeVisible();
}

for (const inThread of [false, true]) {
  test(`${inThread ? 'thread' : 'main'} composer follows resize and scroll-only visual viewport panning`, async ({
    page,
  }) => {
    if (inThread) await openThread(page);
    const panel = inThread ? thread(page) : page.locator('.app-shell');
    const input = (inThread ? thread(page) : main(page)).getByRole('textbox', {
      name: inThread ? 'Reply in thread' : 'Message',
      exact: true,
    });
    const composer = (inThread ? thread(page) : main(page)).locator(
      inThread ? '.thread-composer-wrap' : '.composer-wrap',
    );
    const draft = 'A multiline draft\nthat remains while typing\nwith the keyboard open';
    await input.fill(draft);
    await input.focus();
    await viewport(page, { height: 460 });
    await fitsVisualViewport(page, panel, composer);
    // Same height; offset changes on visualViewport.scroll rather than resize.
    await viewport(page, { height: 460, offsetTop: 96, event: 'scroll' });
    await fitsVisualViewport(page, panel, composer);
    const documentScroll = await page.evaluate(() => ({
      top: window.scrollY,
      height: document.documentElement.scrollHeight,
      layoutHeight: window.innerHeight,
    }));
    expect(documentScroll.top).toBe(0);
    expect(documentScroll.height).toBeLessThanOrEqual(documentScroll.layoutHeight + 1);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(draft);
    // Keyboard animation can emit resize and pan events in the same frame.
    await page.evaluate(() => {
      window.keyboardViewport({ height: 340, offsetTop: 40 });
      window.keyboardViewport({ height: 270, offsetTop: 80, event: 'scroll' });
    });
    await fitsVisualViewport(page, panel, composer);
    const bounds = await input.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(79);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(351);
    await viewport(page, { height: 844 });
    await fitsVisualViewport(page, panel, composer);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
}

for (const inThread of [false, true]) {
  test(`${inThread ? 'thread' : 'main'} newest message stays at the bottom across keyboard resize`, async ({
    page,
  }) => {
    if (inThread) await openThread(page);
    const container = inThread ? thread(page) : main(page);
    const scroller = container.locator(inThread ? '.thread-messages' : '.messages-scroll');
    await scrollToEnd(scroller);
    await container
      .getByRole('textbox', { name: inThread ? 'Reply in thread' : 'Message', exact: true })
      .focus();
    await viewport(page, { height: 460 });
    await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(2);
    await viewport(page, { height: 844 });
    await expect.poll(() => bottomDistance(scroller)).toBeLessThanOrEqual(2);
  });
}

for (const inThread of [false, true]) {
  test(`${inThread ? 'thread' : 'main'} reading older messages keeps its scroll position during keyboard resize`, async ({
    page,
  }) => {
    if (inThread) await openThread(page);
    const container = inThread ? thread(page) : main(page);
    const scroller = container.locator(inThread ? '.thread-messages' : '.messages-scroll');
    await scroller.evaluate((node) => {
      node.scrollTop = 200;
    });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(200);
    await expect.poll(() => bottomDistance(scroller)).toBeGreaterThan(500);
    await container
      .getByRole('textbox', { name: inThread ? 'Reply in thread' : 'Message', exact: true })
      .focus();
    await viewport(page, { height: 460 });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(200);
    await viewport(page, { height: 844 });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(200);
  });
}

test('pinch zoom keeps the full layout and does not treat zoom panning as keyboard positioning', async ({
  page,
}) => {
  await viewport(page, { height: 422, offsetTop: 80, scale: 2, event: 'scroll' });
  await expect
    .poll(() => page.locator('.app-shell').evaluate((node) => node.getBoundingClientRect().height))
    .toBe(844);
  await expect
    .poll(() => page.locator('.app-shell').evaluate((node) => node.getBoundingClientRect().top))
    .toBe(0);
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await viewport(page, { height: 844 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('new-chat dialog and its submit control remain inside a panned keyboard viewport', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
  const email = dialog.getByRole('combobox', { name: 'To', exact: true });
  await email.fill('keyboard@example.com');
  await email.focus();
  await viewport(page, { height: 460, offsetTop: 96 });
  await expect
    .poll(
      async () => {
        const box = await dialog.boundingBox();
        return Math.max(96 - box!.y, box!.y + box!.height - 556, 0);
      },
      { message: 'dialog must fit within visual viewport, not the unchanged layout viewport' },
    )
    .toBeLessThanOrEqual(1);
  await dialog.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const submit = await dialog
    .getByRole('button', { name: 'Start chat', exact: true })
    .boundingBox();
  expect(submit!.y).toBeGreaterThanOrEqual(95);
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(557);
  await expect(email).toHaveValue('keyboard@example.com');
});
