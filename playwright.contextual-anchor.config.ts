import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/contextual-anchor.spec.ts',
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/contextual-anchor',
  use: {
    baseURL: localBaseUrl(),
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
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
