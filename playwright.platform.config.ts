import { localBaseUrl, chromiumExecutable } from './tests/browser-config';
import { defineConfig } from '@playwright/test';
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests',
  testMatch: [
    '**/platform.spec.ts',
    '**/recipients.spec.ts',
    '**/keyboard.spec.ts',
    '**/popovers.spec.ts',
  ],
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/platform-test-results',
  use: {
    baseURL,
    // Keep routed fake-auth/media fixtures isolated from SW-controlled requests.
    // Real service-worker behavior is covered by playwright.offline.config.ts.
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Chrome',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: chromiumExecutable(),
        },
      },
    },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
