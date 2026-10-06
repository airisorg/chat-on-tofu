import { defineConfig } from "@playwright/test";
const baseURL = process.env.APP_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error("Platform checks require a local server.");
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/platform.spec.ts",
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: "list",
  outputDir: "../../work/qa/platform-test-results",
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
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
        },
      },
    },
    { name: "WebKit", use: { browserName: "webkit" } },
  ],
});
