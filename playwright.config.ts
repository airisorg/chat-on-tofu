import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from '@playwright/test';
const baseURL = localBaseUrl();
const executablePath = chromiumExecutable();
export default defineConfig({
 testDir: './tests', testMatch: '**/ux.spec.ts', timeout: 30000, fullyParallel: false,
 expect: { timeout: 7000 }, retries: 0, reporter: 'list',
 outputDir: 'test-results/test-results',
 use: { baseURL, trace: 'retain-on-failure',
  viewport: { width: 1440, height: 960 },
  launchOptions: { executablePath, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
