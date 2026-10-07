import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';
export default defineConfig({
  ...reference,
  testMatch: '**/search.spec.ts',
  outputDir: 'test-results/search-filter-results',
});
