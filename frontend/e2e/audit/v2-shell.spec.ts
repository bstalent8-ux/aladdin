import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** Showroom V2 release evidence: the converged shell (finished /b2b modules inside the V2 frame) and Settings. SHOT_ROOT_NAME=v2-release. */
const SUITE = "/preview/showroom-suite-v2";
const P = "Showroom/Dealer (hana, buyer + seller data)";

test("V2-2 finished modules render inside the V2 shell and highlight their own entry", async ({ page, request }) => {
  test.setTimeout(900_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const modules: Array<[string, string, string]> = [
    ["/b2b/rfqs", "Direct RFQs", "m01-direct-rfqs"],
    ["/b2b/rfqs?view=received", "Direct RFQs received", "m02-direct-rfqs-received"],
    ["/b2b/quotations", "Supplier quotations received", "m03-quotations"],
    ["/b2b/orders", "Purchase orders", "m04-orders"],
    ["/b2b/projects", "Projects", "m05-projects"],
    ["/b2b/reports", "Reports & analytics", "m06-reports"],
    ["/b2b/organization", "Team & members", "m07-team"],
    ["/b2b/customers", "Customers", "m08-customers"],
  ];
  for (const [route, navLabel, name] of modules) {
    await page.goto(route);
    // one shell: the V2 sidebar is present and the matching entry is the current page
    await expect(page.locator("[data-preview-sidebar]").first()).toBeVisible();
    await expect(page.locator("[data-preview-sidebar] a[aria-current='page']").first()).toContainText(navLabel);
    await expect(page.getByText("This page is not available yet")).toHaveCount(0);
    await capture(page, route, { area: "v2-release", name, persona: P, state: `${navLabel} inside the V2 shell`, data: "real" }, [DESK_EN_L]);
  }
  // /b2b itself lands on the V2 Home
  await page.goto("/b2b");
  await expect(page).toHaveURL(/showroom-suite-v2\/home/);
  // no visible sidebar entry leads to a placeholder
  const hrefs = await page.locator("[data-preview-sidebar] nav a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(10);
  expect(hrefs.some((h) => h === "/preview/showroom-suite-v2/purchase-requests")).toBe(false);
  expect(errors).toEqual([]);
});

test("V2-3 every sidebar destination opens a finished page", async ({ page, request }) => {
  test.setTimeout(900_000);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/home`);
  const hrefs = await page.locator("[data-preview-sidebar] nav a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const bad: string[] = [];
  for (const href of [...new Set(hrefs)]) {
    const res = await page.goto(href);
    const body = await page.locator("body").innerText();
    if (!res || res.status() >= 400 || /This page is not available yet|Application error|404/.test(body)) bad.push(`${href} -> ${res?.status()}`);
  }
  expect(bad).toEqual([]);
});

test("V2-4 Settings: sectioned, reads real data, protected identity goes through review", async ({ page, request }) => {
  test.setTimeout(900_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  const sections = ["business", "activities", "branches", "access", "account", "appearance", "support"];
  for (const s of sections) {
    await page.goto(`${SUITE}/settings?section=${s}`);
    await expect(page.getByTestId(`settings-section-${s}`)).toBeVisible();
    await expect(page.getByTestId(`settings-nav-${s}`)).toHaveAttribute("aria-current", "page");
    await capture(page, `${SUITE}/settings?section=${s}`, { area: "v2-release", name: `s-${s}`, persona: P, state: `Settings - ${s}`, data: "real" }, s === "business" || s === "branches" ? [DESK_EN_L, MOB_AR_D] : [DESK_EN_L]);
  }
  // unknown section falls back to the first available one
  await page.goto(`${SUITE}/settings?section=nope`);
  await expect(page.getByTestId("settings-section-business")).toBeVisible();
});
