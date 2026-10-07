import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDemoState, DEMO_STORAGE_KEY } from "../src/lib/demo";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  if (page.viewportSize()!.width < 800) {
    await page.locator(".home-view .conversation-row").filter({
      has: page.locator(".conversation-row-content > strong").filter({ hasText: /^Design team$/ }),
    }).click();
  } else {
    await page.getByRole("complementary", { name: "Chat navigation" })
      .getByRole("button", { name: "Design team", exact: true }).click();
  }
});

test("message actions are anchored and let a click continue into the conversation", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const row = main
    .getByRole("article")
    .filter({ hasText: "Good morning, team!" });
  await row.hover();
  const opener = row.getByRole("button", { name: "More actions", exact: true });
  await opener.click();
  const menu = page.getByRole("dialog", { name: "Message actions" });
  await expect(menu).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
  const box = await menu.boundingBox(),
    anchor = await opener.boundingBox();
  expect(Math.abs(box!.y - (anchor!.y + anchor!.height))).toBeLessThan(20);
  await main
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Composer stays interactive");
  await expect(menu).toHaveCount(0);
  await expect(
    main.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Composer stays interactive");
});

test("Escape restores the opener and switching to reactions keeps the same anchor", async ({
  page,
}) => {
  const row = page
    .getByRole("main")
    .getByRole("article")
    .filter({ hasText: "Good morning, team!" });
  await row.hover();
  const opener = row.getByRole("button", { name: "More actions", exact: true });
  await opener.click();
  await page
    .getByRole("dialog", { name: "Message actions" })
    .getByRole("button", { name: "Add reaction", exact: true })
    .click();
  const reaction = page.getByRole("dialog", { name: "Add a reaction" });
  await expect(reaction).toHaveAttribute("aria-modal", "false");
  const box = await reaction.boundingBox(),
    anchor = await opener.boundingBox();
  expect(Math.abs(box!.y - (anchor!.y + anchor!.height))).toBeLessThan(20);
  await page.keyboard.press("Escape");
  await expect(reaction).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("phone contextual menu and reaction picker fit a dark short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 460 });
  await page.emulateMedia({ colorScheme: "dark" });
  const row = page
    .getByRole("main")
    .getByRole("article")
    .filter({ hasText: "Can we do a quick review" });
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Message actions" });
  await expect(menu).toBeVisible();
  let box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(12);
  expect(box!.x + box!.width).toBeLessThanOrEqual(378);
  expect(box!.y + box!.height).toBeLessThanOrEqual(448);
  await menu.getByRole("button", { name: "Add reaction", exact: true }).click();
  const reaction = page.getByRole("dialog", { name: "Add a reaction" });
  await expect(reaction).toBeVisible();
  box = await reaction.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(378);
  expect(box!.y + box!.height).toBeLessThanOrEqual(448);
  await expect(
    reaction
      .getByRole("region", { name: "Suggested", exact: true })
      .getByRole("button", { name: "React 👍", exact: true }),
  ).toBeVisible();
});

test("desktop New chat is beside the trigger and leaves the conversation interactive", async ({
  page,
}) => {
  const opener = page
    .getByRole("complementary", { name: "Chat navigation" })
    .getByRole("button", { name: "New chat", exact: true });
  await opener.click();
  const popup = page.getByRole("dialog", { name: "Start a conversation" });
  await expect(popup).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
  const box = await popup.boundingBox(),
    anchor = await opener.boundingBox();
  expect(Math.abs(box!.x - (anchor!.x + anchor!.width))).toBeLessThan(20);
  await expect(
    popup.getByRole("combobox", { name: "To", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("main")
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Conversation stays usable");
  await expect(popup).toHaveCount(0);
});

test("sidebar menu and disclosures preserve the active conversation", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const sidebar = page.getByRole("complementary", { name: "Chat navigation" });
  await expect(
    main.getByRole("heading", { name: "Design team", exact: true }),
  ).toBeVisible();
  const direct = sidebar
    .locator(".sidebar-group-heading")
    .getByRole("button", { name: "Direct messages", exact: true });
  await direct.click();
  await expect(direct).toHaveAttribute("aria-expanded", "false");
  await expect(
    sidebar.getByRole("button", { name: "Maya Chen", exact: true }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("heading", { name: "Design team", exact: true }),
  ).toBeVisible();
  await direct.click();
  await expect(
    sidebar.getByRole("button", { name: "Maya Chen", exact: true }),
  ).toBeVisible();
  const menu = page.getByRole("button", { name: "Main menu", exact: true });
  const before = await main.boundingBox();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(
    sidebar.getByRole("button", { name: "Maya Chen", exact: true }),
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Home", exact: true }),
  ).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(72);
  expect((await main.boundingBox())!.width).toBeGreaterThan(before!.width);
  await expect(
    main.getByRole("heading", { name: "Design team", exact: true }),
  ).toBeVisible();
  await menu.click();
  await expect(sidebar).toBeVisible();
});

test("Home Threads filter opens the saved thread with its replies", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const anchor = main
    .getByRole("article")
    .filter({ hasText: "Good morning, team!" });
  await anchor.hover();
  await anchor
    .getByRole("button", { name: "Reply in thread", exact: true })
    .click();
  const thread = page.getByRole("complementary").filter({
    has: page.getByRole("heading", { name: "Thread", exact: true }),
  });
  await thread
    .getByRole("textbox", { name: "Reply in thread", exact: true })
    .fill("Thread filter verification reply");
  await thread.getByRole("button", { name: "Send reply", exact: true }).click();
  await page.getByRole("button", { name: "Close thread", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Chat navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  const home = page.locator(".home-view");
  const filter = home.getByRole("checkbox", { name: "Threads", exact: true });
  await filter.click();
  await expect(filter).toHaveAttribute("aria-checked", "true");
  await home
    .getByRole("button")
    .filter({ hasText: "Good morning, team!" })
    .click();
  await expect(
    thread
      .getByRole("article")
      .filter({ hasText: "Thread filter verification reply" }),
  ).toBeVisible();
});

async function recipientFixture(page: Page, longName = false) {
  const state = createDemoState();
  const people = Array.from({ length: 6 }, (_, i) => ({ ...state.user,
    id: `picker-review-${i}`, name: `PickerReview person ${i + 1}`,
    email: `picker-review-${i}@example.com`,
  }));
  if (longName) people[5].name = 'PickerReviewLongRecipient'.padEnd(80, 'X');
  state.conversations.push({ id: 'demo-picker-review', name: 'Picker review contacts', kind: 'group', members: [state.user, ...people], updatedAt: new Date().toISOString(), unread: 0 });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.evaluate(({ state, key }) => localStorage.setItem(key, JSON.stringify(state)), { state, key: DEMO_STORAGE_KEY });
  await page.reload();
  const explore = page.getByRole('button', { name: 'Explore demo', exact: true });
  await Promise.race([explore.waitFor({ state: 'visible' }), page.locator('.app-shell').waitFor({ state: 'visible' })]);
  if (await explore.isVisible()) await explore.click();
  if (page.viewportSize()!.width < 800) {
    const back = page.getByRole('button', { name: 'Back to conversations', exact: true });
    if (await back.isVisible()) await back.click();
  }
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a conversation', exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, people };
}

async function activeRecipientBounds(input: Locator) {
  return input.evaluate(node => {
    const id = node.getAttribute('aria-activedescendant');
    const option = id && document.getElementById(id);
    const list = option && option.closest('[role="listbox"]');
    if (!option || !list) return null;
    const r = option.getBoundingClientRect(), l = list.getBoundingClientRect();
    const top = l.top + list.clientTop;
    return { top: r.top, bottom: r.bottom, listTop: top, listBottom: top + list.clientHeight,
      hit: option.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), scroll: list.scrollTop };
  });
}

for (const width of [1440, 390]) test.describe(`recipient picker ${width}px`, () => {
  test.use({ viewport: { width, height: width === 1440 ? 960 : 844 }, isMobile: width < 800, hasTouch: width < 800 });
  test('keyboard-active fifth and sixth recipients remain visible before Enter', async ({ page }, info) => {
    const { dialog, people } = await recipientFixture(page);
    const input = dialog.getByRole('combobox', { name: 'To', exact: true });
    await input.fill('PickerReview');
    const list = dialog.getByRole('listbox', { name: 'Suggested people', exact: true });
    await expect(list.getByRole('option')).toHaveCount(6);
    const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    for (let index = 0; index < 6; index++) {
      if (index) await input.press('ArrowDown');
      await expect(input).toBeFocused();
      await expect(list.getByRole('option').nth(index)).toHaveAttribute('aria-selected', 'true');
      await expect.poll(async () => {
        const b = await activeRecipientBounds(input);
        return !!b && b.top >= b.listTop - 1 && b.bottom <= b.listBottom + 1 && b.hit;
      }, { message: `keyboard-highlighted recipient${index + 1} is visible and hit-accessible without test auto-scroll` }).toBe(true);
    }
    expect((await activeRecipientBounds(input))!.scroll).toBeGreaterThan(0);
    await input.press('ArrowUp'); await expect(list.getByRole('option').nth(4)).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowDown'); await expect(list.getByRole('option').nth(5)).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: info.outputPath('last-keyboard-recipient-visible.png') });
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(before);
    await input.press('Enter');
    await expect(dialog.getByRole('button', { name: `Remove ${people[5].name}`, exact: true })).toBeVisible();
    await expect(dialog.getByRole('listbox')).toHaveCount(0);
  });
  test('an80-character recipient keeps a44px Remove target and bounded chip', async ({ page }, info) => {
    const { dialog, people } = await recipientFixture(page, true);
    const input = dialog.getByRole('combobox', { name: 'To', exact: true });
    await input.fill(people[5].email);
    await dialog.getByRole('option').click();
    const remove = dialog.getByRole('button', { name: `Remove ${people[5].name}`, exact: true });
    await expect(remove).toHaveCount(1);
    const geometry = await remove.evaluate(node => {
      const r = node.getBoundingClientRect(), chip = node.parentElement!, c = chip.getBoundingClientRect();
      const d = node.closest('[role="dialog"]')!.getBoundingClientRect();
      const label = chip.querySelector('span')!;
      return { width: r.width, height: r.height, x: c.x, right: c.right, dialogX: d.x, dialogRight: d.right,
        overflow: chip.scrollWidth - chip.clientWidth, labelClipped: label.scrollWidth > label.clientWidth,
        hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.x).toBeGreaterThanOrEqual(geometry.dialogX); expect(geometry.right).toBeLessThanOrEqual(geometry.dialogRight);
    expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.labelClipped).toBe(true); expect(geometry.hit).toBe(true);
    await page.screenshot({ path: info.outputPath('long-recipient-chip-remove-target.png') });
    await remove.click(); await expect(remove).toHaveCount(0); await expect(input).toBeVisible();
    await expect(input).toHaveValue('');
  });
});
