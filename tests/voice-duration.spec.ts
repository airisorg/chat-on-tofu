import { evidenceDirectory } from "./browser-config";
import { expect, test } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('actual MediaRecorder captures beyond one minute and preserves playable audio', async ({ page, context, baseURL }, info) => {
  // Real elapsed capture through Chrome's synthetic microphone device. No
  // ambient audio, patched clock or mocked MediaRecorder is involved.
  await context.grantPermissions(['microphone'], { origin: new URL(baseURL!).origin });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Record voice note', exact: true }).click();
  const recording = page.getByRole('dialog', { name: 'Record a voice note', exact: true });
  await recording.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(recording.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect(recording.getByText('01:01', { exact: true })).toBeVisible({ timeout: 68000 });
  await recording.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const audio = recording.locator('audio[aria-label="Voice message preview"]');
  await expect(audio).toBeVisible();
  const encoded = await audio.getAttribute('src');
  expect(encoded).toMatch(/^data:audio\//);
  const [, mime, bytes] = encoded!.match(/^data:(audio\/[^;]+);base64,(.+)$/)!;
  const buffer = Buffer.from(bytes, 'base64');
  expect(buffer.length).toBeGreaterThan(100000);
  expect(buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  const dir = evidenceDirectory(info, 'long-audio');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `captured-61-seconds.${mime === 'audio/mp4' ? 'm4a' : 'webm'}`);
  await writeFile(path, buffer);
  await audio.evaluate(async element => { await (element as HTMLAudioElement).play(); });
  await expect.poll(() => audio.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await audio.evaluate(el => (el as HTMLAudioElement).pause());
  await recording.getByRole('button', { name: 'Use recording', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('main').getByRole('link', { name: /Voice message\.(m4a|webm|ogg)/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('main').getByRole('link', { name: /Voice message\.(m4a|webm|ogg)/ })).toBeVisible();
  console.log(JSON.stringify({ capture: 'real-time synthetic microphone', savedBytes: buffer.length, mime, path }));
});
