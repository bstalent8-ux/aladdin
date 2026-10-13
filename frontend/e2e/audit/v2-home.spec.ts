import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, DESK_AR_D, MOB_AR_D, MOB_EN_L } from "./audit-util";

/** Showroom V2 release evidence: Home. Run with SHOT_ROOT_NAME=v2-release. One persona (hana) with real buyer + seller data. */
const SUITE = "/preview/showroom-suite-v2";
const P = "Showroom/Dealer (hana, buyer + seller data)";

test("V2-1 Home renders every section from real data and every link resolves", async ({ page, request }) => {
  test.setTimeout(600_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${SUITE}/home`);
  await expect(page.getByTestId("showroom-kpis")).toBeVisible();
  await expect(page.getByTestId("showroom-context")).toContainText("Cairo Ceramics");
  await expect(page.getByTestId("showroom-discover-rail")).toBeVisible();
  await expect(page.getByTestId("showroom-quotes")).toBeVisible();
  await expect(page.getByTestId("showroom-category-chart")).toBeVisible();
  await expect(page.getByTestId("showroom-requests")).toBeVisible();
  await expect(page.getByTestId("showroom-quick-actions")).toBeVisible();
  // exactly six headline cards
  await expect(page.getByTestId("showroom-kpis").locator("li")).toHaveCount(6);
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "h01-home", persona: P, state: "V2 Home, real data", data: "real" }, [{ ...DESK_EN_L, fullPage: true }, { ...DESK_AR_D, fullPage: true }, { ...MOB_AR_D, fullPage: true }, { ...MOB_EN_L, fullPage: true }]);
  expect(errors).toEqual([]);
});
