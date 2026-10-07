import { defineConfig } from '@playwright/test';
import { chromiumExecutable, localBaseUrl } from './tests/browser-config';
// Actual behavior/geometry assertions execute unchanged. Pixel comparisons are
// separate reviewed macOS gates; the orchestrator explicitly passes
// --ignore-snapshots for this portable executable-coverage job.
export default defineConfig({
  testDir: './tests',
  testMatch: /\.spec\.[cm]?[jt]sx?$/,
  testIgnore: [
    '**/security-browser.spec.ts',
    '**/offline-shell.spec.ts',
    '**/visual-regression.spec.ts',
    '**/dialog-visual.spec.ts',
  ],
  timeout: 180_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/combined-coverage/browser-results.json' }],
  ],
  grepInvert: /image CSP permits Google avatar hosts/,
  outputDir: 'test-results/combined-coverage/browser-artifacts',
  use: {
    baseURL: localBaseUrl(),
    locale: 'en-US',
    timezoneId: 'UTC',
    // Synthetic auth fixtures deliberately use several .invalid origins. Real
    // production CSP acceptance is the separate no-bypass security suite.
    bypassCSP: true,
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromiumExecutable(),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [{ name: 'Chrome', use: { browserName: 'chromium' } }],
});
