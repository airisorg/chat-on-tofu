import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests', testMatch: '**/ux.spec.ts', timeout: 30000, fullyParallel: false,
 expect: { timeout: 7000 }, retries: 0, reporter: 'list',
 outputDir: '../../work/qa/test-results',
 use: { baseURL: process.env.APP_URL || 'http://127.0.0.1:3000', trace: 'retain-on-failure',
  viewport: { width: 1440, height: 960 },
  launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
