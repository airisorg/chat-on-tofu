import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

function wav(seconds: number) {
  const rate = 8000,
    count = Math.round(seconds * rate),
    buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    buffer.writeInt16LE(
      Math.round(
        Math.sin((2 * Math.PI * 220 * i) / rate) *
          12000 *
          (i / count < 0.3 ? 0.2 : i / count < 0.7 ? 0.9 : 0.4),
      ),
      44 + i * 2,
    );
  return buffer;
}
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  const main = page.getByRole("main");
  if (
    !(await main
      .getByRole("heading", { name: "Design team", exact: true })
      .isVisible())
  )
    await main
      .getByRole("button", { name: /Design team/ })
      .first()
      .click();
}
async function sendAudio(page: Page, seconds: number, label: string) {
  const bytes = wav(seconds),
    main = page.getByRole("main");
  await page.locator(".composer-wrap input[type=file]").setInputFiles({
    name: label + ".wav",
    mimeType: "audio/wav",
    buffer: bytes,
  });
  await main.getByRole("textbox", { name: "Message", exact: true }).fill(label);
  await main.getByRole("button", { name: "Send message", exact: true }).click();
  const row = main.getByRole("article").filter({ hasText: label });
  const player = row.getByRole("group", {
    name: `Voice message: ${label}.wav`,
    exact: true,
  });
  await expect(player).toBeVisible();
  await expect
    .poll(() =>
      row
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.duration),
    )
    .toBeCloseTo(seconds, 1);
  return { bytes, row, player };
}
test.beforeEach(async ({ page }) => {
  await demo(page);
});
test("61-second voice message shows real duration, waveform, playback, seek, rate and exact download", async ({
  page,
}, testInfo) => {
  const { bytes, row, player } = await sendAudio(
    page,
    61,
    "Synthetic61secondvoice",
  );
  const audio = row.locator("audio");
  expect(await audio.evaluate((node: HTMLAudioElement) => node.controls)).toBe(
    false,
  );
  await expect(player.getByLabel("Playback time")).toHaveText("0:00 / 1:01");
  await expect(player.locator('[data-waveform="decoded"]')).toBeVisible();
  const heights = await player
    .locator("svg[data-waveform] rect")
    .evaluateAll((rects) =>
      rects.map((rect) => Number(rect.getAttribute("height"))),
    );
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  const slider = player.getByRole("slider", {
    name: "Seek Synthetic61secondvoice.wav",
    exact: true,
  });
  await slider.focus();
  await slider.press("End");
  await slider.press("ArrowLeft");
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeCloseTo(60.9, 1);
  await slider.press("Home");
  await player
    .getByRole("button", { name: "Play voice message", exact: true })
    .click();
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0);
  await player
    .getByRole("button", { name: "Pause voice message", exact: true })
    .click();
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(
    true,
  );
  await player
    .getByRole("button", { name: "Playback speed 1×", exact: true })
    .click();
  expect(
    await audio.evaluate((node: HTMLAudioElement) => node.playbackRate),
  ).toBe(1.5);
  await player
    .getByRole("button", { name: "Playback speed 1.5×", exact: true })
    .click();
  expect(
    await audio.evaluate((node: HTMLAudioElement) => node.playbackRate),
  ).toBe(2);
  const downloading = page.waitForEvent("download");
  await player
    .getByRole("link", {
      name: "Download Synthetic61secondvoice.wav",
      exact: true,
    })
    .click();
  const download = await downloading,
    path = testInfo.outputPath("synthetic-61-second-voice.wav");
  await download.saveAs(path);
  expect(readFileSync(path).equals(bytes)).toBe(true);
  await player.screenshot({
    path: testInfo.outputPath("desktop-voice-player.png"),
  });
  await player
    .getByRole("button", { name: "Play voice message", exact: true })
    .click();
  const handle = await audio.elementHandle();
  await expect
    .poll(() => handle!.evaluate((node: HTMLAudioElement) => node.paused))
    .toBe(false);
  await page
    .getByRole("complementary", { name: "Chat navigation" })
    .getByRole("button", { name: "Maya Chen", exact: true })
    .click();
  await expect
    .poll(() => handle!.evaluate((node: HTMLAudioElement) => node.paused))
    .toBe(true);
});
test("long audio retains an honest progress track and playback errors keep download available", async ({
  page,
}) => {
  const { row, player } = await sendAudio(page, 121, "Synthetic121secondaudio");
  await expect(player.getByLabel("Playback time")).toHaveText("0:00 / 2:01");
  await expect(player.locator('[data-waveform="unavailable"]')).toBeVisible();
  await expect(player.locator('[data-waveform="decoded"]')).toHaveCount(0);
  await row
    .locator("audio")
    .evaluate((node: HTMLAudioElement) =>
      node.dispatchEvent(new Event("error")),
    );
  await expect(row.getByRole("alert")).toContainText("Download it to listen");
  await expect(
    player.getByRole("link", {
      name: "Download Synthetic121secondaudio.wav",
      exact: true,
    }),
  ).toBeVisible();
});
test.describe("dark phone media", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: "dark",
  });
  test("malformed image fallback keeps an actionable 44px download and exact original bytes", async ({ page }, testInfo) => {
    // Valid PNG signature, deliberately truncated before a decodable image.
    // This exercises the real browser image-error path, not a synthetic error.
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const main = page.getByRole("main");
    await main.locator(".composer-wrap input[type=file]").setInputFiles({
      name: "Truncated-image.png", mimeType: "image/png", buffer: bytes,
    });
    await main.getByRole("textbox", { name: "Message", exact: true }).fill("Malformed image touch target acceptance");
    await main.getByRole("button", { name: "Send message", exact: true }).click();
    const row = main.getByRole("article").filter({ hasText: "Malformed image touch target acceptance" });
    await expect(row.getByText("Image preview unavailable. Download the original file.", { exact: true })).toBeVisible();
    const download = row.getByRole("link", { name: "Download Truncated-image.png", exact: true });
    await download.scrollIntoViewIfNeeded();
    const bounds = (await download.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await download.evaluate(node => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    const downloading = page.waitForEvent("download");
    await download.click();
    const original = await downloading;
    expect(original.suggestedFilename()).toBe("Truncated-image.png");
    const path = testInfo.outputPath("truncated-image-original.png");
    await original.saveAs(path);
    expect(readFileSync(path).equals(bytes)).toBe(true);
  });
  test("audio controls retain 44px targets and clean image tiles open a downloadable preview", async ({
    page,
  }, testInfo) => {
    const { player } = await sendAudio(page, 2, "Syntheticphonevoice");
    for (const control of await player.getByRole("button").all()) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const download = player.getByRole("link", {
      name: "Download Syntheticphonevoice.wav",
      exact: true,
    });
    expect((await download.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const contrast = await player
      .getByLabel("Playback time")
      .evaluate((element) => {
        const rgb = (value: string) =>
          value
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        const luminance = (color: number[]) =>
          color
            .map((channel) => {
              const v = channel / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (total, value, index) =>
                total + value * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        const foreground = luminance(rgb(getComputedStyle(element).color));
        const background = luminance(
          rgb(
            getComputedStyle(element.closest('[role="group"]')!)
              .backgroundColor,
          ),
        );
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    const box = await player.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await player.screenshot({
      path: testInfo.outputPath("iphone-dark-voice-player.png"),
    });
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await page.locator(".composer-wrap input[type=file]").setInputFiles({
      name: "Synthetic-image.png",
      mimeType: "image/png",
      buffer: image,
    });
    const main = page.getByRole("main");
    await main
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Image preview acceptance");
    await main
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const row = main
      .getByRole("article")
      .filter({ hasText: "Image preview acceptance" });
    const tile = row.getByRole("link", {
      name: "Preview Synthetic-image.png",
      exact: true,
    });
    await expect(tile).toBeVisible();
    const tileBox = await tile.boundingBox();
    expect(tileBox!.width).toBeGreaterThanOrEqual(44);
    expect(tileBox!.height).toBeGreaterThanOrEqual(44);
    await expect(
      tile.getByRole("img", { name: "Synthetic-image.png", exact: true }),
    ).toBeVisible();
    await expect(tile.locator("span")).toHaveCount(0);
    await tile.click();
    const preview = page.getByRole("dialog", {
      name: "Image preview",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("link", { name: /Download/ })).toBeVisible();
    await preview
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
});
