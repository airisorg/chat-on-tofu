import { defineConfig } from '@playwright/test';

const baseURL = process.env.APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
  throw new Error('Keyboard checks require a local server.');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/keyboard.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../work/qa/keyboard-test-results',
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Chrome',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
            (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
        },
      },
    },
    { name: 'WebKit', use: { browserName: 'webkit' } },
  ],
});
