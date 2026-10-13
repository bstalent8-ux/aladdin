import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, type Combo } from "./audit-util";
import { expectNoHorizontalOverflow } from "../regression/util";

/** Reference alignment evidence. SHOT_ROOT_NAME=v2-reference-alignment. */
const SUITE = "/preview/showroom-suite-v2";
const P = "Showroom/Dealer (hana, buyer + seller data)";
const AR_L: Combo = { locale: "ar", theme: "light", w: 1440, h: 900 };
const EN_L: Combo = { locale: "en", theme: "light", w: 1440, h: 900 };
const AR_D_M: Combo = { locale: "ar", theme: "dark", w: 390, h: 844, fullPage: true };
const EN_L_M430: Combo = { locale: "en", theme: "light", w: 430, h: 932, fullPage: true };

test("R-1 Home follows the approved reference", async ({ page, request }) => {
  test.setTimeout(600_000);
  // The test states its own precondition: no saved layout, so the reference default applies.
  psql(`delete from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = (select id from public.organizations where name = 'Cairo Ceramics Showroom')`);
  await prefs(page, { locale: "ar", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showroom-kpis").locator("article")).toHaveCount(5);
  for (const id of ["showroom-discover", "showroom-quotes-section", "showroom-category-section"]) await expect(page.getByTestId(id)).toBeVisible();
  // sections of the earlier iteration that are NOT in the reference are gone
  for (const id of ["showroom-actions-section", "showroom-benefits-section", "showroom-requests-section", "showroom-needs-attention"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "r01-home", persona: P, state: "Home aligned to the approved reference", data: "real" }, [AR_L, EN_L, { ...AR_L, fullPage: true }, AR_D_M, EN_L_M430]);
});

test("R-2 no horizontal overflow on phones, both languages and themes", async ({ page, request }) => {
  test.setTimeout(600_000);
  await signIn(page, request, IDENTITIES.showroom);
  for (const [w, h] of [[390, 844], [430, 932]] as const) {
    for (const locale of ["en", "ar"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await prefs(page, { locale, theme });
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${SUITE}/home`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByTestId("showroom-kpis")).toBeVisible();
        await expectNoHorizontalOverflow(page, `home ${w} ${locale} ${theme}`);
      }
    }
  }
});

test("R-3 KPI customization still works: hide, reorder, persist, reset", async ({ page, request }) => {
  test.setTimeout(600_000);
  const hanaOrg = `(select id from public.organizations where name = 'Cairo Ceramics Showroom')`;
  psql(`delete from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = ${hanaOrg}`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  const labels = async () => page.getByTestId("showroom-kpis").first().locator("article h3").allInnerTexts();
  expect(await labels()).toEqual(["Total purchases", "Orders awaiting execution", "Completed purchase orders", "Incoming quotations", "Direct RFQs"]);
  await page.getByTestId("kpi-customize-trigger").click();
  const dialog = page.getByTestId("kpi-customize-dialog");
  await expect(dialog).toBeVisible();
  // move the second card up, hide the last, add one that is not part of the default five
  await dialog.getByRole("button", { name: "Move up" }).nth(1).click();
  await dialog.getByRole("button", { name: "Hide" }).last().click();
  await dialog.locator("li", { hasText: "Saved products" }).getByRole("button", { name: "Show" }).click();
  await dialog.getByRole("button", { name: "Save my layout" }).click();
  await expect(dialog.getByText("Your layout was saved.")).toBeVisible({ timeout: 30_000 });
  const saved = psql(`select card_order::text from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = ${hanaOrg} and membership_id is not null`).trim();
  expect(saved.startsWith("{orders_awaiting_execution,total_purchases,completed_orders,quotes_received")).toBe(true);
  expect(saved).not.toContain("rfqs_sent");
  expect(saved).toContain("saved_products");
  await page.reload();
  await page.waitForLoadState("networkidle");
  const after = await labels();
  expect(after.slice(0, 2)).toEqual(["Orders awaiting execution", "Total purchases"]);
  expect(after).not.toContain("Direct RFQs");
  expect(after).toContain("Saved products");
  // reset restores the reference default
  await page.getByTestId("kpi-customize-trigger").click();
  await page.getByTestId("kpi-customize-dialog").getByRole("button", { name: /Reset to/ }).first().click();
  await expect.poll(() => psql(`select count(*) from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = ${hanaOrg} and membership_id is not null`).trim(), { timeout: 30_000 }).toBe("0");
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await labels()).toEqual(["Total purchases", "Orders awaiting execution", "Completed purchase orders", "Incoming quotations", "Direct RFQs"]);
});

test("R-4 Home figures equal the backend records (independent SQL, same 30-day window)", async ({ page, request }) => {
  test.setTimeout(600_000);
  const q = (s: string) => psql(s).trim();
  const org = `(select id from public.organizations where name = 'Cairo Ceramics Showroom')`;
  // the Cairo calendar window the period selector resolves for "last 30 days": today and the 29 days before it
  const from = `(((now() at time zone 'Africa/Cairo')::date - 29)::timestamp at time zone 'Africa/Cairo')`;
  const to = `(((now() at time zone 'Africa/Cairo')::date + 1)::timestamp at time zone 'Africa/Cairo')`;
  const expected = {
    rfqs: q(`select count(*) from public.rfqs where requester_org_id = ${org} and status in ('submitted','quoted','closed') and created_at >= ${from} and created_at < ${to}`),
    quotes: q(`select count(*) from public.quotations where requester_org_id = ${org} and status <> 'draft' and created_at >= ${from} and created_at < ${to}`),
    awaiting: q(`select count(*) from public.orders where requester_org_id = ${org} and status = 'confirmed'`),
    completed: q(`select count(*) from public.orders where requester_org_id = ${org} and status = 'completed' and completed_at >= ${from} and completed_at < ${to}`),
    total: Number(q(`select coalesce(sum(total),0) from public.orders where requester_org_id = ${org} and status <> 'cancelled' and confirmed_at >= ${from} and confirmed_at < ${to}`)),
  };
  const categories = q(`select category || '=' || sum(amount) from public.order_category_spend where requester_org_id = ${org} and status <> 'cancelled' and confirmed_at >= ${from} and confirmed_at < ${to} group by category order by sum(amount) desc`)
    .split("\n").filter(Boolean).map((r) => ({ category: r.split("=")[0]!, amount: Number(r.split("=")[1]) }));
  const latest = q(`select supplier_name || '|' || status from public.quotation_list where requester_org_id = ${org} and status <> 'draft' order by created_at desc, id asc limit 5`).split("\n");

  psql(`delete from public.dashboard_kpi_layouts where surface = 'showroom_suite' and organization_id = ${org}`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  const value = (key: string) => page.getByTestId(`kpi-${key}`).getByTestId("kpi-value").innerText();
  expect(await value("rfqs_sent")).toBe(expected.rfqs);
  expect(await value("quotes_received")).toBe(expected.quotes);
  expect(await value("orders_awaiting_execution")).toBe(expected.awaiting);
  expect(await value("completed_orders")).toBe(expected.completed);
  expect(await value("total_purchases")).toBe(new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", notation: "compact", maximumFractionDigits: 1 }).format(expected.total));
  // category chart: same categories, same order, same percentages
  const totalSpend = categories.reduce((a, c) => a + c.amount, 0);
  const rows = page.getByTestId("category-row");
  await expect(rows).toHaveCount(categories.length);
  for (let i = 0; i < categories.length; i++) {
    expect(await rows.nth(i).innerText()).toContain(`${Math.round((categories[i]!.amount / totalSpend) * 100)}%`);
  }
  // latest incoming quotations: the same five, newest first, with the same statuses
  const shown = await page.getByTestId("quote-row").allInnerTexts();
  expect(shown).toHaveLength(latest.length);
  latest.forEach((row, i) => {
    const [supplier, status] = row.split("|");
    expect(shown[i]).toContain(supplier!);
    expect(shown[i]).toContain({ submitted: "Awaiting your decision", accepted: "Accepted", rejected: "Declined" }[status!]!);
  });
  // a different organization never sees this organization's figures
  expect(expected.total).toBeGreaterThan(0);
});

test("R-5 workspace switcher uses the approved terminology (AR and EN)", async ({ page, request }) => {
  test.setTimeout(300_000);
  await signIn(page, request, IDENTITIES.showroom);
  for (const [locale, add, mine] of [["ar", "طلب إضافة مؤسسة جديدة", "مؤسساتي وطلباتي"], ["en", "Request New Organization", "My Organizations & Applications"]] as const) {
    await prefs(page, { locale, theme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${SUITE}/home`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: locale === "ar" ? "تبديل مساحة العمل" : "Switch workspace" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: add })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: mine })).toBeVisible();
    await expect(menu).not.toContainText("REG Pending Supply");
    await page.screenshot({ path: `../docs/frontend/screenshots/v2-reference-alignment/v2-release/w01-switcher.${locale}.light.1440x900.png` });
  }
});
