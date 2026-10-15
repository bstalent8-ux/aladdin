import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** What an Admin reviewer actually sees today for the new M3/M4a review types (NO Admin changes made). */
const AREA = "m3-organization-branch-governance" as const;
const run = Date.now().toString(36);
const PRO = `aud-adm-pro-${run}@example.test`;
const q = (s: string) => psql(s).trim();

test("ADM-1 admin verification queue with pending independent_publisher / organization_identity / branch_location / co_owner", async ({ page, request }) => {
  test.setTimeout(400_000);
  createSyntheticUser(PRO, "engineer");
  const pro = await signedInClient(PRO);
  const r = await pro.rpc("independent_publisher_request", { p_note: "Licensed engineer, 8 years." });
  expect(r.error, r.error?.message).toBeNull();
  const types = q(`select string_agg(distinct verification_type::text, ',') from public.verifications where status in ('submitted','under_review')`);
  console.log("PENDING_TYPES", types);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.admin, /\/(home|b2b|admin|onboarding)(\/|$)/);
  await capture(page, "/admin/verifications", { area: AREA, name: "30-admin-verification-queue", persona: "Platform Admin", state: "Admin queue with pending M3/M4a review types (raw type labels?)", data: "real", }, [{ ...DESK_EN_L, fullPage: true }, { ...MOB_AR_D, fullPage: true }]);
  const body = await page.locator("body").innerText();
  console.log("ADMIN_SHOWS_RAW_TYPE", /independent_publisher|organization_identity|branch_location|co_owner/.test(body));
  const org = q(`select id from public.organizations where name like 'Aud Gov Showroom Group%' order by created_at desc limit 1`);
  await capture(page, `/admin/organizations/${org}`, { area: AREA, name: "31-admin-organization-detail", persona: "Platform Admin", state: "Admin organization detail (any governance evidence / branch / co-owner / revoke controls?)", data: "real" }, [{ ...DESK_EN_L, fullPage: true }]);
  const body2 = await page.locator("body").innerText();
  console.log("ADMIN_ORG_DETAIL_HAS_BRANCH_OR_COOWNER", /branch/i.test(body2), /co-owner|co_owner/i.test(body2), /revoke/i.test(body2));
});
