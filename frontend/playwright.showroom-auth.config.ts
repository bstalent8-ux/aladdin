import { defineConfig, devices } from "@playwright/test";
// Dedicated local Supabase only. No shared sales global setup or fixture reset.
export default defineConfig({
    testDir: "./e2e", testMatch: "showroom-auth.spec.ts", workers: 1, fullyParallel: false, retries: 0,
    timeout: 60000, expect: { timeout: 15000 }, reporter: "list",
    outputDir: "../.artifacts/showroom/browser-results",
    // Traces contain session tokens; retain screenshots/logs, never raw auth traces.
    use: { baseURL: "http://127.0.0.1:3342", screenshot: "only-on-failure", trace: "off" },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
        { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    ],
    webServer: { command: "pnpm exec next start --hostname 127.0.0.1 --port 3342", url: "http://127.0.0.1:3342/showroom/sign-in", reuseExistingServer: false, timeout: 120000 },
});
