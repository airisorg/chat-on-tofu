import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';

export default defineConfig({
  ...reference,
  testMatch: '**/component-coverage.spec.ts',
  outputDir: 'test-results/component-coverage',
  use: { ...reference.use, serviceWorkers: 'block' },
});
