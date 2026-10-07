import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';

export default defineConfig({
  testDir: './tests', testMatch: '**/dialog-visual.spec.ts', timeout: 30000,
  workers: 2, retries: 0, reporter: 'list', outputDir: 'test-results/dialog-visual',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 } },
  use: { baseURL: localBaseUrl(), serviceWorkers: 'block', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() } } },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
