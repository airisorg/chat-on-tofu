import { expect, test, type Locator } from "@playwright/test";

async function readable(controls: Locator) {
  const values = await controls.evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => {
        let ancestor: Element | null = node;
        let background = "";
        while (ancestor) {
          background = getComputedStyle(ancestor).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent")
            break;
          ancestor = ancestor.parentElement;
        }
        return {
          foreground: getComputedStyle(node).color,
          background,
          label: node.textContent,
        };
      }),
  );
  expect(values.length).toBeGreaterThan(0);
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const value of values) {
    const a = luminance(value.foreground),
      b = luminance(value.background);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      value.label || "menu control",
    ).toBeGreaterThanOrEqual(4.5);
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("relay-theme", "dark"));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("compact nonmodal availability menu updates and persists all three real profile statuses", async ({
  page,
}) => {
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: "Active", exact: true }).click();
  let menu = page.getByRole("dialog", { name: "Availability", exact: true });
  await expect(menu).toHaveAttribute("aria-modal", "false");
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(320);
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
  await expect(
    menu.getByRole("button", { name: "Active", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await readable(menu.locator("button"));
  await menu.getByRole("button", { name: "Away", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "Away", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    header.getByRole("button", { name: "Away", exact: true }),
  ).toBeVisible();
  for (const [current, next] of [
    ["Away", "Do not disturb"],
    ["Do not disturb", "Active"],
  ]) {
    await header.getByRole("button", { name: current, exact: true }).click();
    menu = page.getByRole("dialog", { name: "Availability", exact: true });
    await menu.getByRole("button", { name: next, exact: true }).click();
    await expect(
      header.getByRole("button", { name: next, exact: true }),
    ).toBeVisible();
  }
  const opener = header.getByRole("button", { name: "Active", exact: true });
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Availability" })).toHaveCount(
    0,
  );
  await expect(opener).toBeFocused();
});

test("compact dark support menu opens real guidance, installation and appearance settings", async ({
  page,
}) => {
  const help = page.getByRole("button", {
    name: "Help and installation",
    exact: true,
  });
  await help.click();
  let menu = page.getByRole("dialog", {
    name: "Help and support",
    exact: true,
  });
  await expect(menu).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(320);
  await readable(menu.locator("button"));
  await menu.getByRole("button", { name: "Using Chat", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Using Chat", exact: true });
  await expect(guide).toHaveAttribute("aria-modal", "true");
  await expect(guide).toContainText("same email");
  await expect(guide).toContainText("Shift + Enter");
  await readable(guide.locator("p, strong, button"));
  await page.keyboard.press("Escape");
  await help.click();
  menu = page.getByRole("dialog", { name: "Help and support", exact: true });
  await menu
    .getByRole("button", { name: "Add to Home Screen", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Make yourself at home", exact: true }),
  ).toContainText("Installation is optional");
  await page.keyboard.press("Escape");
  await help.click();
  menu = page.getByRole("dialog", { name: "Help and support", exact: true });
  await menu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("combobox", { name: "Appearance", exact: true }),
  ).toHaveValue("dark");
});
