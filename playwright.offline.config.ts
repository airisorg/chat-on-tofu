import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from '@playwright/test';
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests', testMatch: '**/offline-shell.spec.ts', timeout: 30000, workers: 2, retries: 0, reporter: 'list',
  outputDir: 'test-results/offline-shell-results',
  use: { baseURL, viewport: { width: 390, height: 844 }, browserName: 'chromium', launchOptions: { executablePath: chromiumExecutable() }, trace: 'retain-on-failure' },
});
