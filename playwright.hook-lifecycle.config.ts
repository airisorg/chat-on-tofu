import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';

export default defineConfig({
  ...reference,
  testMatch: '**/hook-lifecycle.spec.ts',
  outputDir: 'test-results/hook-lifecycle',
  use: { ...reference.use, serviceWorkers: 'block' },
});
