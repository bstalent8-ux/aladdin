import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, shot, DESK_EN_L, DESK_AR_D, MOB_AR_D, type Combo } from "./audit-util";

/** M3 evidence: organization settings, identity, branches, co-owners, public branch listing. */
test.describe.configure({ mode: "serial" });

const AREA = "m3-organization-branch-governance" as const;
const run = Date.now().toString(36);
const OWNER = `aud-gov-owner-${run}@example.test`;
const COOWNER = `aud-gov-co-${run}@example.test`;
const SALESMEMBER = `aud-gov-salesm-${run}@example.test`;
const AFFIL = `aud-gov-affil-${run}@example.test`;
const ORG = `Aud Gov Showroom ${run}`;
const RENAMED = `Aud Gov Showroom Group ${run}`;
const BRANCH = `Aud Alexandria ${run}`;
const q = (s: string) => psql(s).trim();
let orgId = "";
const vid = (type: string) =>
  q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = '${type}' and status in ('submitted','under_review') order by submitted_at desc limit 1`);

async function decide(id: string, action: "approve" | "reject", reason = "Not enough evidence.") {
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("review_start", { p_verification_id: id })).error).toBeNull();
  const r = action === "approve" ? await admin.rpc("review_approve", { p_verification_id: id, p_grant_public_listing: false }) : await admin.rpc("review_reject", { p_verification_id: id, p_reason: reason });
  expect(r.error, r.error?.message).toBeNull();
}

async function reset(page: import("@playwright/test").Page, path: string) {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await page.waitForLoadState("load");
}

const M: Combo[] = [DESK_EN_L, { ...MOB_AR_D, fullPage: true }];

test.beforeAll(async () => {
  createSyntheticUser(OWNER, "engineer");
  createSyntheticUser(COOWNER, "end_consumer");
  createSyntheticUser(SALESMEMBER, "end_consumer");
  createSyntheticUser(AFFIL, "sales");
  const owner = await signedInClient(OWNER);
  expect((await owner.rpc("business_draft_save", { p_display_name: ORG, p_org_type: "showroom_dealer" })).error).toBeNull();
  const created = await owner.rpc("business_draft_submit", { p_draft_id: null });
  expect(created.error, created.error?.message).toBeNull();
  orgId = created.data as string;
  expect((await owner.rpc("organization_application_submit", { p_org_id: orgId })).error).toBeNull();
  await decide(q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = 'organization' and status = 'submitted'`), "approve");
  psql(`
    with m as (
      insert into public.memberships (user_id, organization_id, status, accepted_at)
      select u.id, '${orgId}', 'active', now() from auth.users u where u.email in ('${COOWNER}', '${SALESMEMBER}')
      returning id, user_id)
    insert into public.membership_capabilities (membership_id, capability_key)
    select m.id, c from m join auth.users u on u.id = m.user_id,
      unnest(case when u.email = '${COOWNER}' then array['org.manage','branch.manage','catalog.read'] else array['sales.read','catalog.read'] end) c;
  `);
});

test("M3-1 Organization settings: verified identity + branches before any change", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await capture(page, "/b2b/settings", { area: AREA, name: "01-settings-initial", persona: "Org owner (approved Showroom/Dealer)", state: "Organization settings: verified identity panel + branch list (founding branch only)", data: "real" }, M);
  await capture(page, "/b2b/organization", { area: AREA, name: "02-organization-people", persona: "Org owner", state: "Organization page: people + join requests", data: "real" }, [DESK_EN_L]);
});

test("M3-2 Rename request: pending - the approved name stays", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await page.goto("/b2b/settings");
  const panel = page.getByTestId("identity-panel");
  await panel.getByRole("button", { name: "Request a name change" }).click();
  await shot(page, { area: AREA, name: "03-rename-dialog", locale: "en", theme: "light", persona: "Org owner", state: "Request-a-name-change dialog", data: "real" });
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(panel.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  expect(q(`select name from public.organizations where id = '${orgId}'`)).toBe(ORG);
  await capture(page, "/b2b/settings", { area: AREA, name: "04-rename-pending", persona: "Org owner", state: "Name change Awaiting review; approved name still current", data: "real" }, M);
  await reset(page, "/b2b/settings");
  await decide(vid("organization_identity"), "reject", "Name does not match the licence.");
  await capture(page, "/b2b/settings", { area: AREA, name: "05-rename-rejected", persona: "Org owner", state: "Name change Not approved with reviewer reason", data: "real" }, [DESK_EN_L]);
  await page.getByTestId("identity-panel").getByRole("button", { name: "Send a corrected request" }).click();
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("identity-panel").getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  await decide(vid("organization_identity"), "approve");
  await capture(page, "/b2b/settings", { area: AREA, name: "06-rename-approved", persona: "Org owner", state: "Name change approved and applied", data: "real" }, [DESK_EN_L]);
});

test("M3-3 Branches: internal, verification pending, verified, unreviewed edit, rejected amendment", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await page.goto("/b2b/settings");
  await page.getByRole("button", { name: "Add branch" }).click();
  await shot(page, { area: AREA, name: "07-add-branch-dialog", locale: "en", theme: "light", persona: "Org owner", state: "Add internal branch dialog", data: "real" });
  await page.getByLabel("Branch name").fill(BRANCH);
  await page.getByLabel("English address").fill("12 Corniche, Alexandria");
  await page.getByRole("button", { name: "Add branch" }).last().click();
  let row = page.getByTestId("branch-internal").filter({ hasText: BRANCH });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await shot(page, { area: AREA, name: "08-branch-internal", locale: "en", theme: "light", persona: "Org owner", state: "New branch: Internal only, not a new organization", data: "real" });

  await row.getByRole("button", { name: "Request verification" }).click();
  await shot(page, { area: AREA, name: "09-branch-verification-dialog", locale: "en", theme: "light", persona: "Org owner", state: "Request branch verification dialog", data: "real" });
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByTestId("branch-pending_review").filter({ hasText: BRANCH })).toBeVisible({ timeout: 20_000 });
  await shot(page, { area: AREA, name: "10-branch-pending", locale: "en", theme: "light", persona: "Org owner", state: "Branch verification pending", data: "real" });

  await decide(vid("branch_location"), "approve");
  await capture(page, "/b2b/settings", { area: AREA, name: "11-branch-verified", persona: "Org owner", state: "Verified branch location", data: "real" }, M);
  await reset(page, "/b2b/settings");

  row = page.getByTestId("branch-verified").filter({ hasText: BRANCH });
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("English address").fill("99 New Road, Alexandria");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("branch-unreviewed")).toBeVisible({ timeout: 20_000 });
  await shot(page, { area: AREA, name: "12-branch-unreviewed-edit", locale: "en", theme: "light", persona: "Org owner", state: "Edited verified branch: flagged not yet verified; approved public record unchanged", data: "real" });
  await page.getByTestId("branch-verified").filter({ hasText: BRANCH }).getByRole("button", { name: "Submit changes for verification" }).click();
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByTestId("branch-pending_review").filter({ hasText: BRANCH })).toBeVisible({ timeout: 20_000 });
  await decide(vid("branch_location"), "reject", "Address could not be confirmed.");
  await capture(page, "/b2b/settings", { area: AREA, name: "13-branch-amendment-rejected", persona: "Org owner", state: "Amendment rejected with reason; approved record unchanged", data: "real" }, [DESK_EN_L]);
});

test("M3-4 Co-owner request and verified state", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, COOWNER, /\/(home|b2b)(\/|$)/);
  await page.goto("/business/applications");
  const section = page.getByTestId("co-owner-section");
  await shot(page, { area: AREA, name: "14-coowner-member", locale: "en", theme: "light", persona: "Member with org.manage (not a verified co-owner)", state: "Membership is not ownership: Request co-owner verification offered", data: "real", fullPage: true });
  await section.getByRole("button", { name: "Request co-owner verification" }).click();
  await page.getByLabel("Tell the reviewer how you are an owner").fill("Partner since 2019");
  await shot(page, { area: AREA, name: "15-coowner-request-dialog", locale: "en", theme: "light", persona: "Member", state: "Co-owner verification request dialog", data: "real" });
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(section.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  await capture(page, "/business/applications", { area: AREA, name: "16-coowner-pending", persona: "Member", state: "Co-owner request awaiting review", data: "real", }, [DESK_EN_L, MOB_AR_D]);
  await reset(page, "/business/applications");
  await decide(vid("co_owner"), "approve");
  await capture(page, "/business/applications", { area: AREA, name: "17-coowner-verified", persona: "Verified co-owner", state: "Verified co-owner: may apply for their own organization", data: "real" }, [DESK_EN_L, { ...DESK_AR_D, fullPage: true }]);
  await capture(page, "/business/new", { area: AREA, name: "18-coowner-business-new", persona: "Verified co-owner", state: "Application flow opens for a verified co-owner", data: "real" }, [DESK_EN_L]);
});

test("M3-5 Sales member: no governance controls", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, SALESMEMBER, /\/(home|b2b)(\/|$)/);
  await capture(page, "/b2b/settings", { area: AREA, name: "19-settings-sales-member", persona: "Sales member of the org", state: "Settings without governance controls", data: "real" }, [DESK_EN_L]);
});

test("M3-6 Public branch listing: only the approved verified branch is selectable by an affiliating sales person", async ({ page, request }) => {
  // an Admin-verified branch exists; add one more internal branch that must stay private
  const owner = await signedInClient(OWNER);
  expect((await owner.rpc("branch_create", { p_org_id: orgId, p_name: `Aud Private ${run}`, p_address_en: "Hidden St" } as never)).error).toBeNull();
  const outsider = await signedInClient(AFFIL);
  const listed = ((await outsider.rpc("showroom_branches", { p_org_id: orgId })).data as Array<{ name: string }>).map((b) => b.name);
  console.log("PUBLIC_BRANCHES", JSON.stringify(listed));
  expect(listed).toEqual([BRANCH]);

  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, AFFIL, /\/(home|b2b|onboarding)(\/|$)/);
  await page.goto("/home/showroom");
  await page.waitForLoadState("load");
  await shot(page, { area: AREA, name: "20-showroom-connect", locale: "en", theme: "light", persona: "Sales person (affiliating)", state: "Showroom search/connect screen", data: "real" });
  const box = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
  if (await box.count()) {
    await box.fill(ORG.slice(0, 14));
    await page.waitForTimeout(1500);
    await shot(page, { area: AREA, name: "21-showroom-search-results", locale: "en", theme: "light", persona: "Sales person", state: "Search results", data: "real" });
    const hit = page.getByText(RENAMED).first();
    if (await hit.count()) {
      await hit.click().catch(() => undefined);
      await page.waitForTimeout(1500);
      await shot(page, { area: AREA, name: "22-showroom-branch-choice", locale: "en", theme: "light", persona: "Sales person", state: "Branch choice for the selected showroom (only verified branches)", data: "real" });
      const body = await page.locator("body").innerText();
      console.log("PRIVATE_BRANCH_VISIBLE_IN_UI", body.includes(`Aud Private ${run}`));
      expect(body).not.toContain(`Aud Private ${run}`);
    } else console.log("SHOWROOM_HIT_NOT_FOUND");
  } else console.log("SHOWROOM_SEARCH_BOX_NOT_FOUND");
});
