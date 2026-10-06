import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Chat navigation" })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
});

test("find a known person by name, select with Enter, and reuse the existing direct message", async ({
  page,
}, testInfo) => {
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  await expect(modal).toHaveAttribute("aria-modal", "false");
  await expect(modal.getByRole("heading")).toHaveCount(0);
  await expect(modal.locator(".kind-tabs")).toHaveCount(0);
  await expect(
    modal.getByRole("textbox", { name: "Conversation name" }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Start chat", exact: true }),
  ).toBeDisabled();
  const to = modal.getByRole("combobox", { name: "To", exact: true });
  await expect(to).toBeFocused();
  const field = await to.locator("..").boundingBox();
  const input = await to.boundingBox();
  const panel = await modal.boundingBox();
  expect(panel!.width).toBe(296);
  expect(panel!.height).toBe(510);
  expect(field!.y).toBe(panel!.y);
  expect(field!.height).toBe(52);
  expect(input!.height).toBe(36);
  const fieldStyle = await to.locator("..").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fill: style.backgroundColor,
      radius: style.borderRadius,
      bottom: style.borderBottomWidth,
    };
  });
  expect(fieldStyle).toEqual({
    fill: "rgb(221, 227, 234)",
    radius: "4px 4px 0px 0px",
    bottom: "2px",
  });
  for (const action of ["Create a space", "Start a group"]) {
    const button = modal.getByRole("button", { name: action, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(
      field!.y + field!.height,
    );
  }
  const row = modal.getByRole("option").first();
  const rowBox = await row.boundingBox();
  const avatar = await row.locator(":scope > span").first().boundingBox();
  expect(rowBox!.height).toBe(52);
  expect(avatar!.width).toBe(32);
  expect(avatar!.height).toBe(32);
  expect(avatar!.x - rowBox!.x).toBe(12);
  expect((await row.locator("strong").boundingBox())!.x - rowBox!.x).toBe(60);
  for (const [selector, size, line] of [
    ["strong", "14px", "20px"],
    ["small", "12px", "16px"],
  ]) {
    const metric = await row.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        line: style.lineHeight,
      };
    });
    expect(metric).toEqual({ size, weight: "400", line });
  }
  const list = await modal.getByRole("listbox").evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderWidth, radius: style.borderRadius };
  });
  expect(list).toEqual({ border: "0px", radius: "0px" });
  const footer = modal.getByRole("button", { name: "Start chat", exact: true });
  expect((await footer.boundingBox())!.height).toBe(36);
  await expect(footer).toHaveCSS("border-radius", "18px");
  await modal.screenshot({
    path: testInfo.outputPath("desktop-new-chat-picker.png"),
  });
  await to.fill("maya");
  await expect(
    modal.getByRole("option", { name: /Maya Chen.*maya@example.com/ }),
  ).toBeVisible();
  await to.press("Enter");
  await expect(
    modal.getByRole("button", { name: "Remove Maya Chen" }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { name: "Maya Chen", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Chat navigation" })
      .getByRole("button", { name: /^Maya Chen/ }),
  ).toHaveCount(1);
});

test("group suggestions exclude selected people and removable chips preserve other recipients", async ({
  page,
}) => {
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  await modal
    .getByRole("button", { name: "Start a group", exact: true })
    .click();
  const to = modal.getByRole("combobox", { name: "Add people", exact: true });
  await to.fill("Maya");
  await modal.getByRole("option", { name: /Maya Chen/ }).click();
  await to.fill("Sam");
  await modal.getByRole("option", { name: /Sam Rivera/ }).click();
  await expect(modal.getByRole("option", { name: /Maya Chen/ })).toHaveCount(0);
  await modal.getByRole("button", { name: "Remove Maya Chen" }).click();
  await expect(
    modal.getByRole("button", { name: "Remove Sam Rivera" }),
  ).toBeVisible();
  await to.fill("Jordan");
  await to.press("Enter");
  await modal.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { name: "Sam Rivera, Jordan Lee", exact: true }),
  ).toBeVisible();
});

test("partial unknown names never create a guessed invitation; full new email can be invited", async ({
  page,
}) => {
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  const to = modal.getByRole("combobox", { name: "To", exact: true });
  await to.fill("unlisted-person");
  await modal.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "complete email address",
  );
  await to.fill("new-person@example.com");
  await expect(
    modal.getByRole("option", { name: /new-person.*Invite/ }),
  ).toBeVisible();
  await to.press("Enter");
  await modal.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { name: "new-person", exact: true }),
  ).toBeVisible();
});

test("space permits no invitees and switching back to a DM limits chips to one person", async ({
  page,
}) => {
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  await modal
    .getByRole("button", { name: "Start a group", exact: true })
    .click();
  const to = modal.getByRole("combobox", { name: "Add people", exact: true });
  await to.fill("Maya");
  await to.press("Enter");
  await to.fill("Sam");
  await to.press("Enter");
  await modal
    .getByRole("button", { name: "Direct message", exact: true })
    .click();
  await expect(modal.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  await modal.getByRole("button", { name: "Remove Maya Chen" }).click();
  await modal
    .getByRole("button", { name: "Create a space", exact: true })
    .click();
  await modal
    .getByRole("textbox", { name: "Space name", exact: true })
    .fill("Private planning");
  await modal
    .getByRole("button", { name: "Create space", exact: true })
    .click();
  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { name: "Private planning", exact: true }),
  ).toBeVisible();
});

test("phone dark-mode suggestions, chips and validation remain legible and fit the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  const to = modal.getByRole("combobox", { name: "To", exact: true });
  await expect(to).toHaveCSS("font-size", "16px");
  await expect(modal.locator(".kind-tabs")).toBeVisible();
  for (const button of await modal
    .locator(".kind-tabs>button, .dialog-footer>button")
    .all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await to.fill("Maya");
  await expect(modal.getByRole("option", { name: /Maya Chen/ })).toBeVisible();
  await expect
    .poll(async () =>
      modal.getByRole("option", { name: /Maya Chen/ }).evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      }),
    )
    .toEqual({ color: "rgb(227, 227, 227)", background: "rgb(0, 74, 119)" });
  await page.screenshot({
    path: testInfo.outputPath("iphone-new-chat-picker.png"),
  });
  await to.press("Enter");
  const chip = modal.getByRole("button", { name: "Remove Maya Chen" });
  await expect(chip).toBeVisible();
  const size = await chip.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("opening an existing DM restores its draft and never copies another conversation’s draft", async ({
  page,
}) => {
  await page
    .getByRole("dialog", { name: "Start a conversation" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const main = page.getByRole("main");
  const sidebar = page.getByRole("complementary", { name: "Chat navigation" });
  await sidebar.getByRole("button", { name: "Maya Chen", exact: true }).click();
  await main
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Maya’s unsent draft");
  await sidebar
    .getByRole("button", { name: "Design team", exact: true })
    .click();
  await main
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Private draft for Design team");
  await page.locator("input[type=file]").setInputFiles({
    name: "design-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Design-only attachment"),
  });
  await sidebar.getByRole("button", { name: "New chat", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Start a conversation" });
  const to = popup.getByRole("combobox", { name: "To", exact: true });
  await to.fill("Maya");
  await to.press("Enter");
  await popup.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    main.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Maya’s unsent draft");
  await expect(
    main.getByRole("button", { name: "Remove design-only.txt", exact: true }),
  ).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "Design team", exact: true })
    .click();
  await expect(
    main.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Private draft for Design team");
  await expect(
    main.getByRole("button", { name: "Remove design-only.txt", exact: true }),
  ).toBeVisible();
});

test("typing your own email never opens an unrelated existing DM", async ({
  page,
}) => {
  const popup = page.getByRole("dialog", { name: "Start a conversation" });
  await popup
    .getByRole("combobox", { name: "To", exact: true })
    .fill("alex@example.com");
  await popup.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(popup.getByRole("alert")).toContainText("Choose another person");
  await expect(popup).toBeVisible();
});
