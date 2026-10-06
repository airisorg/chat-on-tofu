import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

function proofPath(info: TestInfo, filename: string) {
  const directory = process.env.CHAT_EVIDENCE_DIR ? resolve(process.env.CHAT_EVIDENCE_DIR) : info.outputDir;
  mkdirSync(directory, { recursive: true });
  return resolve(directory, filename);
}

async function demo(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} sidebar avatars, icons and names share columns with a readable group gap`, async ({ page }, info) => {
    await demo(page, theme);
    const nav = page.getByRole("complementary", { name: "Chat navigation" });
    const home = nav.getByRole("button", { name: "Home", exact: true });
    const dm = nav.getByRole("button", { name: "Maya Chen", exact: true });
    const icon = await home.locator("svg").boundingBox();
    const avatar = await dm.locator(":scope > .avatar").boundingBox();
    const homeLabel = await home.locator(":scope > span").first().boundingBox();
    const dmLabel = await dm.locator(":scope > span:nth-child(2)").boundingBox();
    expect(Math.abs(icon!.x + icon!.width / 2 - avatar!.x - avatar!.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(homeLabel!.x - dmLabel!.x)).toBeLessThanOrEqual(1);
    const heading = await nav.locator(".sidebar-group:has(#direct-conversations) .sidebar-group-heading").boundingBox();
    const first = await nav.locator("#direct-conversations > button").first().boundingBox();
    expect(first!.y - heading!.y - heading!.height).toBeGreaterThanOrEqual(6);
    expect(first!.y - heading!.y - heading!.height).toBeLessThanOrEqual(12);
    await nav.getByRole("button", { name: "Direct messages", exact: true }).click();
    await expect(dm).toBeHidden();
    await nav.getByRole("button", { name: "Direct messages", exact: true }).click();
    await expect(dm).toBeVisible();
    if (info.project.name === "Chrome") {
      await nav.screenshot({ path: proofPath(info, `sidebar-alignment-${theme}-browser-test.png`) });
    }
  });

  test(`${theme} settings text remains readable and controls align within the dialog`, async ({ page }, info) => {
    await demo(page, theme);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const title = await dialog.getByRole("heading").evaluate(node => ({ size: parseFloat(getComputedStyle(node).fontSize), weight: getComputedStyle(node).fontWeight }));
    expect(title.size).toBe(22);
    expect(title.weight).toBe("400");
    const typography = await dialog.locator(".setting-row strong,.setting-row small").evaluateAll(nodes => nodes.map(node => ({ secondary: node.matches("small"), size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) })));
    for (const text of typography) {
      expect(text.size).toBeGreaterThanOrEqual(text.secondary ? 12 : 14);
      expect(text.line).toBeGreaterThanOrEqual(text.secondary ? 16 : 20);
    }
    const select = dialog.getByRole("combobox", { name: "Appearance" });
    await select.selectOption(theme === "light" ? "dark" : "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "light" ? "dark" : "light");
    await select.selectOption(theme);
    const edges = await dialog.locator(".setting-row > span").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
    if (info.project.name === "Chrome") await dialog.screenshot({ path: proofPath(info, `settings-spacing-${theme}-browser-test.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test(`${theme} wide message history stays centered and sender/date spacing stays compact`, async ({ page }, info) => {
    await page.setViewportSize({ width: 2200, height: 1100 });
    await demo(page, theme);
    const row = page.getByRole("main").getByRole("article").filter({ hasText: "Good morning, team!" });
    const wrapper = row.locator("xpath=..");
    const alignment = await wrapper.evaluate(node => {
      const rect = node.getBoundingClientRect(), scroll = node.parentElement!, parent = scroll.getBoundingClientRect(), style = getComputedStyle(scroll);
      const left = parseFloat(style.paddingLeft), right = parseFloat(style.paddingRight);
      return { width: rect.width, center: rect.x + rect.width / 2, contentCenter: parent.x + scroll.clientLeft + left + (scroll.clientWidth - left - right) / 2 };
    });
    expect(alignment.width).toBeLessThanOrEqual(896);
    expect(alignment.width).toBeGreaterThanOrEqual(800);
    expect(Math.abs(alignment.center - alignment.contentCenter)).toBeLessThanOrEqual(1);
    const avatar = await row.locator(":scope > .avatar").boundingBox();
    const name = await row.locator(".message-meta strong").boundingBox();
    const text = await row.locator(".message-text").boundingBox();
    expect(name!.x - avatar!.x - avatar!.width).toBe(16);
    expect(Math.abs(name!.x - text!.x)).toBeLessThanOrEqual(1);
    expect(text!.y - name!.y - name!.height).toBeGreaterThanOrEqual(1);
    expect(text!.y - name!.y - name!.height).toBeLessThanOrEqual(4);
    const date = wrapper.locator(".date-divider");
    expect(await date.locator("span").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(12);
    const dateBox = await date.boundingBox(), rowBox = await row.boundingBox();
    expect(rowBox!.y - dateBox!.y - dateBox!.height).toBe(8);
    if (info.project.name === "Chrome") await page.getByRole("main").screenshot({ path: proofPath(info, `wide-message-column-${theme}-browser-test.png`) });
  });
}

test.describe("phone", () => {
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test("settings preserve touch targets, input sizing and bounded text", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page, "dark");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("dialog", { name: "More in Chat", exact: true }).getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const select = dialog.getByRole("combobox", { name: "Appearance" });
  expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await select.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  for (const control of await dialog.getByRole("button").all()) {
    const rect = await control.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const secondary = await dialog.locator(".setting-row small").evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  expect(Math.min(...secondary)).toBeGreaterThanOrEqual(12);
  if (info.project.name === "Chrome") await dialog.screenshot({ path: proofPath(info, "iphone-dark-settings-spacing-browser-test.png") });
});
});
