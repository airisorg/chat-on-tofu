import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from "@playwright/test";
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/network-ux.spec.ts",
  timeout: 35000,
  expect: { timeout: 7000 },
  workers: 2,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/network-ux-results",
  use: { baseURL, viewport: { width: 1440, height: 960 }, serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [
    { name: "Chrome", use: { browserName: "chromium", launchOptions: { executablePath: chromiumExecutable() } } },
    { name: "WebKit", use: { browserName: "webkit" } },
  ],
});
