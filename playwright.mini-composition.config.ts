import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/mini-composition.spec.ts',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/mini-composition',
  use: {
    baseURL: localBaseUrl(),
    viewport: { width: 1440, height: 960 },
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
