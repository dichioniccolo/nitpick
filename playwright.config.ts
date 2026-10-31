import { defineConfig, devices } from "@playwright/test";

/**
 * The instant-navigation guard. It measures a production build made with the
 * testing API exposed (`bun run e2e:build`), never `next dev`. See instant-nav.rig.md.
 */
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./scripts/e2e/setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "bun run --cwd apps/web next start -H 127.0.0.1 -p 3000",
        env: { EXPOSE_TESTING_API: "1" },
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
