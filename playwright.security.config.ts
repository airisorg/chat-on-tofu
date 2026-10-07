import { defineConfig } from '@playwright/test';
import { localBaseUrl, chromiumExecutable } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/security-browser.spec.ts',
  timeout: 30000,
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/security-results',
  // Response injection must reach the route fixture; SW behavior has its own suite.
  use: {
    baseURL: localBaseUrl(),
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'Chrome',
      use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } },
    },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
