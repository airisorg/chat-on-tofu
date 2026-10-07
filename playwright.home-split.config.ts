import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/home-split.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 40000,
  expect: { timeout: 5000 },
  reporter: 'list',
  outputDir: 'test-results/home-split',
  use: {
    baseURL: localBaseUrl(),
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
