import { defineConfig } from '@playwright/test';
import { localBaseUrl, chromiumExecutable } from './tests/browser-config';

export default defineConfig({
  testDir: './tests', testMatch: '**/conversation-geometry.spec.ts', timeout: 30_000,
  expect: { timeout: 7_000 }, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/conversation-geometry',
  use: { baseURL: localBaseUrl(), viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
