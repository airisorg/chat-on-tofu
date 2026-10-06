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
}) => {
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  await expect(
    modal.getByRole("textbox", { name: "Conversation name" }),
  ).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Start chat", exact: true }),
  ).toBeDisabled();
  const to = modal.getByRole("combobox", { name: "To", exact: true });
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
  await modal.getByRole("button", { name: "Group", exact: true }).click();
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
  await modal.getByRole("button", { name: "Group", exact: true }).click();
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
  await modal.getByRole("button", { name: "Space", exact: true }).click();
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
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const modal = page.getByRole("dialog", { name: "Start a conversation" });
  const to = modal.getByRole("combobox", { name: "To", exact: true });
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
  await page
    .locator("input[type=file]")
    .setInputFiles({
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
