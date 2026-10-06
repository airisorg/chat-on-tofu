import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
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
  const filter = main.getByRole("checkbox", { name: "Threads", exact: true });
  await filter.click();
  await expect(filter).toHaveAttribute("aria-checked", "true");
  await main
    .getByRole("button")
    .filter({ hasText: "Good morning, team!" })
    .click();
  await expect(
    thread
      .getByRole("article")
      .filter({ hasText: "Thread filter verification reply" }),
  ).toBeVisible();
});
