import { defineConfig } from '@playwright/test';
const baseURL = process.env.APP_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('UX checks require a local server.');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
export default defineConfig({
 testDir: './tests', testMatch: '**/ux.spec.ts', timeout: 30000, fullyParallel: false,
 expect: { timeout: 7000 }, retries: 0, reporter: 'list',
 outputDir: '../../work/qa/test-results',
 use: { baseURL, trace: 'retain-on-failure',
  viewport: { width: 1440, height: 960 },
  launchOptions: { executablePath, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
