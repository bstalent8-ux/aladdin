import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** Showroom V2 release evidence: staff scope, cross-tenant denial and pending-organization exclusion. SHOT_ROOT_NAME=v2-release. */
const SUITE = "/showroom";
const q = (s: string) => psql(s).trim();

test("V2-5 staff member (sales.read/write only): scoped Home, scoped sidebar, read-only Settings", async ({ page, request }) => {
  test.setTimeout(600_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.salesperson, /\/(home|b2b)(\/|$)/);
  // Youssef also has a personal workspace; switch to the Showroom the way the workspace switcher does (cookie, server-validated)
  const orgId = q(`select id from public.organizations where name = 'Cairo Ceramics Showroom'`);
  await page.context().addCookies([{ name: "aladdin-org", value: orgId, url: "http://127.0.0.1:3026" }]);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  // purchasing and catalog sections are absent, never an empty "0"
  for (const id of ["showroom-quotes", "showroom-category-chart", "showroom-requests", "showroom-discover-rail"]) await expect(page.getByTestId(id)).toHaveCount(0);
  const nav = page.locator("[data-preview-sidebar] nav");
  await expect(nav.getByRole("link", { name: "Direct RFQs", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Purchase orders" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "a01-staff-home", persona: "Staff member (sales.read, sales.write)", state: "Home scoped to the staff member's permissions", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  // Settings: read-only
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("identity-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByTestId("settings-nav-activities")).toHaveCount(0);
  await page.goto(`${SUITE}/settings?section=activities`);
  await expect(page.getByTestId("settings-section-business")).toBeVisible();
  await page.goto(`${SUITE}/settings?section=branches`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Add branch" })).toHaveCount(0);
  await capture(page, `${SUITE}/settings?section=business`, { area: "v2-release", name: "a02-staff-settings", persona: "Staff member (sales.read, sales.write)", state: "Settings are read-only for a staff member", data: "real" }, [DESK_EN_L]);
  // Team page requires org.members.manage
  await page.goto("/b2b/organization");
  await expect(page.getByText(/not allowed to manage members/i).first()).toBeVisible();
  // cross-tenant: an RFQ between two OTHER organizations is not found
  const foreign = q(`select r.id from public.rfqs r join public.organizations a on a.id = r.requester_org_id join public.organizations b on b.id = r.supplier_org_id
    where a.name not like 'Cairo Ceramics%' and b.name not like 'Cairo Ceramics%' order by r.created_at limit 1`);
  if (foreign) {
    const res = await page.goto(`/b2b/rfqs/${foreign}`);
    expect(res?.status()).toBe(404);
  }
});

test("V2-6 owner of a PENDING organization never reaches the Showroom workspace", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, "tarek@example.test", /\/(home|b2b|onboarding)(\/|$)/);
  for (const route of [`${SUITE}/home`, `${SUITE}/settings`, "/b2b/rfqs", "/b2b/orders"]) {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-preview-sidebar]")).toHaveCount(0);
    await expect(page.getByTestId("showroom-kpis")).toHaveCount(0);
  }
});

test("V2-7 an approved Showroom with no data: truthful empty states, two branches in Settings", async ({ page, request }) => {
  test.setTimeout(600_000);
  const owner = q(`select u.email from public.organizations o join public.memberships m on m.organization_id = o.id join auth.users u on u.id = m.user_id
    join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
    where o.org_type = 'showroom_dealer' and o.status = 'active' and o.name like 'Gov Office%' and u.email like 'reg-gov-owner-%'
      and (select count(*) from public.branches b where b.organization_id = o.id) >= 2 order by o.created_at desc limit 1`);
  expect(owner).toContain("@example.test");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, owner, /\/(home|b2b)(\/|$)/);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showroom-kpis").locator("article")).toHaveCount(5);
  await expect(page.getByTestId("showroom-quotes-empty")).toBeVisible();
  await expect(page.getByTestId("showroom-category-empty")).toContainText("No confirmed purchases");
  // zero is shown as zero, never as a fabricated figure
  await expect(page.getByTestId("kpi-rfqs_sent").getByTestId("kpi-value")).toHaveText("0");
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "e01-home-empty", persona: "Approved Showroom, no transactions, two branches", state: "Home with no data: truthful empty states", data: "real" }, [{ ...DESK_EN_L, fullPage: true }, { ...MOB_AR_D, fullPage: true }]);
  await page.goto(`${SUITE}/settings?section=branches`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("branch-governance")).toBeVisible();
  await capture(page, `${SUITE}/settings?section=branches`, { area: "v2-release", name: "e02-settings-branches", persona: "Approved Showroom, two branches", state: "Branches section (internal vs verified)", data: "real" }, [DESK_EN_L, MOB_AR_D]);
});

test("V2-8 transaction-linked chat opens from a Direct RFQ inside the V2 shell", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  // The seeded owner predates the capability preset that every NEW organization owner receives (conversation.participate);
  // grant it explicitly in the isolated test database so the test states its own precondition.
  psql(`insert into public.membership_capabilities (membership_id, capability_key)
    select m.id, 'conversation.participate' from public.memberships m join auth.users u on u.id = m.user_id join public.organizations o on o.id = m.organization_id
    where u.email = 'hana@example.test' and o.name = 'Cairo Ceramics Showroom' on conflict do nothing`);
  await signIn(page, request, IDENTITIES.showroom);
  const rfq = q(`select r.id from public.rfqs r join public.organizations o on o.id = r.requester_org_id where o.name = 'Cairo Ceramics Showroom' and r.status <> 'draft' order by r.created_at limit 1`);
  await page.goto(`/b2b/rfqs/${rfq}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("chat-open-rfq").click();
  // the header Chat panel (mounted by the V2 frame) shows the conversation thread
  await expect(page.getByTestId("header-chat-panel")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "../docs/frontend/screenshots/v2-release/v2-release/c01-chat-open.en.light.1440x900.png" });
});
