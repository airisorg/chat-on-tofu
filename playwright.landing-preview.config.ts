import { defineConfig } from '@playwright/test';
import reference from './playwright.reference.config';

export default defineConfig({
  ...reference,
  testMatch: '**/landing-preview.spec.ts',
  outputDir: 'test-results/landing-preview',
});
