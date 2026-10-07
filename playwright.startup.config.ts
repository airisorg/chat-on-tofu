import { defineConfig } from '@playwright/test';
import { localBaseUrl, chromiumExecutable } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/startup-recovery.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/startup-recovery',
  use: { baseURL: localBaseUrl(), serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'Chrome',
      use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } },
    },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
