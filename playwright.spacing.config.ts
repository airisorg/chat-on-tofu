import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from "@playwright/test";
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: "./tests", testMatch: "**/spacing.spec.ts", timeout: 30000,
  workers: 2, retries: 0, reporter: "list", outputDir: "test-results/spacing-results",
  use: { baseURL, viewport: { width: 1440, height: 960 }, trace: "retain-on-failure" },
  projects: [
    { name: "Chrome", use: { browserName: "chromium", launchOptions: { executablePath: chromiumExecutable() } } },
    { name: "WebKit", use: { browserName: "webkit" } },
  ],
});
