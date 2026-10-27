import { test, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * TEMPORARY probe for the Showroom RC2 E2E review (PR #110): prints what the RC2 surfaces actually render (ARIA
 * snapshots) so the outdated assertions are rewritten from evidence. Removed before the PR leaves draft.
 */
async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: "light", url: "http://127.0.0.1" },
  ]);
}

async function dump(page: Page, label: string, selector = "body", max = 6000) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const loc = page.locator(selector).filter({ visible: true }).first();
  const snap = await loc.ariaSnapshot({ timeout: 10000 }).catch((e) => `<<${String(e).slice(0, 200)}>>`);
  console.log(`\n===== PROBE ${label} @ ${page.url()} =====\n${snap.slice(0, max)}\n===== END ${label} =====`);
}

test.describe.configure({ mode: "serial" });

test("probe: showroom owner (hana)", async ({ page, request }) => {
  test.setTimeout(240_000);
  await prefs(page, "en");
  await signIn(page, request, IDENTITIES.showroom, /./);
  await page.goto("/showroom/home");
  await dump(page, "hana-home-header", "header");
  await dump(page, "hana-home-sidebar", "aside, nav");
  await dump(page, "hana-home-main", "main", 5000);
  await page.getByRole("button", { name: "Switch workspace" }).first().click().catch(() => {});
  await dump(page, "hana-workspace-menu", '[role="menu"]');
  await page.keyboard.press("Escape");
  await page.getByTestId("profile-menu-trigger").click().catch(() => {});
  await dump(page, "hana-profile-menu", '[role="menu"]');
  await page.keyboard.press("Escape");
  for (const route of ["/showroom/settings", "/b2b/rfqs", "/b2b/orders", "/b2b/projects", "/b2b/settings"]) {
    await page.goto(route);
    await dump(page, `hana-${route}`, "main", 4000);
  }
});

test("probe: showroom owner Arabic (hana)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await prefs(page, "ar");
  await signIn(page, request, IDENTITIES.showroom, /./);
  await page.goto("/b2b");
  await dump(page, "hana-ar-sidebar", "aside, nav", 4000);
  await dump(page, "hana-ar-header", "header", 3000);
});

test("probe: supplier owner (a-owner)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await prefs(page, "en");
  await signIn(page, request, IDENTITIES.manager, /./);
  await page.goto("/b2b/leads");
  await dump(page, "aowner-leads-header", "header", 4000);
  await dump(page, "aowner-leads-nav", "nav", 4000);
  await dump(page, "aowner-leads-main", "main", 3000);
});

test("probe: branch-limited salesperson (a-cairo)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await prefs(page, "en");
  await signIn(page, request, IDENTITIES.branchLimited, /./);
  await page.waitForTimeout(3000);
  await dump(page, "acairo-landing-header", "header", 3000);
  await page.goto("/b2b/leads");
  await dump(page, "acairo-leads-main", "main", 3000);
});

test("probe: engineer with personal home (yasser)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await prefs(page, "en");
  await signIn(page, request, "yasser@example.test", /./);
  await page.waitForTimeout(3000);
  await dump(page, "yasser-landing-header", "header", 4000);
  await page.goto("/business/new");
  await dump(page, "yasser-business-new", "main", 4000);
});

test("probe: consumer (omar)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await prefs(page, "en");
  await signIn(page, request, IDENTITIES.consumer, /./);
  await page.waitForTimeout(3000);
  await dump(page, "consumer-landing-header", "header", 3000);
});
