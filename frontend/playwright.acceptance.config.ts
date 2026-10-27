import { defineConfig, devices } from "@playwright/test";

/**
 * Hosted, READ-ONLY E2E against the Cloudflare Acceptance preview (run by .github/workflows/hosted-acceptance-e2e.yml).
 * Separate from the local suites (`playwright.config.ts` and friends): those reset fixtures with docker psql, read OTPs
 * from Mailpit and use seeded demo identities, none of which exists on hosted Acceptance.
 *
 * - Target: ACCEPTANCE_BASE_URL, and ONLY the preview Worker below. Anything else (a Production host, a local server,
 *   aladdindecore.com) is refused before a single request is made.
 * - Credentials: ACCEPTANCE_E2E_* from the GitHub `acceptance-e2e` Environment. Nothing is read from a file.
 * - trace / video / screenshot are OFF: they would record the sign-in form values and authenticated pages.
 * - One worker: each persona signs in once and reuses its session.
 */
const ACCEPTANCE_PREVIEW = "https://aladdin-frontend-preview.bstalent9.workers.dev";
const baseURL = process.env.ACCEPTANCE_BASE_URL;
if (baseURL !== ACCEPTANCE_PREVIEW) {
  throw new Error(`ACCEPTANCE_BASE_URL must be exactly ${ACCEPTANCE_PREVIEW} (the Acceptance preview Worker).`);
}

export default defineConfig({
  testDir: "./e2e-acceptance",
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: "../.artifacts/acceptance-e2e/results.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "en-US",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
