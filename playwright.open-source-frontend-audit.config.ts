import { defineConfig } from '@playwright/test';
import { localBaseUrl, chromiumExecutable } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/open-source-frontend-audit.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  outputDir: 'test-results/open-source-frontend-audit',
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
