import { expect, test, type Page, type Locator, type TestInfo } from './coverage-test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// App consistency and supported navigation checks. The 24px inset adapts measured
// Google Home spacing, not an observed Google Space-header pixel oracle.
async function fixture(page: Page, theme: 'light' | 'dark', emptyCombinedDm = false) {
  const state = createDemoState();
  if (emptyCombinedDm) {
    state.conversations = state.conversations.filter(
      (conversation) => conversation.kind === 'space',
    );
    const ids = new Set(state.conversations.map((conversation) => conversation.id));
    state.messages = state.messages.filter((message) => ids.has(message.conversationId));
  }
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.removeItem('relay-chat-demo-choice-v1');
      localStorage.setItem('relay-theme', 'system');
    },
    { key: DEMO_STORAGE_KEY, state },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
}
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Chat navigation' });
const full = (page: Page) => page.getByRole('region', { name: 'Conversation', exact: true });
const preview = (page: Page) =>
  page.getByRole('region', { name: 'Conversation preview', exact: true });

async function hit(control: Locator) {
  await expect(control).toHaveCount(1);
  const result = await control.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      width: r.width,
      height: r.height,
      x: r.x,
      right: r.right,
    };
  });
  expect(result.hit).toBe(true);
  return result;
}
async function headings(page: Page) {
  const result = [];
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    const button = sidebar(page).getByRole('button', { name, exact: true });
    await expect(button).toHaveCount(1);
    result.push(
      await button.evaluate((node) => {
        const s = getComputedStyle(node);
        return {
          family: s.fontFamily,
          size: s.fontSize,
          weight: s.fontWeight,
          height: s.lineHeight,
          color: s.color,
        };
      }),
    );
  }
  return result;
}
async function headingGeometry(page: Page) {
  const result = [];
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    result.push(
      await sidebar(page)
        .getByRole('button', { name, exact: true })
        .evaluate((node) => {
          const icon = node.querySelector('svg')!.getBoundingClientRect();
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text: Node | null;
          while ((text = walker.nextNode()) && !text.textContent?.trim()) {
            /* Skip formatting whitespace. */
          }
          if (!text) throw new Error('Disclosure label is missing');
          const range = document.createRange();
          range.selectNodeContents(text);
          const label = range.getBoundingClientRect();
          return {
            iconX: icon.x,
            iconWidth: icon.width,
            labelX: label.x,
            gap: label.x - icon.right,
          };
        }),
    );
  }
  return result;
}
async function capture(page: Page, info: TestInfo, kind: string, region: Locator) {
  const folder = evidenceDirectory(info, info.project.name);
  mkdirSync(folder, { recursive: true });
  const prefix = `${page.viewportSize()!.width}-${await page.locator('html').getAttribute('data-theme')}-${kind}`;
  const header = await region
    .locator('header')
    .first()
    .evaluate((node) => {
      const box = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
      };
      const s = getComputedStyle(node);
      return {
        ...box(node),
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        avatar: box(node.querySelector('.avatar,.space-avatar')!),
        title: [...node.querySelectorAll('button')].map((e) => ({
          text: e.textContent,
          ...box(e),
        })),
      };
    });
  writeFileSync(
    resolve(folder, prefix + '.json'),
    JSON.stringify(
      { header, headings: await headings(page), headingGeometry: await headingGeometry(page) },
      null,
      2,
    ) + '\n',
  );
  await page.screenshot({ path: resolve(folder, prefix + '.png') });
}

for (const width of [1024, 1440, 3440])
  for (const theme of ['light', 'dark'] as const)
    test.describe(`header/sidebar ${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 960 } });
      test('full and preview kinds retain their controls with coherent geometry', async ({
        page,
      }, info) => {
        await fixture(page, theme);
        await sidebar(page).getByRole('button', { name: 'Design team', exact: true }).click();
        await expect(full(page)).toHaveCount(1);
        await expect(full(page).locator('header > .space-avatar')).toHaveCount(1);
        await capture(page, info, 'full-space', full(page));
        if (width >= 1200) {
          await page
            .getByRole('navigation')
            .getByRole('button', { name: 'Home', exact: true })
            .click();
          await page
            .locator('.home-view .conversation-row')
            .filter({ hasText: 'Design team' })
            .click();
          await expect(preview(page)).toHaveCount(1);
          await expect(preview(page).locator('header > .space-avatar')).toHaveCount(1);
          await capture(page, info, 'preview-space', preview(page));
          const avatar = (await preview(page).locator('header > .space-avatar').boundingBox())!;
          expect(avatar.width, 'space preview avatar matches compact DM24px').toBe(24);
          expect(avatar.height).toBe(24);
          await hit(
            preview(page).getByRole('button', { name: 'Expand conversation', exact: true }),
          );
          await preview(page)
            .getByRole('button', { name: 'Expand conversation', exact: true })
            .click();
        }
        const values = await headings(page);
        for (const value of values) expect(value).toEqual(values[0]);
        expect(values[0].family).toContain('Google Sans');
        expect(values[0].size).toBe('12px');
        expect(values[0].weight).toBe('500');
        expect(values[0].height).toBe('24px');
        const origins = await headingGeometry(page);
        for (const origin of origins) {
          expect(origin.iconWidth).toBe(17);
          expect(origin.gap).toBe(8);
          expect(Math.abs(origin.iconX - origins[0].iconX)).toBeLessThanOrEqual(1);
          expect(Math.abs(origin.labelX - origins[0].labelX)).toBeLessThanOrEqual(1);
        }
        for (const name of ['Design team', 'Weekend plans', 'Maya Chen']) {
          await sidebar(page).getByRole('button', { name, exact: true }).click();
          await expect(full(page)).toHaveCount(1);
          await expect(preview(page)).toHaveCount(0);
          const header = full(page).locator('.conversation-header');
          await expect(header).toHaveCSS('padding-left', '24px');
          await expect(header).toHaveCSS('padding-right', '24px');
          const avatar = (await header
            .locator(':scope > .avatar,:scope > .space-avatar')
            .boundingBox())!;
          expect(avatar.width).toBe(40);
          expect(avatar.height).toBe(40);
          await expect(full(page).locator('.conversation-tabs > .current')).toHaveText('Chat');
          await expect(full(page).getByRole('button', { name: /^Shared/ })).toHaveCount(1);
          await expect(header.locator('.conversation-title small')).not.toHaveText('');
          await hit(header.getByRole('button', { name: 'Conversation details', exact: true }));
          await capture(page, info, 'full-' + name.replaceAll(' ', '-'), full(page));
        }
        for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
          const disclosure = sidebar(page).getByRole('button', { name, exact: true });
          await hit(disclosure);
          await disclosure.click();
          await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
          await disclosure.click();
          await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        }
      });
    });

test.describe('coarse desktop headings', () => {
  test.use({ viewport: { width: 1440, height: 960 }, hasTouch: true, isMobile: true });
  test('all disclosure controls preserve44px touch targets', async ({ page }) => {
    await fixture(page, 'dark');
    for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
      const control = sidebar(page).getByRole('button', { name, exact: true });
      const bounds = await hit(control);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await sidebar(page).getByRole('button', { name: 'Design team', exact: true }).click();
    await expect(full(page)).toHaveCount(1);
    await expect(preview(page)).toHaveCount(0);
    const bounds = await hit(
      full(page).getByRole('button', { name: 'Conversation details', exact: true }),
    );
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  });
});

async function focusMetrics(control: Locator) {
  await expect(control).toHaveCount(1);
  return control.evaluate((node) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const css = getComputedStyle(node);
    const width = parseFloat(css.outlineWidth);
    const offset = parseFloat(css.outlineOffset);
    const outside = Math.max(0, width + offset);
    const row = box(node);
    return {
      row,
      icon: box(node.querySelector(':scope > svg,:scope > .avatar,:scope > .space-avatar')!),
      label: box(node.querySelector(':scope > span')!),
      font: {
        family: css.fontFamily,
        size: css.fontSize,
        weight: css.fontWeight,
        line: css.lineHeight,
      },
      focus: node.matches(':focus-visible'),
      outline: { width, offset, style: css.outlineStyle, outside },
      paint: {
        x: row.x - outside,
        y: row.y - outside,
        right: row.right + outside,
        bottom: row.bottom + outside,
      },
    };
  });
}

async function keyboardFocusMentions(page: Page) {
  // Move from the next shortcut with an actual keyboard event, rather than
  // styling a fake focus class or relying on pointer-focus heuristics.
  await sidebar(page).getByRole('button', { name: 'Starred', exact: true }).focus();
  // WebKit's macOS default skips buttons on plain Tab; Option+Tab includes
  // every focusable control. Both paths still require real keyboard traversal.
  await page.keyboard.press(
    page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab',
  );
  const mentions = sidebar(page).getByRole('button', { name: 'Mentions', exact: true });
  await expect(mentions).toBeFocused();
  await expect.poll(() => mentions.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  return mentions;
}

for (const theme of ['light', 'dark'] as const)
  for (const collapsed of [false, true]) {
    test(`selected Mentions ${theme} ${collapsed ? 'collapsed' : 'expanded'} keeps focus paint inside its row`, async ({
      page,
    }, info) => {
      await fixture(page, theme);
      if (collapsed) await page.getByRole('button', { name: 'Main menu', exact: true }).click();
      const mentions = sidebar(page).getByRole('button', { name: 'Mentions', exact: true });
      await mentions.click();
      await expect(mentions).toHaveClass(/selected/);
      await expect(
        page.getByRole('main').getByRole('heading', { name: 'Mentions', exact: true }),
      ).toBeVisible();
      await mentions.evaluate((node) => (node as HTMLElement).blur());
      const nav = sidebar(page).locator('nav');
      await expect(nav).toHaveCount(1);
      const folder = evidenceDirectory(info, info.project.name);
      mkdirSync(folder, { recursive: true });
      const prefix = `mentions-${theme}-${collapsed ? 'collapsed' : 'expanded'}`;
      await nav.screenshot({ path: resolve(folder, `${prefix}-unfocused.png`) });
      const unfocused = await focusMetrics(mentions);
      expect(unfocused.focus).toBe(false);
      const focusedControl = await keyboardFocusMentions(page);
      const focused = await focusMetrics(focusedControl);
      await nav.screenshot({ path: resolve(folder, `${prefix}-focused.png`) });
      writeFileSync(
        resolve(folder, `${prefix}.json`),
        JSON.stringify({ unfocused, focused }, null, 2) + '\n',
      );

      expect(focused.row).toEqual(unfocused.row);
      expect(focused.row.height).toBe(collapsed ? 44 : 28);
      expect(focused.icon.width).toBe(22);
      expect(focused.icon.height).toBe(22);
      expect(
        Math.abs(focused.icon.y + 11 - focused.row.y - focused.row.height / 2),
      ).toBeLessThanOrEqual(0.5);
      expect(focused.font).toMatchObject({ size: '14px', weight: '400', line: '16px' });
      expect(focused.font.family).toContain('Google Sans');
      if (!collapsed) {
        expect(focused.label.height).toBe(16);
        expect(
          Math.abs(focused.label.y + 8 - focused.row.y - focused.row.height / 2),
        ).toBeLessThanOrEqual(0.5);
        expect(focused.label.x - focused.icon.right).toBe(16);
      }
      const home = (
        await focusMetrics(sidebar(page).getByRole('button', { name: 'Home', exact: true }))
      ).row;
      const starred = (
        await focusMetrics(sidebar(page).getByRole('button', { name: 'Starred', exact: true }))
      ).row;
      expect(focused.row.y - home.bottom).toBe(0);
      expect(starred.y - focused.row.bottom).toBe(0);
      expect(focused.outline.style).toBe('solid');
      expect(focused.outline.width).toBe(2);
      expect(
        focused.outline.outside,
        'focus outline cannot paint into adjacent dense shortcut rows',
      ).toBe(0);
      expect(focused.paint.y).toBeGreaterThanOrEqual(home.bottom);
      expect(focused.paint.bottom).toBeLessThanOrEqual(starred.y);
      await hit(focusedControl);

      // These are app-regression snapshots. Selected dark/focused Google parity
      // remains unmeasured; the28px row comes from historical light Google data.
      await expect(nav).toHaveScreenshot(`${prefix}-focused.png`);
      await focusedControl.evaluate((node) => (node as HTMLElement).blur());
      await expect(nav).toHaveScreenshot(`${prefix}-unfocused.png`);

      // The same inset contract must cover conversation rows, including the
      // first row in a group, where an exterior ring could touch its heading.
      if (!collapsed) {
        const conversation = sidebar(page).getByRole('button', { name: 'Maya Chen', exact: true });
        await conversation.focus();
        const peerFocus = await focusMetrics(conversation);
        expect(peerFocus.focus).toBe(true);
        expect(peerFocus.outline.width).toBe(2);
        expect(peerFocus.outline.outside).toBe(0);
        expect(peerFocus.row.height).toBe(28);
        await hit(conversation);
      }
    });
  }

test.describe('coarse sidebar focus', () => {
  test.use({ viewport: { width: 1440, height: 960 }, hasTouch: true, isMobile: true });
  test('shortcut and conversation focus retain44px touch rows', async ({ page }) => {
    await fixture(page, 'dark');
    const mentions = await keyboardFocusMentions(page);
    const shortcut = await focusMetrics(mentions);
    expect(shortcut.row.height).toBeGreaterThanOrEqual(44);
    expect(shortcut.outline.outside).toBe(0);
    const conversation = sidebar(page).getByRole('button', { name: 'Maya Chen', exact: true });
    await conversation.focus();
    const peer = await focusMetrics(conversation);
    expect(peer.focus).toBe(true);
    expect(peer.row.height).toBeGreaterThanOrEqual(44);
    expect(peer.outline.outside).toBe(0);
    await hit(conversation);
  });
});

// Bounded app-consistency follow-up. These are own-app screenshot regressions,
// not measured Google dark/focus or native-phone parity.
async function disclosureBoxes(page: Page) {
  const values = [];
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    values.push(
      await sidebar(page)
        .getByRole('button', { name, exact: true })
        .evaluate((node) => {
          const r = node.getBoundingClientRect();
          return { y: r.y, height: r.height };
        }),
    );
  }
  return values;
}
async function collapseAllDisclosures(page: Page) {
  for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
    const control = sidebar(page).getByRole('button', { name, exact: true });
    await expect(control).toHaveCount(1);
    if ((await control.getAttribute('aria-expanded')) === 'true') await control.click();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await hit(control);
  }
}
async function assertDisclosureColumns(page: Page, touch: boolean) {
  const typography = await headings(page);
  expect(typography).toHaveLength(3);
  for (const style of typography) expect(style).toEqual(typography[0]);
  expect(typography[0].family).toContain('Google Sans');
  expect(typography[0].size).toBe('12px');
  const origins = await headingGeometry(page);
  expect(origins).toHaveLength(3);
  for (const origin of origins) {
    expect(origin.iconWidth).toBe(17);
    expect(origin.gap).toBe(8);
    expect(origin.iconX).toBe(origins[0].iconX);
    expect(origin.labelX).toBe(origins[0].labelX);
  }
  if (touch)
    for (const name of ['Shortcuts', 'Direct messages', 'Spaces']) {
      const bounds = await hit(sidebar(page).getByRole('button', { name, exact: true }));
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
}
async function screenshotDisclosureGroups(page: Page, name: string) {
  const bounds = await sidebar(page).evaluate((node) => {
    const groups = [...node.querySelectorAll(':scope > nav,:scope > .sidebar-group')];
    if (groups.length < 3) throw new Error('Three disclosure groups are required');
    const first = groups[0].getBoundingClientRect();
    const last = groups[2].getBoundingClientRect();
    const side = node.getBoundingClientRect();
    return {
      x: side.x,
      y: first.y - 4,
      width: side.width,
      height: last.bottom - first.y + 8,
    };
  });
  await page.mouse.move(page.viewportSize()!.width - 10, 950);
  await expect(page).toHaveScreenshot(name, {
    clip: bounds,
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixels: 0,
  });
}
for (const width of [800, 1440])
  for (const touch of [false, true])
    for (const theme of ['light', 'dark'] as const)
      test.describe(`disclosure composition ${width}px ${touch ? 'coarse' : 'fine'} ${theme}`, () => {
        test.use({ viewport: { width, height: 960 }, hasTouch: touch });
        test('collapsed rhythm, empty-group origins and Shared containment remain explicit', async ({
          page,
        }) => {
          await fixture(page, theme);
          // Keep a controlled Home state before either crop; no dynamic timestamps appear.
          await page
            .getByRole('navigation')
            .getByRole('button', { name: 'Home', exact: true })
            .click();
          const expandedBefore = await disclosureBoxes(page);
          await collapseAllDisclosures(page);
          await assertDisclosureColumns(page, touch);
          const collapsed = await disclosureBoxes(page);
          expect(collapsed[1].y - collapsed[0].y).toBe(touch ? 62 : 44);
          expect(collapsed[2].y - collapsed[1].y).toBe(touch ? 62 : 44);
          await screenshotDisclosureGroups(
            page,
            `collapsed-${width}-${touch ? 'coarse' : 'fine'}-${theme}.png`,
          );
          for (const name of ['Shortcuts', 'Direct messages', 'Spaces'])
            await sidebar(page).getByRole('button', { name, exact: true }).click();
          expect(await disclosureBoxes(page)).toEqual(expandedBefore);
          // A real combined DM/group empty state on a fresh page. The original
          // page's initialization script must not overwrite an edited fixture on reload.
          const samplePage = await page.context().newPage();
          await fixture(samplePage, theme, true);
          const directGroup = sidebar(samplePage)
            .locator('.sidebar-group')
            .filter({
              has: samplePage.getByRole('button', {
                name: 'Direct messages',
                exact: true,
              }),
            });
          await expect(directGroup).toHaveCount(1);
          await expect(directGroup.locator('.sidebar-conversation')).toHaveCount(0);
          await expect(
            sidebar(samplePage)
              .locator('.sidebar-group')
              .filter({
                has: samplePage.getByRole('button', { name: 'Spaces', exact: true }),
              })
              .locator('.sidebar-conversation'),
          ).toHaveCount(2);
          await assertDisclosureColumns(samplePage, touch);
          await screenshotDisclosureGroups(
            samplePage,
            `empty-group-${width}-${touch ? 'coarse' : 'fine'}-${theme}.png`,
          );
          // Shared remains the existing details action; this check fixes only containment.
          await sidebar(samplePage)
            .getByRole('button', { name: 'Design team', exact: true })
            .click();
          const strip = full(samplePage).locator('.conversation-tabs');
          const shared = strip.getByRole('button', {
            name: 'Shared',
            exact: true,
          });
          await expect(strip).toHaveCount(1);
          await expect(shared).toHaveCount(1);
          const outer = (await strip.boundingBox())!;
          const control = await hit(shared);
          const inner = (await shared.boundingBox())!;
          expect(inner.y).toBeGreaterThanOrEqual(outer.y);
          expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height - 1);
          expect(outer.height).toBe(touch ? 45 : 42);
          if (touch) expect(control.height).toBeGreaterThanOrEqual(44);
          await expect(strip).toHaveScreenshot(
            `shared-strip-${width}-${touch ? 'coarse' : 'fine'}-${theme}.png`,
            { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
          );
        });
      });
for (const theme of ['light', 'dark'] as const)
  test.describe(`799px hidden sidebar ${theme}`, () => {
    test.use({ viewport: { width: 799, height: 960 }, hasTouch: true });
    test('compact state has no visible desktop sidebar disclosure', async ({ page }) => {
      await fixture(page, theme);
      await expect(page.locator('.sidebar')).toBeHidden();
      await expect(
        page.getByRole('navigation', { name: 'Main navigation', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      const row = page.locator('.conversation-row').filter({ hasText: 'Design team' });
      await expect(row).toHaveCount(1);
      await row.click();
      const strip = full(page).locator('.conversation-tabs');
      const shared = strip.getByRole('button', { name: 'Shared', exact: true });
      const outer = (await strip.boundingBox())!;
      const target = await hit(shared);
      const inner = (await shared.boundingBox())!;
      expect(outer.height).toBe(45);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height - 1);
      await expect(strip).toHaveScreenshot(`shared-compact-boundary-799-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0,
      });
    });
  });
