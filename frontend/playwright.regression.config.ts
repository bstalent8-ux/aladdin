import { defineConfig, devices } from "@playwright/test";

/**
 * Small-batch browser regression for the Phase 6+7 closeout.
 *
 * Deliberately NOT the full-suite config: no production build, no webServer, ONE worker, no
 * retries, minimal artifacts. It reuses an already-running local dev server (E2E_PORT, default
 * 3026) and the isolated local database (E2E_DB_CONTAINER, default supabase_db_aladdin_sr2), and is
 * run one batch (one spec file) at a time so a low-memory machine is never asked for ~600 loads.
 *
 *   E2E_PORT=3026 pnpm exec playwright test -c playwright.regression.config.ts e2e/regression/a-showroom.spec.ts
 */
const PORT = Number(process.env.E2E_PORT ?? 3026);

export default defineConfig({
  testDir: "./e2e/regression",
  globalSetup: "./e2e/regression/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    // A cold `next dev` compile after a server restart can take well over 30s on a busy machine.
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
  },
});
