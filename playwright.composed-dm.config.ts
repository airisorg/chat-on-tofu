import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests', testMatch: '**/composed-dm.spec.ts',
  timeout: 40_000, expect: { timeout: 7_000 }, workers: 1, retries: 0,
  reporter: 'list', outputDir: 'test-results/composed-dm',
  use: { baseURL: localBaseUrl(), serviceWorkers: 'block', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
