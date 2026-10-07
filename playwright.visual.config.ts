import { localBaseUrl, chromiumExecutable } from './tests/browser-config';
import { defineConfig } from '@playwright/test';

const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests',
  testMatch: '**/visual-regression.spec.ts',
  timeout: 30000,
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/visual-regression-results',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 } },
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
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
