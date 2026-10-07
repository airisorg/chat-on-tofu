import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/home-toolbar.spec.ts', '**/home-filter-context.spec.ts'],
  timeout: 30000,
  expect: {
    timeout: 6000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 },
  },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/home-toolbar',
  use: {
    baseURL: localBaseUrl(),
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
