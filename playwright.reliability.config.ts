import { defineConfig } from '@playwright/test';
const baseURL = process.env.APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Reliability checks require a local server.');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/reliability.spec.ts',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../work/qa/reliability-results',
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    actionTimeout: 10_000,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) },
  },
});
