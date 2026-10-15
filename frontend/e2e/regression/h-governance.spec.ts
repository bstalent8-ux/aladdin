import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "./setup";
import { expectNoHorizontalOverflow, guardConsole, open, prefs } from "./util";

/**
 * BATCH H - M3 governance through the real screens.
 *   identity: a verified name changes only through a review request; the approved name stays public
 *   branches: internal on creation, a verified LOCATION only from an approved snapshot; amendments pending
 *   co-owner: membership is not ownership; only an Admin-verified co-owner may apply for their own organization
 * The Admin decisions use the real review RPCs (review_start -> review_approve / review_reject) as the
 * Admin user; every owner action goes through the UI.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const OWNER = `reg-gov-owner-${run}@example.test`;
const COOWNER = `reg-gov-co-${run}@example.test`;
const SALES = `reg-gov-sales-${run}@example.test`;
const OUTSIDER = `reg-gov-out-${run}@example.test`;
const ORG = `Gov Office ${run}`;
const RENAMED = `Gov Office Group ${run}`;
const BRANCH = `Alexandria ${run}`;

let orgId = "";

const q = (sql: string) => psql(sql).trim();
const vid = (type: string, extra = "") =>
  q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = '${type}' ${extra}
      and status in ('submitted','under_review') order by submitted_at desc limit 1`);

async function decide(id: string, action: "approve" | "reject", reason = "Not enough evidence.") {
  const admin = await signedInClient("admin@example.test");
  const started = await admin.rpc("review_start", { p_verification_id: id });
  expect(started.error, started.error?.message).toBeNull();
  const res =
    action === "approve"
      ? await admin.rpc("review_approve", { p_verification_id: id, p_grant_public_listing: false })
      : await admin.rpc("review_reject", { p_verification_id: id, p_reason: reason });
  expect(res.error, res.error?.message).toBeNull();
}

test.beforeAll(async () => {
  createSyntheticUser(OWNER, "engineer");
  createSyntheticUser(COOWNER, "end_consumer");
  createSyntheticUser(SALES, "end_consumer");
  createSyntheticUser(OUTSIDER, "end_consumer");
  const owner = await signedInClient(OWNER);
  expect((await owner.rpc("business_draft_save", { p_display_name: ORG, p_org_type: "showroom_dealer" })).error).toBeNull();
  const created = await owner.rpc("business_draft_submit", { p_draft_id: null });
  expect(created.error, created.error?.message).toBeNull();
  orgId = created.data as string;
  expect((await owner.rpc("organization_application_submit", { p_org_id: orgId })).error).toBeNull();
  await decide(q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = 'organization' and status = 'submitted'`), "approve");
  // two more members of the approved office: a co-owner candidate (org.manage) and a sales member (no governance rights)
  psql(`
    with m as (
      insert into public.memberships (user_id, organization_id, status, accepted_at)
      select u.id, '${orgId}', 'active', now() from auth.users u where u.email in ('${COOWNER}', '${SALES}')
      returning id, user_id)
    insert into public.membership_capabilities (membership_id, capability_key)
    select m.id, c from m join auth.users u on u.id = m.user_id,
      unnest(case when u.email = '${COOWNER}' then array['org.manage','branch.manage','catalog.read'] else array['sales.read','catalog.read'] end) c;
  `);
});

/** A Showroom's Settings is the sectioned V2 page. Wait for hydration so an early click is not lost in dev builds. */
async function openSettings(page: import("@playwright/test").Page, section: string) {
  await open(page, `/showroom/settings?section=${section}`);
  await page.waitForLoadState("networkidle");
}

test("H1 a verified name cannot be edited directly - the owner files a request and the approved name stays public", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  await openSettings(page, "business");
  const panel = page.getByTestId("identity-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Request a name change" }).click();
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(panel.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("identity-proposed")).toContainText(RENAMED);
  // the approved name is still the public name, the organization is still approved and operational
  expect(q(`select name || '|' || status from public.organizations where id = '${orgId}'`)).toBe(`${ORG}|active`);
  expect(q(`select count(*) from public.verifications where organization_id = '${orgId}' and verification_type = 'organization_identity' and status = 'submitted'`)).toBe("1");
  // a second simultaneous request is not even offered
  await expect(panel.getByRole("button", { name: "Request a name change" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("H2 a rejection keeps the approved name and shows the reason; a corrected request is approved and applied", async ({ page, request }) => {
  await decide(vid("organization_identity"), "reject", "Name does not match the licence.");
  await prefs(page, { locale: "en" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await openSettings(page, "business");
  const panel = page.getByTestId("identity-panel");
  await expect(panel.getByText("Not approved")).toBeVisible();
  await expect(page.getByTestId("identity-reason")).toContainText("Name does not match the licence.");
  expect(q(`select name from public.organizations where id = '${orgId}'`)).toBe(ORG);

  await panel.getByRole("button", { name: "Send a corrected request" }).click();
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(panel.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });

  await decide(vid("organization_identity"), "approve");
  await openSettings(page, "business");
  await expect(page.getByText(RENAMED).first()).toBeVisible();
  expect(q(`select name || '|' || org_type || '|' || status from public.organizations where id = '${orgId}'`)).toBe(`${RENAMED}|showroom_dealer|active`);
  expect(q(`select count(*) from public.audit_log where organization_id = '${orgId}' and action = 'organization.identity_changed'`)).toBe("1");
});

test("H3 a new branch is internal - it is not a new organization and it is not shown as verified", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await openSettings(page, "branches");
  const orgsBefore = q(`select count(*) from public.organizations where created_by = (select id from auth.users where email = '${OWNER}')`);
  await page.getByRole("button", { name: "Add branch" }).click();
  await page.getByLabel("Branch name").fill(BRANCH);
  await page.getByLabel("English address").fill("12 Corniche, Alexandria");
  await page.getByRole("button", { name: "Add branch" }).last().click();
  const row = page.getByTestId("branch-internal").filter({ hasText: BRANCH });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("Internal only")).toBeVisible();
  await expect(row.getByText("Verified location")).toHaveCount(0);
  expect(q(`select count(*) from public.organizations where created_by = (select id from auth.users where email = '${OWNER}')`)).toBe(orgsBefore);
  expect(q(`select count(*) from public.branches where organization_id = '${orgId}' and public_identity is not null`)).toBe("0");
});

test("H4 verification, an unreviewed edit and a rejected amendment never replace the approved public location", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await openSettings(page, "branches");
  let row = page.getByTestId("branch-internal").filter({ hasText: BRANCH });
  await row.getByRole("button", { name: "Request verification" }).click();
  await page.getByRole("button", { name: "Send for verification" }).click();
  row = page.getByTestId("branch-pending_review").filter({ hasText: BRANCH });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("Verified location")).toHaveCount(0);

  await decide(vid("branch_location"), "approve");
  await openSettings(page, "branches");
  row = page.getByTestId("branch-verified").filter({ hasText: BRANCH });
  await expect(row.getByText("Verified location")).toBeVisible();
  const approved = q(`select public_identity ->> 'address_en' from public.branches where organization_id = '${orgId}' and name = '${BRANCH}'`);
  expect(approved).toBe("12 Corniche, Alexandria");

  // an ordinary edit does not freeze the branch, and it is flagged as not yet verified
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("English address").fill("99 New Road, Alexandria");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("branch-unreviewed")).toBeVisible({ timeout: 20_000 });
  expect(q(`select public_identity ->> 'address_en' from public.branches where organization_id = '${orgId}' and name = '${BRANCH}'`)).toBe(approved);

  // the amendment is submitted, then rejected: the approved public record is unchanged
  row = page.getByTestId("branch-verified").filter({ hasText: BRANCH });
  await row.getByRole("button", { name: "Submit changes for verification" }).click();
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByTestId("branch-pending_review").filter({ hasText: BRANCH })).toBeVisible({ timeout: 20_000 });
  await decide(vid("branch_location"), "reject", "Address could not be confirmed.");
  await openSettings(page, "branches");
  await expect(page.getByTestId("branch-review-reason")).toContainText("Address could not be confirmed.");
  expect(q(`select public_identity ->> 'address_en' from public.branches where organization_id = '${orgId}' and name = '${BRANCH}'`)).toBe(approved);
  expect(q(`select count(*) from public.audit_log where organization_id = '${orgId}' and action = 'branch.verified'`)).toBe("1");
});

test("H5 membership is not ownership: a member claims co-ownership, is not eligible until an Admin verifies it", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, COOWNER, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  // not eligible to add a business through a bare org.manage membership
  await open(page, "/business/new");
  await page.waitForURL(/\/business\/applications|\/home|\/b2b/);
  expect(page.url()).not.toContain("/business/new");

  await open(page, "/business/applications");
  const section = page.getByTestId("co-owner-section");
  await expect(section.getByTestId("co-owner-member")).toContainText("Member");
  await section.getByRole("button", { name: "Request co-owner verification" }).click();
  await page.getByLabel("Tell the reviewer how you are an owner").fill("Partner since 2019");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(section.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  expect(q(`select count(*) from public.org_co_owners where organization_id = '${orgId}'`)).toBe("0");

  await decide(vid("co_owner"), "approve");
  await open(page, "/business/applications");
  await expect(page.getByTestId("co-owner-verified_co_owner")).toContainText("Verified co-owner");
  // eligible now: the application flow opens (it still needs its own approval later)
  await open(page, "/business/new");
  expect(page.url()).toContain("/business/new");
  expect(q(`select count(*) from public.organizations where created_by = (select id from auth.users where email = '${COOWNER}')`)).toBe("0");
  expect(errors).toEqual([]);
});

test("H6 a sales member sees no governance controls, and cannot reach them through the API", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, SALES, /\/(home|b2b)(\/|$)/);
  await openSettings(page, "business");
  await expect(page.getByTestId("identity-panel")).toHaveCount(0);
  await openSettings(page, "branches");
  await expect(page.getByRole("button", { name: "Add branch" })).toHaveCount(0);
  const sales = await signedInClient(SALES);
  const rename = await sales.rpc("organization_identity_change_request", { p_org_id: orgId, p_name: "Sales Rename" });
  expect(rename.error?.code).toBe("42501");
  const add = await sales.rpc("branch_create", { p_org_id: orgId, p_name: "Sales Branch" });
  expect(add.error?.code).toBe("42501");
  const direct = await sales.from("organizations").update({ name: "Direct Rename" }).eq("id", orgId).select();
  expect(direct.data ?? []).toEqual([]);
  expect(q(`select name from public.organizations where id = '${orgId}'`)).toBe(RENAMED);
});

test("H7 governance screens: Arabic RTL, dark, 390px - no overflow", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prefs(page, { locale: "ar", theme: "dark" });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  await openSettings(page, "business");
  await expect(page.getByTestId("identity-panel")).toBeVisible();
  await expectNoHorizontalOverflow(page, "settings business @390 ar dark");
  await openSettings(page, "branches");
  await expect(page.getByTestId("branch-governance")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await expectNoHorizontalOverflow(page, "settings branches @390 ar dark");
  await open(page, "/business/applications");
  await expect(page.getByTestId("co-owner-section")).toBeVisible();
  await expectNoHorizontalOverflow(page, "applications @390 ar dark");
  expect(errors).toEqual([]);
});

test("H8 the public branch listing shows only the approved verified branch - never an internal one - and a revocation removes it", async () => {
  const outsider = await signedInClient(OUTSIDER);
  const listed = async () => {
    const r = await outsider.rpc("showroom_branches", { p_org_id: orgId });
    expect(r.error, r.error?.message).toBeNull();
    return (r.data as Array<{ id: string; name: string }>).map((b) => b.name);
  };
  // the founding branch and the add-branch row are internal; only the Admin-approved branch is public
  expect(await listed()).toEqual([BRANCH]);
  const branchId = q(`select id from public.branches where organization_id = '${orgId}' and name = '${BRANCH}'`);
  const admin = await signedInClient("admin@example.test");
  const revoked = await admin.rpc("branch_verification_revoke", { p_branch_id: branchId, p_reason: "Closed" });
  expect(revoked.error, revoked.error?.message).toBeNull();
  expect(await listed()).toEqual([]);
});
