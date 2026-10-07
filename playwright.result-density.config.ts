import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/result-density.spec.ts',
  timeout: 60000,
  expect: {
    timeout: 6000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
  },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/result-density',
  use: {
    baseURL: localBaseUrl(),
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Chrome',
      use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } },
    },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
