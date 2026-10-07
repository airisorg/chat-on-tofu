import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoState, DEMO_STORAGE_KEY } from '../src/lib/demo';
import { evidenceDirectory } from './browser-config';

// Real native audio/image decoding in an isolated demo. Permission acquisition
// and MediaRecorder are synthetic only to make delayed/cancelled transitions
// deterministic; this is not a native microphone or physical-device test.
function wav(seconds = 15) {
  const rate = 8000, count = seconds * rate, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 6000), 44 + i * 2);
  return bytes;
}
const main = (page: Page) => page.getByRole('main');
const recorder = (page: Page) => page.getByRole('dialog', { name: 'Record a voice note', exact: true });
const first = (page: Page) => main(page).locator('#message-composition-audio-one');
const second = (page: Page) => main(page).locator('#message-composition-audio-two');

async function setup(page: Page, mode: 'normal' | 'hold-read' | 'hold-permission' = 'normal') {
  const state = createDemoState(), bytes = wav();
  state.messages = state.messages.filter(m => m.conversationId !== 'demo-design');
  for (const [index, label] of ['one', 'two'].entries()) state.messages.push({
    id: `composition-audio-${label}`, conversationId: 'demo-design', author: state.user,
    text: `Composition audio ${label}`, createdAt: new Date(Date.now() - (3 - index) * 60_000).toISOString(),
    reactions: [], attachments: [{ name: `${label}.wav`, type: 'audio/wav', size: bytes.length, url: 'data:audio/wav;base64,' + bytes.toString('base64') }],
  });
  // A legal PNG signature with truncated contents is accepted by the current
  // server signature validator but cannot be decoded as an image.
  const corrupt = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  state.messages.push({ id: 'composition-corrupt-image', conversationId: 'demo-design', author: state.user,
    text: 'Corrupt image', createdAt: new Date().toISOString(), reactions: [],
    attachments: [{ name: 'truncated.png', type: 'image/png', size: corrupt.length, url: 'data:image/png;base64,' + corrupt.toString('base64') }] });
  const recording = readFileSync(resolve(process.cwd(), 'tests/fixtures/picker-tone.m4a')).toString('base64');
  await page.addInitScript(({ state, key, recording, mode }) => {
    localStorage.setItem(key, JSON.stringify(state));
    type Controls = { stopped: number; reads: number; releaseRead: () => void; releasePermission: () => void };
    const controls: Controls = { stopped: 0, reads: 0, releaseRead: () => {}, releasePermission: () => {} };
    (window as unknown as { mediaFixture: Controls }).mediaFixture = controls;
    const stream = { getTracks: () => [{ stop: () => { controls.stopped++; } }] } as unknown as MediaStream;
    const getUserMedia = () => mode === 'hold-permission'
      ? new Promise<MediaStream>(resolve => { controls.releasePermission = () => resolve(stream); })
      : Promise.resolve(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const payload = Uint8Array.from(atob(recording), c => c.charCodeAt(0));
    let count = 0;
    class FixtureRecorder {
      static isTypeSupported(type: string) { return type === 'audio/mp4'; }
      state = 'inactive'; mimeType = 'audio/mp4'; number = ++count;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([payload], { type: 'audio/mp4' }) });
          this.onstop?.();
        });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FixtureRecorder });
    if (mode === 'hold-read') {
      const original = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function (blob: Blob) {
        if (blob.type === 'audio/mp4' && controls.reads++ === 0) {
          controls.releaseRead = () => original.call(this, blob);
        } else original.call(this, blob);
      };
    }
  }, { state, key: DEMO_STORAGE_KEY, recording, mode });
  await page.route('**/api/config', route => route.fulfill({ json: { supabaseUrl: '', supabaseAnonKey: '', databaseConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  if (!await main(page).getByRole('heading', { name: 'Design team', exact: true }).isVisible())
    await main(page).getByRole('button', { name: /Design team/ }).first().click();
  await expect(main(page).getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const dir = evidenceDirectory(info); mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${info.project.name}-${name}.png`);
  await page.screenshot({ path }); await info.attach(name, { path, contentType: 'image/png' });
}
async function record(page: Page) {
  await main(page).getByRole('button', { name: 'Record voice note', exact: true }).click();
  await recorder(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await recorder(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
}
async function play(row: Locator) {
  await row.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect.poll(() => row.locator('audio').evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
  expect(await row.locator('audio').evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
}
test('preparing a recording prevents a second capture and cancellation ignores its delayed result', async ({ page }, info) => {
  await setup(page, 'hold-read'); await record(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaFixture: { reads: number } }).mediaFixture.reads)).toBe(1);
  await capture(page, info, 'recording-preparing');
  await expect(recorder(page).getByRole('button', { name: /Preparing recording/ })).toBeDisabled();
  await expect(recorder(page).getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0);
  await recorder(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(() => (window as unknown as { mediaFixture: { releaseRead: () => void } }).mediaFixture.releaseRead());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main(page).locator('.draft-attachments audio')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { mediaFixture: { stopped: number } }).mediaFixture.stopped)).toBeGreaterThan(0);
});
test('a recording preview pauses an already playing message before adding and sending the exact audio', async ({ page }, info) => {
  await setup(page); await play(first(page)); await record(page);
  const preview = recorder(page).getByLabel('Voice message preview', { exact: true });
  await expect(preview).toBeVisible();
  const src = await preview.getAttribute('src');
  await preview.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await capture(page, info, 'recording-preview');
  await expect.poll(() => first(page).locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  const previewHandle = await preview.elementHandle();
  await preview.evaluate(async (audio: HTMLAudioElement) => { audio.currentTime = 0; await audio.play(); });
  await recorder(page).getByRole('button', { name: 'Use recording', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await previewHandle!.evaluate((audio: HTMLAudioElement) => audio.isConnected)).toBe(false);
  expect(await previewHandle!.evaluate((audio: HTMLAudioElement) => audio.paused), 'Detached recording preview must stop immediately rather than play invisibly').toBe(true);
  const draftAudio = main(page).locator('.draft-attachments audio');
  await expect(draftAudio).toHaveAttribute('src', src!);
  await draftAudio.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  await play(first(page));
  expect(await draftAudio.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  const draftHandle = await draftAudio.elementHandle();
  await draftAudio.evaluate(async (audio: HTMLAudioElement) => { audio.currentTime = 0; await audio.play(); });
  expect(await first(page).locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill('Preview sent exactly');
  await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
  const sent = main(page).getByRole('article').filter({ hasText: 'Preview sent exactly' });
  await expect(sent.locator('audio')).toHaveAttribute('src', src!);
  await expect(draftAudio).toHaveCount(0);
  expect(await draftHandle!.evaluate((audio: HTMLAudioElement) => audio.isConnected)).toBe(false);
  expect(await draftHandle!.evaluate((audio: HTMLAudioElement) => audio.paused), 'Sent draft preview must stop immediately when removed').toBe(true);
  await play(sent);
  expect(await sent.locator('audio').evaluate((audio: HTMLAudioElement) => Number.isFinite(audio.duration) && audio.duration > 0 && audio.error === null)).toBe(true);
});
test('a pop-up native draft preview and message player share one playback lane', async ({ page }) => {
  await setup(page);
  await main(page).getByRole('button', { name: 'Open in a pop-up', exact: true }).click();
  const mini = page.getByRole('region', { name: 'Mini conversation: Design team', exact: true });
  await mini.locator('input[type=file]').setInputFiles({ name: 'popup-preview.wav', mimeType: 'audio/wav', buffer: wav() });
  const preview = mini.getByLabel('Pop-up voice note preview', { exact: true });
  await expect(preview).toBeVisible();
  await play(first(page));
  await preview.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  expect(await first(page).locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  await play(first(page));
  expect(await preview.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  const handle = await preview.elementHandle();
  await preview.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  await mini.getByRole('button', { name: 'Close pop-up', exact: true }).click();
  await expect(mini).toHaveCount(0);
  expect(await handle!.evaluate((audio: HTMLAudioElement) => audio.isConnected)).toBe(false);
  expect(await handle!.evaluate((audio: HTMLAudioElement) => audio.paused), 'Closed pop-up preview must not continue playing invisibly').toBe(true);
});
test('two message players pause each other and navigation stops the detached audio', async ({ page }) => {
  await setup(page); await play(first(page)); await play(second(page));
  await expect.poll(() => first(page).locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  const handle = await second(page).locator('audio').elementHandle();
  await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'Maya Chen', exact: true }).click();
  await expect.poll(() => handle!.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
});
test('main native draft audio stops immediately when sent or its conversation closes', async ({ page }, info) => {
  await setup(page);
  await main(page).locator('.composer-wrap input[type=file]').setInputFiles({ name: 'main-preview.wav', mimeType: 'audio/wav', buffer: wav() });
  const preview = main(page).getByLabel('Voice note preview', { exact: true });
  await preview.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  const handle = await preview.elementHandle();
  await main(page).getByRole('textbox', { name: 'Message', exact: true }).fill('Long native preview send');
  await main(page).getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(main(page).getByRole('article').filter({ hasText: 'Long native preview send' })).toBeVisible();
  await expect(preview).toHaveCount(0);
  expect(await handle!.evaluate((audio: HTMLAudioElement) => audio.isConnected)).toBe(false);
  const removed = await handle!.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime }));
  if (!removed.paused) {
    // A fixed200ms observation distinguishes detached playback from an audio
    // status flag at one instant. The actual source lasts15seconds.
    await page.waitForTimeout(200);
    const after = await handle!.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime }));
    await info.attach('detached-main-audio', { body: JSON.stringify({ removed, after }), contentType: 'application/json' });
    expect(after.paused, `Detached time advanced from${removed.time} to${after.time}`).toBe(true);
  }
  await main(page).locator('.composer-wrap input[type=file]').setInputFiles({ name: 'main-preview.wav', mimeType: 'audio/wav', buffer: wav() });
  await preview.evaluate(async (audio: HTMLAudioElement) => { await audio.play(); });
  const navigating = await preview.elementHandle();
  await page.getByRole('complementary', { name: 'Chat navigation' }).getByRole('button', { name: 'Maya Chen', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(await navigating!.evaluate((audio: HTMLAudioElement) => audio.isConnected)).toBe(false);
  expect(await navigating!.evaluate((audio: HTMLAudioElement) => audio.paused), 'Closed main draft must not continue playing invisibly').toBe(true);
});
test('a failed image decode offers an original download rather than a broken preview', async ({ page }, info) => {
  await setup(page);
  const row = main(page).locator('#message-composition-corrupt-image');
  await row.scrollIntoViewIfNeeded();
  // Wait for the native decoder to fail; no synthetic error event is used.
  await expect.poll(() => row.evaluate(node => {
    const image = node.querySelector('img');
    return image ? image.complete && image.naturalWidth === 0 : !!node.querySelector('a[aria-label="Download truncated.png"]');
  })).toBe(true);
  await capture(page, info, 'image-decode-failure');
  await expect(row.getByText('Image preview unavailable. Download the original file.', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Preview truncated.png', exact: true })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await row.getByRole('link', { name: 'Download truncated.png', exact: true }).click();
  const downloaded = await downloading; await downloaded.saveAs(info.outputPath('truncated.png'));
  expect(readFileSync(info.outputPath('truncated.png'))).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
});
test('closing during microphone permission acquisition stops the late stream', async ({ page }) => {
  await setup(page, 'hold-permission');
  await main(page).getByRole('button', { name: 'Record voice note', exact: true }).click();
  await recorder(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recorder(page).getByRole('button', { name: 'Opening microphone…', exact: true })).toBeDisabled();
  await recorder(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(() => (window as unknown as { mediaFixture: { releasePermission: () => void } }).mediaFixture.releasePermission());
  await expect.poll(() => page.evaluate(() => (window as unknown as { mediaFixture: { stopped: number } }).mediaFixture.stopped)).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 360 }]) test(`voice preview controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
  await page.setViewportSize(viewport); await setup(page); await record(page);
  await expect(recorder(page).getByLabel('Voice message preview', { exact: true })).toBeVisible();
  const use = recorder(page).getByRole('button', { name: 'Use recording', exact: true });
  await use.scrollIntoViewIfNeeded();
  const box = await use.boundingBox(); expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(await use.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
  await capture(page, info, `preview-${viewport.width}x${viewport.height}`);
  await use.click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(main(page).locator('.draft-attachments audio')).toBeVisible();
});
