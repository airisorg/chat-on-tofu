import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests', testMatch: '**/send-lifecycle.spec.ts',
  timeout: 30_000, expect: { timeout: 6_000 }, workers: 1, retries: 0,
  reporter: 'list', outputDir: 'test-results/send-lifecycle',
  use: { baseURL: localBaseUrl(), viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
