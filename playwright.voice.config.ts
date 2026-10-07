import { localBaseUrl, chromiumExecutable } from './tests/browser-config';
import { defineConfig } from '@playwright/test';
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: './tests',
  testMatch: '**/voice-duration.spec.ts',
  timeout: 110000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/voice-duration-results',
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromiumExecutable(),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
});
