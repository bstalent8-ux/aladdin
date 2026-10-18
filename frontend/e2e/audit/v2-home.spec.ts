import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, DESK_AR_D, MOB_AR_D, MOB_EN_L } from "./audit-util";

/** Showroom V2 release evidence: Home in the four standard combinations. One persona (hana) with real buyer + seller data. */
const SUITE = "/showroom";
const P = "Showroom/Dealer (hana, buyer + seller data)";

test("V2-1 Home renders every reference section from real data", async ({ page, request }) => {
  test.setTimeout(600_000);
  psql(`delete from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = (select id from public.organizations where name = 'Cairo Ceramics Showroom')`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showroom-kpis").locator("article")).toHaveCount(5);
  await expect(page.getByTestId("showroom-discover-card")).toHaveCount(6);
  await expect(page.getByTestId("showroom-quotes")).toBeVisible();
  await expect(page.getByTestId("showroom-category-chart")).toBeVisible();
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "h01-home", persona: P, state: "V2 Home, real data", data: "real" }, [{ ...DESK_EN_L, fullPage: true }, { ...DESK_AR_D, fullPage: true }, { ...MOB_AR_D, fullPage: true }, { ...MOB_EN_L, fullPage: true }]);
  expect(errors).toEqual([]);
});
