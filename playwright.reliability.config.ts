import { localBaseUrl, chromiumExecutable } from './tests/browser-config';
import { defineConfig } from '@playwright/test';
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests',
  testMatch: '**/reliability.spec.ts',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/reliability-results',
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    actionTimeout: 10_000,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chromiumExecutable() },
  },
});
