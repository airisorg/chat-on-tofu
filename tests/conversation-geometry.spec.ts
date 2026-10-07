import { expect, test, type Page, type TestInfo } from './coverage-test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import type { ChatState } from '../src/lib/types';

// Fresh Google measurements supplied by root: history and composer OUTER
// envelopes are896px at1440/1920/3440, with24px inner composer insets.
// These are local engine tests, not Google screenshots or hardware proof.
const main = (page: Page) => page.getByRole('main');
const widths = [375, 390, 768, 1024, 1440, 1920, 3440];

async function capture(page: Page, info: TestInfo, label: string, composer = true) {
  if (!process.env.CHAT_EVIDENCE_DIR) return;
  const directory = resolve(process.env.CHAT_EVIDENCE_DIR, info.project.name);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${label}.png`);
  await page.screenshot({ path });
  await info.attach(`${label} viewport`, { path, contentType: 'image/png' });
  if (composer) {
    const crop = resolve(directory, `${label}-composer.png`);
    // Element screenshots scroll hidden ancestors to reveal their target,
    // masking the very clipping this suite checks. Crop the current viewport
    // pixels without scrolling the layout.
    const bounds = (await main(page)
      .locator('.composer-wrap:not(.thread-composer-wrap)')
      .boundingBox())!;
    const viewport = page.viewportSize()!;
    const x = Math.max(0, bounds.x),
      y = Math.max(0, bounds.y);
    await page.screenshot({
      path: crop,
      clip: {
        x,
        y,
        width: Math.min(viewport.width, bounds.x + bounds.width) - x,
        height: Math.min(viewport.height, bounds.y + bounds.height) - y,
      },
    });
    await info.attach(`${label} composer`, { path: crop, contentType: 'image/png' });
  }
}

function png() {
  const width = 640,
    height = 400;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * (width * 4 + 1) + 1 + x * 4;
      pixels[p] = x % 256;
      pixels[p + 1] = y % 256;
      pixels[p + 2] = 120;
      pixels[p + 3] = 255;
    }
  const crc = (data: Buffer) => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, bytes: Buffer) => {
    const type = Buffer.from(kind),
      header = Buffer.alloc(4),
      check = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length);
    check.writeUInt32BE(crc(Buffer.concat([type, bytes])));
    return Buffer.concat([header, type, bytes, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fixture(unread = 1): ChatState {
  const state = createDemoState();
  state.conversations.forEach((c) => (c.unread = c.id === 'demo-maya-dm' ? unread : 0));
  const person = state.conversations.find((c) => c.id === 'demo-design')!.members[1];
  const image = png(),
    audio = readFileSync(resolve(process.cwd(), 'tests/fixtures/picker-tone.m4a'));
  state.messages.push(
    {
      id: 'geometry-long',
      conversationId: 'demo-design',
      author: person,
      text: 'Geometry long text ' + 'unbroken'.repeat(200),
      createdAt: '2026-10-05T12:02:00Z',
      reactions: [],
      attachments: [],
    },
    {
      id: 'geometry-media',
      conversationId: 'demo-design',
      author: person,
      text: 'Geometry media row',
      createdAt: '2026-10-05T12:03:00Z',
      reactions: [],
      attachments: [
        {
          name: 'geometry.png',
          type: 'image/png',
          size: image.length,
          url: 'data:image/png;base64,' + image.toString('base64'),
        },
        {
          name: 'a-long-geometry-file-name-' + 'x'.repeat(45) + '.txt',
          type: 'text/plain',
          size: 8,
          url: 'data:text/plain;base64,Z2VvbWV0cnk=',
        },
        {
          name: 'geometry.m4a',
          type: 'audio/mp4',
          size: audio.length,
          url: 'data:audio/mp4;base64,' + audio.toString('base64'),
        },
      ],
    },
  );
  return state;
}

async function demo(page: Page, unread = 1) {
  const state = fixture(unread);
  await page.emulateMedia({ colorScheme: 'light' });
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
  if (!(await main(page).getByRole('textbox', { name: 'Message', exact: true }).isVisible()))
    await main(page)
      .getByRole('button', { name: /^Design team/ })
      .first()
      .click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(
    main(page).getByRole('article').filter({ hasText: 'Geometry media row' }).locator('img'),
  ).toHaveJSProperty('naturalWidth', 640);
}

async function geometry(page: Page) {
  return main(page).evaluate((element) => {
    const scroll = element.querySelector('.messages-scroll')! as HTMLElement;
    const first = scroll.querySelector('article')!;
    const history = first.parentElement!;
    const composer = element.querySelector('.composer-wrap:not(.thread-composer-wrap)')!;
    const inner = composer.querySelector('.composer')!;
    const box = (node: Element) => {
      const r = node.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
        center: r.x + r.width / 2,
      };
    };
    const style = getComputedStyle(scroll),
      left = parseFloat(style.paddingLeft),
      right = parseFloat(style.paddingRight);
    return {
      pane: box(element),
      history: box(history),
      composer: box(composer),
      inner: box(inner),
      available: scroll.clientWidth - left - right,
      scrollClientLeft: scroll.clientLeft,
      contentCenter:
        scroll.getBoundingClientRect().x +
        scroll.clientLeft +
        left +
        (scroll.clientWidth - left - right) / 2,
      viewport: { width: innerWidth, height: innerHeight },
      docWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      content: [
        ...scroll.querySelectorAll(
          '.message-text,.image-attachment,.file-attachment,[aria-label^="Voice message:"]',
        ),
      ].map((node) => ({
        ...box(node),
        label: node.getAttribute('aria-label') || node.className,
        parent: box(node.closest('.message-body')!),
      })),
      controls: [...composer.querySelectorAll('button')]
        .filter((node) => node.getBoundingClientRect().width > 0)
        .map(box),
    };
  });
}

async function verify(page: Page, info: TestInfo, label: string) {
  const g = await geometry(page);
  await info.attach(label, { body: JSON.stringify(g, null, 2), contentType: 'application/json' });
  if (process.env.CHAT_EVIDENCE_DIR) {
    const directory = resolve(process.env.CHAT_EVIDENCE_DIR, info.project.name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, `${g.viewport.width}-${label}-geometry.json`),
      JSON.stringify(g, null, 2) + '\n',
    );
  }
  expect(g.docWidth).toBeLessThanOrEqual(g.viewport.width + 1);
  expect(g.bodyWidth).toBeLessThanOrEqual(g.viewport.width + 1);
  expect(g.history.width).toBeCloseTo(Math.min(896, g.available), 0);
  expect(Math.abs(g.history.center - g.contentCenter)).toBeLessThanOrEqual(1);
  if (g.viewport.width >= 800) {
    // Fixed reference values prevent the previous self-consistent but wrong
    // full-pane composer from passing merely because it fits the viewport.
    expect(g.composer.width).toBeLessThanOrEqual(896.5);
    expect(Math.abs(g.composer.width - g.history.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(g.composer.x - g.history.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(g.composer.center - g.history.center)).toBeLessThanOrEqual(4);
    expect(g.inner.x - g.composer.x).toBeCloseTo(24, 0);
    expect(g.composer.right - g.inner.right).toBeCloseTo(24, 0);
    if (g.available >= 896) {
      expect(g.composer.width).toBeCloseTo(896, 0);
      expect(g.inner.width).toBeCloseTo(848, 0);
    }
  } else {
    expect(g.composer.x).toBeGreaterThanOrEqual(g.pane.x - 1);
    expect(g.composer.right).toBeLessThanOrEqual(g.pane.right + 1);
    for (const control of g.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.height).toBeGreaterThanOrEqual(44);
    }
  }
  for (const node of g.content) {
    expect(node.x, `${node.label} left`).toBeGreaterThanOrEqual(node.parent.x - 1);
    expect(node.right, `${node.label} right`).toBeLessThanOrEqual(node.parent.right + 1);
  }
  expect(g.content.length).toBeGreaterThan(5);
}

for (const width of widths)
  test.describe(`${width}px`, () => {
    test.use({
      viewport: { width, height: width < 800 ? 844 : 960 },
      hasTouch: width < 800,
      isMobile: width < 400,
    });
    test('history and composer share a responsive column across themes', async ({ page }, info) => {
      await demo(page);
      if (width === 3440)
        await main(page).screenshot({ path: info.outputPath('before-geometry-assertion.png') });
      await verify(page, info, 'light-expanded');
      await capture(page, info, `${width}-light-expanded`);
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await verify(page, info, 'dark-expanded');
      await capture(page, info, `${width}-dark-expanded`);
      if (width >= 800) {
        await page.getByRole('button', { name: 'Main menu', exact: true }).click();
        await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
        await verify(page, info, 'dark-collapsed');
        await page.getByRole('button', { name: 'Main menu', exact: true }).click();
        await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/);
      }
    });
  });

for (const width of [1440, 3440])
  test.describe(`${width}px auxiliary panels`, () => {
    test.use({ viewport: { width, height: 960 } });
    test('thread and pop-up retain separate geometry while main column resizes', async ({
      page,
    }, info) => {
      await demo(page);
      const row = main(page).getByRole('article').filter({ hasText: 'Good morning, team!' });
      await row.hover();
      await row.getByRole('button', { name: 'Reply in thread', exact: true }).click();
      const thread = page.locator('.thread-panel');
      await expect(thread).toBeVisible();
      await verify(page, info, 'thread-open');
      const threadBox = (await thread.boundingBox())!,
        replyBox = (await thread
          .getByRole('textbox', { name: 'Reply in thread', exact: true })
          .boundingBox())!;
      expect(replyBox.x).toBeGreaterThanOrEqual(threadBox.x);
      expect(replyBox.x + replyBox.width).toBeLessThanOrEqual(threadBox.x + threadBox.width);
      await page.getByRole('button', { name: 'Close thread', exact: true }).click();
      await main(page).getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
      const popup = page.getByRole('region', {
        name: 'Mini conversation: Design team',
        exact: true,
      });
      await expect(popup).toBeVisible();
      const mini = (await popup.boundingBox())!;
      expect(mini.width).toBe(420);
      expect(mini.height).toBe(500);
      await verify(page, info, 'mini-open');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await verify(page, info, 'mini-dark');
      await popup.getByRole('button', { name: 'Close pop-up', exact: true }).click();
    });
  });

for (const count of [1, 123])
  test(`Home unread count ${count} retains a readable nonclipped inset`, async ({ page }, info) => {
    await demo(page, count);
    const home = page
      .getByRole('complementary', { name: 'Chat navigation' })
      .getByRole('button', { name: 'Home', exact: true });
    await home.click();
    const countNode = home.locator('.nav-count');
    await expect(countNode).toHaveText(String(count));
    const badge = await home.evaluate((node) => {
      const b = node.getBoundingClientRect(),
        count = node.querySelector('.nav-count')!,
        r = count.getBoundingClientRect(),
        text = count.firstChild!,
        range = document.createRange();
      range.selectNodeContents(text);
      const glyph = range.getBoundingClientRect(),
        label = node.querySelector('span')!.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        rowRightInset: b.right - r.right,
        glyphRightInset: b.right - glyph.right,
        labelGap: r.x - label.right,
        clip: count.scrollWidth <= count.clientWidth + 1,
      };
    });
    await info.attach(`home-count-${count}`, {
      body: JSON.stringify(badge),
      contentType: 'application/json',
    });
    expect(badge.width).toBeGreaterThanOrEqual(28);
    expect(badge.height).toBe(18);
    expect(badge.rowRightInset).toBeGreaterThanOrEqual(4);
    expect(badge.glyphRightInset).toBeGreaterThanOrEqual(count === 1 ? 12 : 10);
    expect(badge.labelGap).toBeGreaterThanOrEqual(12);
    expect(badge.clip).toBe(true);
    if (process.env.CHAT_EVIDENCE_DIR) {
      const directory = resolve(process.env.CHAT_EVIDENCE_DIR, info.project.name);
      mkdirSync(directory, { recursive: true });
      const path = resolve(directory, `home-count-${count}.png`);
      await home.screenshot({ path });
      writeFileSync(
        resolve(directory, `home-count-${count}.json`),
        JSON.stringify(badge, null, 2) + '\n',
      );
      await info.attach(`Home count ${count} crop`, { path, contentType: 'image/png' });
    }
  });

test.describe('narrow desktop composer', () => {
  test.use({ viewport: { width: 1024, height: 400 }, hasTouch: false, isMobile: false });
  test('long file names, retained failure feedback and overlays remain reachable in a short window', async ({
    page,
  }, info) => {
    await demo(page);
    await verify(page, info, 'short-default-gutter');
    const textName = 'W'.repeat(116) + '.txt',
      audioName = 'W'.repeat(115) + '.m4a';
    const audio = readFileSync(resolve(process.cwd(), 'tests/fixtures/picker-tone.m4a'));
    await page.locator('input[type=file]').setInputFiles([
      { name: textName, mimeType: 'text/plain', buffer: Buffer.from('geometry draft') },
      { name: audioName, mimeType: 'audio/mp4', buffer: audio },
    ]);
    const composer = main(page).locator('.composer-wrap:not(.thread-composer-wrap)');
    const removeText = composer.getByRole('button', { name: `Remove ${textName}`, exact: true });
    const removeAudio = composer.getByRole('button', { name: `Remove ${audioName}`, exact: true });
    const preview = composer.getByLabel('Voice note preview', { exact: true });
    await expect(removeText).toBeVisible();
    await expect(removeAudio).toBeVisible();
    await expect(preview).toHaveJSProperty('readyState', 4);
    const withinComposer = async () => {
      const boxes = await composer.evaluate((element) => {
        const b = element.getBoundingClientRect();
        const viewport = element.closest('.composer-viewport')!;
        const v = viewport.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          viewportY: v.y,
          viewportBottom: v.bottom,
          viewportScrollTop: viewport.scrollTop,
          viewportHeight: innerHeight,
          children: [
            ...element.querySelectorAll('.composer textarea,.composer-status p,.send-button'),
          ].map((node) => {
            const r = node.getBoundingClientRect();
            const unobstructed = [0.2, 0.5, 0.8].every((fraction) => {
              const top = document.elementFromPoint(r.x + r.width * fraction, r.y + r.height / 2);
              return top === node || (!!top && node.contains(top));
            });
            return {
              label: node.getAttribute('aria-label') || node.className,
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
              unobstructed,
            };
          }),
        };
      });
      await info.attach('short desktop draft bounds', {
        body: JSON.stringify(boxes, null, 2),
        contentType: 'application/json',
      });
      if (process.env.CHAT_EVIDENCE_DIR) {
        const directory = resolve(process.env.CHAT_EVIDENCE_DIR, info.project.name);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          resolve(directory, '1024-short-draft-bounds.json'),
          JSON.stringify(boxes, null, 2) + '\n',
        );
      }
      expect(boxes.viewportScrollTop).toBe(0);
      for (const child of boxes.children) {
        expect(child.x).toBeGreaterThanOrEqual(boxes.x - 1);
        expect(child.right).toBeLessThanOrEqual(boxes.right + 1);
        expect(child.y).toBeGreaterThanOrEqual(Math.max(boxes.y, boxes.viewportY, 0) - 1);
        expect(child.bottom).toBeLessThanOrEqual(
          Math.min(boxes.bottom, boxes.viewportBottom, boxes.viewportHeight) + 1,
        );
        expect(child.width).toBeGreaterThan(0);
        expect(child.height).toBeGreaterThan(0);
        expect(child.unobstructed, `${child.label} hit-test`).toBe(true);
      }
    };
    await capture(page, info, '1024x400-attached-files');
    await withinComposer();
    await composer
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Retain this geometry draft');
    // Inject a deterministic local demo rejection. This exercises the real
    // failure UI without a provider/session/network or microphone permission.
    await page.evaluate(() => {
      const original = crypto.randomUUID.bind(crypto);
      Object.defineProperty(window, '__geometryRestoreUuid', {
        value: () => {
          crypto.randomUUID = original;
        },
        configurable: true,
      });
      crypto.randomUUID = () => {
        throw new Error('Synthetic geometry send rejection');
      };
    });
    try {
      await composer.getByRole('button', { name: 'Send message', exact: true }).click();
    } finally {
      await page.evaluate(() => {
        (window as unknown as { __geometryRestoreUuid: () => void }).__geometryRestoreUuid();
      });
    }
    await expect(composer.locator('.composer-status.unconfirmed')).toContainText(
      'Send not confirmed',
    );
    await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Retain this geometry draft',
    );
    await expect(removeText).toBeVisible();
    await withinComposer();
    // Preview rows may scroll independently in short windows. Prove the
    // decoded audio can be brought inside that bounded area without moving
    // the input or hiding the header; do not require all rows at once.
    const headerY = (await main(page).locator('.conversation-header').boundingBox())!.y;
    const inputYs = await composer
      .locator('.composer textarea,.send-button')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
    await preview.evaluate((node) => {
      const area = node.closest('.draft-attachments')!,
        item = node.getBoundingClientRect(),
        box = area.getBoundingClientRect();
      if (item.bottom > box.bottom) area.scrollTop += item.bottom - box.bottom;
      else if (item.top < box.top) area.scrollTop -= box.top - item.top;
    });
    const previewBox = (await preview.boundingBox())!,
      draftBox = (await composer.locator('.draft-attachments').boundingBox())!;
    expect(previewBox.y).toBeGreaterThanOrEqual(draftBox.y - 1);
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(draftBox.y + draftBox.height + 1);
    expect((await main(page).locator('.conversation-header').boundingBox())!.y).toBe(headerY);
    expect(
      await composer
        .locator('.composer textarea,.send-button')
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y)),
    ).toEqual(inputYs);
    await withinComposer();
    await capture(page, info, '1024x400-retained-draft');
    await composer.getByRole('button', { name: 'Add emoji', exact: true }).click();
    const emoji = page.getByRole('dialog', { name: 'Add emoji', exact: true });
    await expect(emoji.getByRole('textbox', { name: 'Search emoji', exact: true })).toBeVisible();
    const emojiBox = (await emoji.boundingBox())!;
    expect(emojiBox.x).toBeGreaterThanOrEqual(0);
    expect(emojiBox.x + emojiBox.width).toBeLessThanOrEqual(1024);
    expect(emojiBox.y + emojiBox.height).toBeLessThanOrEqual(400);
    await page.keyboard.press('Escape');
    await composer.getByRole('button', { name: 'Record voice note', exact: true }).click();
    const voice = page.getByRole('dialog', { name: 'Record a voice note', exact: true });
    await expect(voice.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
    await voice
      .getByRole('button', { name: 'Start recording', exact: true })
      .click({ trial: true });
    const voiceBox = (await voice.boundingBox())!;
    expect(voiceBox.x).toBeGreaterThanOrEqual(0);
    expect(voiceBox.x + voiceBox.width).toBeLessThanOrEqual(1024);
    expect(voiceBox.y + voiceBox.height).toBeLessThanOrEqual(400);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1024, height: 360 });
    const multiline = Array.from(
      { length: 12 },
      (_, index) => `Retained multiline draft line ${index}`,
    ).join('\n');
    await composer.getByRole('textbox', { name: 'Message', exact: true }).fill(multiline);
    await expect
      .poll(
        async () =>
          (await composer.getByRole('textbox', { name: 'Message', exact: true }).boundingBox())!
            .height,
      )
      .toBe(56);
    expect(
      await composer
        .getByRole('textbox', { name: 'Message', exact: true })
        .evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    await expect(removeText).toBeVisible();
    await expect(removeAudio).toBeVisible();
    await expect(composer.locator('.composer-status.unconfirmed')).toContainText(
      'Previous send not confirmed',
    );
    await capture(page, info, '1024x360-retained-multiline');
    await withinComposer();
    // Exercise the no-reserved-gutter environment too. Default Chrome and
    // WebKit gutter measurements are recorded separately; this is not a
    // claim about every operating system's native scrollbar implementation.
    await page.addStyleTag({
      content:
        ':is(.main-panel,.conversation-pane)>.messages-scroll,:is(.main-panel,.conversation-pane)>.composer-viewport{scrollbar-width:none;scrollbar-gutter:auto} :is(.main-panel,.conversation-pane)>.messages-scroll::-webkit-scrollbar,:is(.main-panel,.conversation-pane)>.composer-viewport::-webkit-scrollbar{display:none}',
    });
    expect((await geometry(page)).scrollClientLeft).toBe(0);
    await verify(page, info, 'no-reserved-gutter');
    await withinComposer();
    await removeText.click();
    await expect(removeText).toBeHidden();
    await removeAudio.click();
    await expect(preview).toBeHidden();
    await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      multiline,
    );
    await withinComposer();
  });
});
