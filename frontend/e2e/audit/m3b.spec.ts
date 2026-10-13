import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { shot } from "./audit-util";

/** M3 evidence, part 2: the public branch listing through the real Connect-showroom screen. Uses the org left by m3.spec.ts. */
const AREA = "m3-organization-branch-governance" as const;
const q = (s: string) => psql(s).trim();

test("M3-6b a sales person searching for the showroom sees only its verified branch", async ({ page, request }) => {
  const org = q(`select name from public.organizations where name like 'Aud Gov Showroom Group%' order by created_at desc limit 1`);
  const aff = q(`select email from auth.users where email like 'aud-gov-affil-%' order by created_at desc limit 1`);
  const priv = q(`select string_agg(b.name, ',') from public.branches b join public.organizations o on o.id = b.organization_id where o.name = '${org}' and b.public_identity is null`);
  console.log("ORG", org, "AFFIL", aff, "INTERNAL_BRANCHES", priv);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, aff, /\/(home|b2b|onboarding)(\/|$)/);
  await page.goto("/home/showroom");
  await page.getByLabel(/showroom name/i).fill(org.slice(0, 20));
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByText(org).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, { area: AREA, name: "21-showroom-search-results", locale: "en", theme: "light", persona: "Sales person (affiliating)", state: "Search result for the verified showroom", data: "real" });
  await page.getByLabel(/showroom name/i).fill(org.slice(0, 20));
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByText(org).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: new RegExp(org + " Verified") }).click();
  await page.waitForURL(/showroom/);
  await page.waitForLoadState("load");
  const combo = page.getByRole("combobox").first();
  await expect(combo).toBeVisible({ timeout: 20_000 });
  await combo.click();
  const options = await page.getByRole("option").allInnerTexts();
  console.log("BRANCH_OPTIONS", JSON.stringify(options));
  await shot(page, { area: AREA, name: "22-showroom-branch-choice", locale: "en", theme: "light", persona: "Sales person", state: "Selected showroom: branch list opened (verified branch only; internal branches absent)", data: "real" });
  const body = await page.locator("body").innerText();
  console.log("BODY_HAS_VERIFIED_BRANCH", /Aud Alexandria/.test(body), "BODY_HAS_PRIVATE", /Aud Private/.test(body));
  expect(body).not.toContain("Aud Private");
});
