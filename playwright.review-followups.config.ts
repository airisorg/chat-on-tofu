import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests', testMatch: '**/review-followups.spec.ts', timeout: 30000,
  expect: { timeout: 8000 }, workers: 2, retries: 0, reporter: 'list',
  outputDir: 'test-results/review-followups',
  use: { baseURL: localBaseUrl(), viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
