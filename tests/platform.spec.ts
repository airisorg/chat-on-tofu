import { expect, test, type Page, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// These are local engine/layout simulations, not claims of physical iPhone or
// installed Safari testing. UA/standalone/visualViewport mocks exercise real UI
// branches without visiting production or requesting OAuth/microphone access.
const main = (page: Page) => page.getByRole("main");
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.doc).toBeLessThanOrEqual(size.width + 1);
  expect(size.body).toBeLessThanOrEqual(size.width + 1);
}
async function openDesign(page: Page, compact: boolean) {
  if (compact) {
    await main(page)
      .getByRole("button", { name: /Design team/ })
      .first()
      .click();
  } else {
    await page
      .getByRole("complementary", { name: "Chat navigation" })
      .getByRole("button", { name: "Design team", exact: true })
      .click();
  }
  await expect(
    main(page).getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
}
const sizes = [
  {
    name: "small phone portrait",
    width: 320,
    height: 568,
    touch: true,
    compact: true,
  },
  {
    name: "phone portrait",
    width: 390,
    height: 844,
    touch: true,
    compact: true,
  },
  {
    name: "phone landscape",
    width: 844,
    height: 390,
    touch: true,
    compact: true,
  },
  {
    name: "tablet portrait",
    width: 834,
    height: 1112,
    touch: true,
    compact: false,
  },
  {
    name: "tablet landscape",
    width: 1024,
    height: 768,
    touch: true,
    compact: false,
  },
  { name: "desktop", width: 1440, height: 960, touch: false, compact: false },
];
for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: size.compact,
    });
    test("layout, typing, sending and focus-trapped details work", async ({
      page,
    }) => {
      await demo(page);
      await noOverflow(page);
      if (size.compact) {
        await expect(
          main(page).getByRole("heading", { name: "Home", exact: true }),
        ).toBeVisible();
        await expect(page.locator(".sidebar")).toBeHidden();
        await expect(
          page.getByRole("navigation", { name: "Main navigation" }),
        ).toBeVisible();
      } else
        await expect(
          page.getByRole("complementary", { name: "Chat navigation" }),
        ).toBeVisible();
      await openDesign(page, size.compact);
      await noOverflow(page);
      const input = main(page).getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      const text = `${size.name} interaction works`;
      await input.fill(text);
      await main(page)
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        main(page).getByRole("article").filter({ hasText: text }),
      ).toBeVisible();
      const bounds = await input.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
      if (size.compact)
        expect(
          await input.evaluate((node) =>
            parseFloat(getComputedStyle(node).fontSize),
          ),
        ).toBeGreaterThanOrEqual(16);
      if (size.touch) {
        const dimensions = await page
          .locator(".conversation-header .icon-button")
          .evaluateAll((nodes) =>
            nodes
              .filter((n) => getComputedStyle(n).display !== "none")
              .map((n) => ({
                width: n.getBoundingClientRect().width,
                height: n.getBoundingClientRect().height,
              })),
          );
        for (const d of dimensions) {
          expect(d.width).toBeGreaterThanOrEqual(44);
          expect(d.height).toBeGreaterThanOrEqual(44);
        }
      }
      const details = page.getByRole("button", {
        name: "Conversation details",
        exact: true,
      });
      await details.click();
      const dialog = page.getByRole("dialog", {
        name: "Design team",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog.evaluate((n) => n.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((n) => n.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(details).toBeFocused();
      await noOverflow(page);
    });
  });
}

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
async function installPage(
  browser: Browser,
  baseURL: string | undefined,
  ua: string,
  installed = false,
  ipad = false,
) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: ua,
  });
  if (installed)
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", {
        value: true,
        configurable: true,
      }),
    );
  if (ipad)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
    });
  const page = await context.newPage();
  await demo(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "More in Chat", exact: true })
    .getByRole("button", { name: "Add to Home Screen", exact: true })
    .click();
  return {
    context,
    page,
    dialog: page.getByRole("dialog", {
      name: "Make yourself at home",
      exact: true,
    }),
  };
}

test("installation help distinguishes iPhone Safari, other iOS browsers, iPad and installed mode", async ({
  browser,
  baseURL,
}) => {
  for (const variant of [
    { ua: iphone, installed: false, ipad: false },
    {
      ua: iphone.replace("Version/18.0", "CriOS/130.0"),
      installed: false,
      ipad: false,
    },
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      installed: false,
      ipad: true,
    },
    { ua: iphone, installed: true, ipad: false },
  ]) {
    const { context, dialog } = await installPage(
      browser,
      baseURL,
      variant.ua,
      variant.installed,
      variant.ipad,
    );
    try {
      if (variant.installed) {
        await expect(
          dialog.getByRole("heading", {
            name: "You’re using the installed app",
          }),
        ).toBeVisible();
        await expect(
          dialog.getByText("Add to Home Screen", { exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(dialog.getByText("Safari", { exact: true })).toBeVisible();
        await expect(
          dialog.getByText("Add to Home Screen", { exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "Install Chat", exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test("desktop and Android installation instructions match their platform", async ({
  browser,
  baseURL,
}) => {
  const desktop = await browser.newContext({
    baseURL,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  });
  const page = await desktop.newPage();
  await demo(page);
  await page
    .getByRole("button", { name: "Help and installation", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Make yourself at home",
    exact: true,
  });
  await expect(dialog.getByText("Chrome", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Edge", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Safari", { exact: true })).toHaveCount(0);
  await desktop.close();
  const android = await installPage(
    browser,
    baseURL,
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
  );
  await expect(
    android.dialog.getByText("Install app", { exact: true }),
  ).toBeVisible();
  await expect(
    android.dialog.getByText("Add to Home screen", { exact: true }),
  ).toBeVisible();
  await android.context.close();
});

test.describe("visual viewport and storage resilience", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("visual viewport keyboard resize keeps composer reachable and pinch zoom preserves layout", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 844,
        width: 390,
        scale: 1,
        offsetTop: 0,
        offsetLeft: 0,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      (
        window as unknown as {
          testViewport: (height: number, scale: number) => void;
        }
      ).testViewport = (height, scale) => {
        viewport.height = height;
        viewport.scale = scale;
        viewport.dispatchEvent(new Event("resize"));
      };
    });
    await demo(page);
    await openDesign(page, true);
    const input = main(page).getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await input.fill("Keyboard viewport acceptance");
    await input.focus();
    await page.evaluate(() =>
      (
        window as unknown as {
          testViewport: (height: number, scale: number) => void;
        }
      ).testViewport(460, 1),
    );
    await expect
      .poll(async () => {
        const b = await main(page)
          .getByRole("button", { name: "Send message", exact: true })
          .boundingBox();
        return b!.y + b!.height;
      })
      .toBeLessThanOrEqual(461);
    await main(page)
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      main(page)
        .getByRole("article")
        .filter({ hasText: "Keyboard viewport acceptance" }),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as {
          testViewport: (height: number, scale: number) => void;
        }
      ).testViewport(422, 2),
    );
    await expect
      .poll(() =>
        page
          .locator(".app-shell")
          .evaluate((n) => n.getBoundingClientRect().height),
      )
      .toBe(844);
    await noOverflow(page);
  });
  test("blocked local storage does not crash the app or appearance settings", async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get: () => {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
    });
    await demo(page);
    await expect(
      main(page).getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "More in Chat", exact: true })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .selectOption("dark");
    await expect
      .poll(() => page.locator("html").getAttribute("data-theme"))
      .toBe("dark");
    expect(failures).toEqual([]);
  });
});

test("dark theme keeps navigation, brand and composer controls readable", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("relay-theme", "dark"));
  await demo(page);
  await expect
    .poll(() => page.locator("html").getAttribute("data-theme"))
    .toBe("dark");
  const samples = await page
    .locator(
      ".brand, .nav-item, .new-chat-button, .sidebar-conversation.selected, .composer-controls>.icon-button, .conversation-header-actions>.icon-button",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getBoundingClientRect().width > 0)
        .map((n) => {
          const style = getComputedStyle(n);
          let parent: Element | null = n;
          let background = "";
          while (parent) {
            const color = getComputedStyle(parent).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              background = color;
              break;
            }
            parent = parent.parentElement;
          }
          return {
            label: n.getAttribute("aria-label") || n.textContent?.trim(),
            foreground: style.color,
            background,
          };
        }),
    );
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const channel = v / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  for (const sample of samples) {
    const a = luminance(sample.foreground),
      b = luminance(sample.background);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      `${sample.label}: ${sample.foreground} on ${sample.background}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test.describe("landscape keyboard contraction", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  test("composer remains reachable in a 190px visual viewport", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 390,
        width: 844,
        scale: 1,
        offsetTop: 0,
        offsetLeft: 0,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
      (window as unknown as { contractViewport: () => void }).contractViewport =
        () => {
          viewport.height = 190;
          viewport.dispatchEvent(new Event("resize"));
        };
    });
    await demo(page);
    await openDesign(page, true);
    await main(page)
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Landscape keyboard message");
    await page.evaluate(() =>
      (
        window as unknown as { contractViewport: () => void }
      ).contractViewport(),
    );
    const send = main(page).getByRole("button", {
      name: "Send message",
      exact: true,
    });
    await expect
      .poll(async () => {
        const box = await send.boundingBox();
        return box!.y + box!.height;
      })
      .toBeLessThanOrEqual(191);
    await send.click();
    await expect(
      main(page)
        .getByRole("article")
        .filter({ hasText: "Landscape keyboard message" }),
    ).toBeVisible();
    await noOverflow(page);
  });
});

test("installed-mode Google sign-in derives the broker return from this app origin", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        supabaseUrl: "https://auth.example.test",
        supabaseAnonKey: "public-test-key",
        databaseConfigured: true,
      }),
    }),
  );
  let broker = "";
  // This intercepts the outbound navigation. It never contacts Tofu or Google
  // and does not establish Safari's physical standalone-context behavior.
  await page.route("https://oauth.trytofu.ai/start?*", (route) => {
    broker = route.request().url();
    return route.fulfill({
      contentType: "text/html",
      body: "<p>Intercepted sign-in navigation</p>",
    });
  });
  await page.goto("/");
  const signIn = page.getByRole("button", {
    name: "Continue with Google",
    exact: true,
  });
  await expect(signIn).toBeEnabled();
  await signIn.click();
  await expect.poll(() => broker).not.toBe("");
  const url = new URL(broker);
  expect(url.origin).toBe("https://oauth.trytofu.ai");
  expect(url.searchParams.get("return")).toBe(`${new URL(baseURL!).origin}/`);
});

test("real M4A picker alias sends as canonical MP4 audio, decodes and survives reload", async ({
  page,
}) => {
  const fixture = readFileSync(
    resolve(process.cwd(), "tests/fixtures/picker-tone.m4a"),
  );
  expect(fixture.subarray(4, 8).toString("ascii")).toBe("ftyp");
  await demo(page);
  await openDesign(page, false);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "picker-tone.m4a",
      mimeType: "audio/x-m4a",
      buffer: fixture,
    });
  await expect(
    main(page).getByRole("button", {
      name: "Remove picker-tone.m4a",
      exact: true,
    }),
  ).toBeVisible();
  await main(page)
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Real picker M4A acceptance");
  await main(page)
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  let row = main(page)
    .getByRole("article")
    .filter({ hasText: "Real picker M4A acceptance" });
  let audio = row.locator("audio");
  await expect(audio).toHaveAttribute("src", /^data:audio\/mp4;base64,/);
  await expect
    .poll(() => audio.evaluate((n) => (n as HTMLAudioElement).duration))
    .toBeGreaterThan(0.9);
  await expect
    .poll(() => audio.evaluate((n) => (n as HTMLAudioElement).duration))
    .toBeLessThan(1.2);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await openDesign(page, false);
  row = main(page)
    .getByRole("article")
    .filter({ hasText: "Real picker M4A acceptance" });
  audio = row.locator("audio");
  await expect(audio).toHaveAttribute("src", /^data:audio\/mp4;base64,/);
  await expect(
    row.getByRole("link", { name: "picker-tone.m4a", exact: true }),
  ).toHaveAttribute("download", "picker-tone.m4a");
});
