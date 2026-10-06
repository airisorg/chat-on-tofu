import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from '@playwright/test';

const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests', testMatch: '**/mini.spec.ts', timeout: 30_000,
  expect: { timeout: 7_000 }, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/mini-results',
  use: { baseURL, viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: {
      executablePath: chromiumExecutable(),
    } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
