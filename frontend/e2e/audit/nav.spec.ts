import { test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser } from "../regression/setup";
import { prefs } from "../regression/util";
import { SHOT_ROOT } from "./audit-util";

/** Real navigation evidence: every <a href> rendered in the shell (groups expanded) per persona. */
const run = Date.now().toString(36);
const PRO = `aud-nav-pro-${run}@example.test`;
const out: Record<string, string[]> = {};

async function hrefs(page: import("@playwright/test").Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  for (let pass = 0; pass < 3; pass++) {
    const toggles = page.locator("nav button[aria-expanded='false']");
    const n = await toggles.count();
    for (let i = 0; i < n; i++) await toggles.nth(0).click({ timeout: 2000 }).catch(() => undefined);
  }
  await page.waitForTimeout(400);
  return Array.from(new Set(await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")))).filter((h) => h.startsWith("/")).sort();
}

async function persona(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, key: string, email: string, routes: string[]) {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, email, /\/(home|b2b|admin|onboarding)(\/|$)/);
  const all = new Set<string>();
  for (const r of routes) for (const h of await hrefs(page, r)) all.add(h);
  out[key] = Array.from(all).sort();
}

test.afterAll(() => {
  mkdirSync(SHOT_ROOT, { recursive: true });
  writeFileSync(path.join(SHOT_ROOT, "navigation-links.json"), JSON.stringify(out, null, 1));
});

test("nav contractor (independent, no org)", async ({ page, request }) => {
  createSyntheticUser(PRO, "contractor");
  await persona(page, request, "independent-contractor", PRO, ["/home", "/home/settings", "/home/profile"]);
});
test("nav showroom owner", async ({ page, request }) => {
  await persona(page, request, "showroom-owner-hana", IDENTITIES.showroom, ["/b2b", "/b2b/settings", "/preview/showroom-suite-v2/home"]);
});
test("nav supplier owner", async ({ page, request }) => {
  await persona(page, request, "supplier-owner-rania", IDENTITIES.distributor, ["/b2b"]);
});
test("nav engineer office owner", async ({ page, request }) => {
  await persona(page, request, "engineering-office-owner", "b-owner@example.test", ["/b2b"]);
});
test("nav consumer", async ({ page, request }) => {
  await persona(page, request, "consumer", IDENTITIES.consumer, ["/home"]);
});
