import { localBaseUrl, chromiumExecutable } from "./tests/browser-config";
import { defineConfig } from "@playwright/test";
const baseURL = localBaseUrl();
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/presence-support.spec.ts", "**/fonts.spec.ts"],
  timeout: 30000,
  expect: { timeout: 7000 },
  workers: 2,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/presence-support-results",
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "Chrome",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath:
            chromiumExecutable(),
        },
      },
    },
    { name: "WebKit", use: { browserName: "webkit" } },
  ],
});
