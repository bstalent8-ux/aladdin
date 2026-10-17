import { defineConfig, devices } from "@playwright/test";

/**
 * Frontend reality audit (M4 checkpoint). Evidence-capture only: real browser, real dev server (3026),
 * isolated database, ONE worker, no retries. Run one spec file at a time:
 *   E2E_PORT=3026 pnpm exec playwright test -c playwright.audit.config.ts e2e/audit/m2.spec.ts
 */
const PORT = Number(process.env.E2E_PORT ?? 3026);

export default defineConfig({
  testDir: "./e2e/audit",
  globalSetup: "./e2e/regression/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
});
