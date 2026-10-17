import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "./setup";
import { guardConsole, open, prefs } from "./util";

/**
 * BATCH G - the organization application journey through the real screens (M2).
 * A brand-new Engineer applies for an Engineering Office, is held as a pending application (never a
 * workspace), is blocked from a second application, is rejected by an Admin, abandons the rejected
 * application (history kept) and submits a replacement first application.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const EMAIL = `reg-flow-${run}@example.test`;
const OFFICE = `Flow Office ${run}`;
const REPLACEMENT = `Flow Office Two ${run}`;

async function applyThroughUi(page: Page, name: string) {
  await open(page, "/business/new");
  // An Engineer first chooses how to operate: independently or as an organization.
  if (page.url().includes("/business/new") && (await page.getByText("How do you work?").count()) > 0) {
    await page.getByText("Engineering Office").first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/model=organization/);
  }
  await page.getByLabel(/^business name$/i).fill(name);
  // main's registration rule: the legal / registered name is required to continue.
  await page.getByLabel(/^legal \/ registered name/i).fill(`${name} LLC`);
  await page.getByRole("button", { name: /^continue$/i }).click();
  // Type step: an Engineering Office is the Engineer business type.
  await page.getByText("Engineer", { exact: true }).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  // PR #84: a new business needs a governorate and a city (the address is only required for a Showroom).
  await page.locator("#bgov").selectOption("cairo");
  await page.locator("#bcity").selectOption("maadi");
  // Walk to the review step.
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /submit for review/i }).click();
  // rc2 product decision: the FIRST application lands in the limited (pending) workspace of the business just created.
  await page.waitForURL(/\/(b2b|showroom)(\/|$)/);
  await open(page, "/business/applications");
}

test("G1 a new Engineer applies for an Engineering Office and lands on a pending application, not a workspace", async ({ page, request }) => {
  createSyntheticUser(EMAIL, "engineer");
  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  await applyThroughUi(page, OFFICE);

  const card = page.getByTestId("application-pending_review");
  await expect(card).toContainText(OFFICE);
  await expect(page.getByTestId("not-a-workspace-note")).toBeVisible();
  // Nothing to open: the application is not a workspace.
  await expect(page.getByRole("button", { name: /open workspace/i })).toHaveCount(0);
  // The database agrees: provisional, unverified, no audience.
  expect(psql(`select status || '/' || is_verified from public.organizations where name = '${OFFICE}'`).trim()).toBe("pending_verification/false");
  expect(errors).toEqual([]);
});

test("G2 a second application is explained, not started, while the first is pending", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b)(\/|$)/);
  await open(page, "/business/new");
  await page.waitForURL(/\/business\/applications/);
  await expect(page.getByTestId("application-blocked")).toContainText(/first organization is still in progress/i);
});

test("G3 a pending application opens as the owner's LIMITED workspace while the organization itself stays unapproved", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b)(\/|$)/);
  await open(page, "/b2b");
  await expect(page.locator("header").first()).toContainText(OFFICE);
  // Nothing about the database truth changes: still provisional and unverified, so no commercial authority exists behind the screen.
  expect(psql(`select status || '/' || is_verified from public.organizations where name = '${OFFICE}'`).trim()).toBe("pending_verification/false");
});

test("G4 a rejected application is shown with the reviewer's reason and can be abandoned, keeping its history", async ({ page, request }) => {
  // An Admin rejects it through the real review RPCs.
  const admin = await signedInClient("admin@example.test");
  const vid = psql(`select v.id from public.verifications v join public.organizations o on o.id = v.organization_id
                    where o.name = '${OFFICE}' and v.status = 'submitted'`).trim();
  expect((await admin.rpc("review_start", { p_verification_id: vid })).error).toBeNull();
  expect((await admin.rpc("review_reject", { p_verification_id: vid, p_reason: "Licence missing." })).error).toBeNull();

  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b)(\/|$)/);
  await open(page, "/business/applications");
  const rejected = page.getByTestId("application-rejected");
  await expect(rejected).toContainText(OFFICE);
  await expect(page.getByTestId("reviewer-note")).toContainText("Licence missing.");
  // Still blocked: a rejected FIRST application must be abandoned before a replacement can start.
  await expect(page.getByTestId("application-blocked")).toContainText(/rejected/i);

  await rejected.getByRole("button", { name: /abandon application/i }).click();
  await rejected.getByRole("button", { name: /yes, abandon it/i }).click();
  await expect(page.getByTestId("application-abandoned")).toContainText(OFFICE, { timeout: 20_000 });
  // History is preserved: the rejection record and its reviewer stay in the database.
  expect(psql(`select count(*) from public.verifications v join public.organizations o on o.id = v.organization_id
               where o.name = '${OFFICE}' and v.status = 'rejected' and v.reviewer_id is not null`).trim()).toBe("1");
  expect(psql(`select status from public.organizations where name = '${OFFICE}'`).trim()).toBe("archived");
});

test("G5 after abandoning, a replacement FIRST application can be submitted and starts pending", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b)(\/|$)/);
  await open(page, "/business/applications");
  await expect(page.getByRole("link", { name: /start a new application/i })).toBeVisible();
  await applyThroughUi(page, REPLACEMENT);
  await expect(page.getByTestId("application-pending_review")).toContainText(REPLACEMENT);
  // The abandoned one stays in history, the replacement is the only open application.
  await expect(page.getByTestId("application-abandoned")).toContainText(OFFICE);
  expect(psql(`select status from public.organizations where name = '${REPLACEMENT}'`).trim()).toBe("pending_verification");
  void E2E_PASSWORD;
});
