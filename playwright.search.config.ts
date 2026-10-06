import { defineConfig } from "@playwright/test";
import reference from "./playwright.reference.config";
export default defineConfig({
  ...reference,
  testMatch: "**/search.spec.ts",
  outputDir: "../../work/qa/search-filter-results",
});
