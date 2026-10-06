import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestInfo } from '@playwright/test';

/** Fault fixtures and synthetic accounts must never target a hosted service. */
export function localBaseUrl(): string {
  const value = process.env.APP_URL || 'http://127.0.0.1:3000';
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Browser tests require an HTTP loopback server. Set APP_URL to your local dev server.');
  }
  return value;
}

/** Prefer a configured/system Chrome; otherwise use Playwright's installed Chromium. */
export function chromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined;
}

/** Optional review captures belong outside source; ordinary runs use ignored test output. */
export function evidenceDirectory(info: TestInfo, folder = ''): string {
  return process.env.CHAT_EVIDENCE_DIR
    ? resolve(process.env.CHAT_EVIDENCE_DIR, folder)
    : info.outputPath(folder);
}
