import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, shot, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** B-1 after the fix: a newer approved identity request supersedes an older rejection in the real panel. */
test.describe.configure({ mode: "serial" });
const AREA = "m3-organization-branch-governance" as const;
const run = Date.now().toString(36);
const OWNER = `aud-b1-${run}@example.test`;
const ORG = `B1 Showroom ${run}`;
const RENAMED = `B1 Showroom Group ${run}`;
const q = (s: string) => psql(s).trim();
let orgId = "";

async function decide(action: "approve" | "reject", reason = "Name does not match the licence.") {
  const id = q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = 'organization_identity' and status in ('submitted','under_review') order by submitted_at desc limit 1`);
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("review_start", { p_verification_id: id })).error).toBeNull();
  const r = action === "approve" ? await admin.rpc("review_approve", { p_verification_id: id, p_grant_public_listing: false }) : await admin.rpc("review_reject", { p_verification_id: id, p_reason: reason });
  expect(r.error, r.error?.message).toBeNull();
}

test.beforeAll(async () => {
  createSyntheticUser(OWNER, "engineer");
  const owner = await signedInClient(OWNER);
  expect((await owner.rpc("business_draft_save", { p_display_name: ORG, p_org_type: "showroom_dealer" })).error).toBeNull();
  const created = await owner.rpc("business_draft_submit", { p_draft_id: null });
  orgId = created.data as string;
  expect((await owner.rpc("organization_application_submit", { p_org_id: orgId })).error).toBeNull();
  const v = q(`select id from public.verifications where organization_id = '${orgId}' and verification_type = 'organization' and status = 'submitted'`);
  const admin = await signedInClient("admin@example.test");
  await admin.rpc("review_start", { p_verification_id: v });
  expect((await admin.rpc("review_approve", { p_verification_id: v, p_grant_public_listing: false })).error).toBeNull();
});

test("B1-after: rejected, then corrected + approved - the panel shows the current approved state", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, OWNER, /\/(home|b2b)(\/|$)/);
  await page.goto("/b2b/settings");
  const panel = page.getByTestId("identity-panel");
  await panel.getByRole("button", { name: "Request a name change" }).click();
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(panel.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  await decide("reject");
  await page.goto("/b2b/settings");
  await expect(panel.getByText("Not approved")).toBeVisible();
  await shot(page, { area: AREA, name: "b1-01-after-fix-rejected", locale: "en", theme: "light", persona: "Org owner", state: "B-1 after fix, step 1: a rejection is still shown while it is the latest outcome", data: "real" });
  await panel.getByRole("button", { name: "Send a corrected request" }).click();
  await page.getByLabel("Registered name").fill(RENAMED);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(panel.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  await decide("approve");
  await page.goto("/b2b/settings");
  await page.waitForLoadState("load");
  // fixed behaviour: no stale rejection, no stale reviewer note, a normal "Request a name change" action
  await expect(panel.getByText("Not approved")).toHaveCount(0);
  await expect(page.getByTestId("identity-reason")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send a corrected request" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Request a name change" })).toBeVisible();
  await expect(page.getByText(RENAMED).first()).toBeVisible();
  expect(q(`select name from public.organizations where id = '${orgId}'`)).toBe(RENAMED);
  expect(q(`select count(*) from public.verifications where organization_id = '${orgId}' and verification_type = 'organization_identity' and status = 'rejected'`)).toBe("1");
  await capture(page, "/b2b/settings", { area: AREA, name: "b1-02-after-fix-approved", persona: "Org owner (same scenario that showed the bug)", state: "B-1 AFTER the fix: corrected request approved - no stale rejection, no old note, normal request action", data: "real" }, [DESK_EN_L, { ...MOB_AR_D, fullPage: false }]);
});
