import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';

export default defineConfig({
  ...reference,
  testMatch: '**/client-tail-coverage.spec.ts',
  workers: 1,
  outputDir: 'test-results/client-tail-coverage',
  use: { ...reference.use, serviceWorkers: 'block' },
});
