import { test, expect } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs, guardConsole } from "../regression/util";
import { capture, shot, DESK_EN_L, DESK_AR_D, MOB_AR_D, MOB_EN_L } from "./audit-util";

/** M2 evidence: registration / operating model / organization applications, through the real screens. */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const NEW = `aud-new-${run}@example.test`;
const NC = `aud-nc-${run}@example.test`;
const FLOW = `aud-flow-${run}@example.test`;
const AREA = "m2-registration-applications" as const;
const q = (s: string) => psql(s).trim();

async function adminDecide(verificationId: string, action: "changes" | "reject") {
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("review_start", { p_verification_id: verificationId })).error).toBeNull();
  const r =
    action === "changes"
      ? await admin.rpc("review_request_changes", { p_verification_id: verificationId, p_reason: "Please upload a clearer commercial register." })
      : await admin.rpc("review_reject", { p_verification_id: verificationId, p_reason: "Licence missing." });
  expect(r.error, r.error?.message).toBeNull();
}

async function submitViaRpc(email: string, name: string, orgType: string) {
  const c = await signedInClient(email);
  expect((await c.rpc("business_draft_save", { p_display_name: name, p_org_type: orgType })).error).toBeNull();
  const created = await c.rpc("business_draft_submit", { p_draft_id: null });
  expect(created.error, created.error?.message).toBeNull();
  expect((await c.rpc("organization_application_submit", { p_org_id: created.data as string })).error).toBeNull();
  return created.data as string;
}

test("M2-1 registration: account-type choice shows Contractor and Engineer as Coming Soon (anonymous)", async ({ page }) => {
  await capture(page, "/auth/sign-up", { area: AREA, name: "01-sign-up", persona: "anonymous", state: "Sign-up with account-type choice", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  await prefs(page, { locale: "en" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/auth/sign-up");
  const body = await page.locator("body").innerText();
  console.log("SIGNUP_HAS_COMING_SOON", /coming soon/i.test(body));
});

test("M2-2 a new Engineer: operating-model choice, form steps, pending application", async ({ page, request }) => {
  createSyntheticUser(NEW, "engineer");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, NEW, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);

  await capture(page, "/home", { area: AREA, name: "02-personal-home-no-org", persona: "Engineer (personal, no organization)", state: "Personal home before any organization", data: "real" }, [DESK_EN_L]);

  await capture(page, "/business/new", { area: AREA, name: "03-operating-model", persona: "Engineer (personal, no organization)", state: "Operating-model choice: independent vs organization", data: "real" }, [DESK_EN_L, MOB_AR_D]);

  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/business/new");
  await page.getByText("Engineering Office").first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/model=organization/);
  await page.getByLabel(/^business name$/i).fill(`Aud Office ${run}`);
  await shot(page, { area: AREA, name: "04-form-step-name", locale: "en", theme: "light", persona: "Engineer", state: "Application form: business name", data: "real" });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByText("Engineer", { exact: true }).first().click();
  await shot(page, { area: AREA, name: "05-form-step-type", locale: "en", theme: "light", persona: "Engineer", state: "Application form: business type", data: "real" });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await shot(page, { area: AREA, name: "06-form-step-location", locale: "en", theme: "light", persona: "Engineer", state: "Application form: location (optional)", data: "real" });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await shot(page, { area: AREA, name: "07-form-step-branch", locale: "en", theme: "light", persona: "Engineer", state: "Application form: branch (optional)", data: "real" });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await shot(page, { area: AREA, name: "08-form-step-review", locale: "en", theme: "light", persona: "Engineer", state: "Application form: review before submit", data: "real" });
  await page.getByRole("button", { name: /submit for review/i }).click();
  await page.waitForURL(/\/business\/applications/);
  await expect(page.getByTestId("application-pending_review")).toBeVisible();

  await capture(page, "/business/applications", { area: AREA, name: "09-application-pending", persona: "Engineer, one pending application", state: "Pending Review + blocked second application + not-a-workspace note", data: "real" }, [DESK_EN_L, MOB_AR_D, { ...DESK_AR_D, fullPage: true }]);

  // a second application is explained, not started
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/business/new");
  await page.waitForURL(/\/business\/applications/);
  await expect(page.getByTestId("application-blocked")).toBeVisible();

  // pending organization is never a workspace
  const pendingId = q(`select id from public.organizations where name = 'Aud Office ${run}'`);
  await page.context().addCookies([{ name: "aladdin-org", value: pendingId, url: "http://127.0.0.1" }]);
  await page.goto("/home");
  await page.waitForLoadState("load");
  const text = await page.locator("body").innerText();
  console.log("PENDING_NAME_IN_HOME_BODY", text.includes(`Aud Office ${run}`));
  expect(text).not.toContain(`Aud Office ${run}`);
  await shot(page, { area: AREA, name: "10-pending-not-a-workspace", locale: "en", theme: "light", persona: "Engineer, pending org forced via cookie", state: "Home with the pending org id forced in the workspace cookie: still personal", data: "real" });
  console.log("M2-2 console errors:", JSON.stringify(errors));
});

test("M2-3 Needs Changes", async ({ page, request }) => {
  createSyntheticUser(NC, "engineer");
  const org = await submitViaRpc(NC, `Aud NC Office ${run}`, "design_office");
  await adminDecide(q(`select id from public.verifications where organization_id = '${org}' and status = 'submitted'`), "changes");
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, NC, /\/(home|b2b)(\/|$)/);
  const fp = await capture(page, "/business/applications", { area: AREA, name: "11-application-needs-changes", persona: "Engineer, needs-changes application", state: "Needs Changes with reviewer note and resubmit action", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  console.log("NC_FINAL_PATH", fp);
});

test("M2-4 Rejected, abandon confirmation, abandoned history, replacement allowed", async ({ page, request }) => {
  createSyntheticUser(FLOW, "engineer");
  const org = await submitViaRpc(FLOW, `Aud Flow Office ${run}`, "design_office");
  await adminDecide(q(`select id from public.verifications where organization_id = '${org}' and status = 'submitted'`), "reject");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, FLOW, /\/(home|b2b)(\/|$)/);
  await page.goto("/business/applications");
  await expect(page.getByTestId("application-rejected")).toBeVisible();
  await shot(page, { area: AREA, name: "12-application-rejected", locale: "en", theme: "light", persona: "Engineer, rejected first application", state: "Rejected with reviewer reason; replacement blocked until abandon", data: "real" });
  await page.getByTestId("application-rejected").getByRole("button", { name: /abandon application/i }).click();
  await shot(page, { area: AREA, name: "13-abandon-confirmation", locale: "en", theme: "light", persona: "Engineer", state: "Abandon confirmation dialog", data: "real" });
  await page.getByRole("button", { name: /yes, abandon it/i }).click();
  await expect(page.getByTestId("application-abandoned")).toBeVisible({ timeout: 20_000 });
  await shot(page, { area: AREA, name: "14-application-abandoned", locale: "en", theme: "light", persona: "Engineer", state: "Abandoned (history kept) and 'Start a new application' offered", data: "real" });
});

test("M2-5 Approved organizations + additional application + workspace switcher (multi-org owner)", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, "reg-multi@example.test", /\/(home|b2b)(\/|$)/);
  await capture(page, "/business/applications", { area: AREA, name: "15-applications-multi-org", persona: "Engineer with 2 approved orgs + 1 pending", state: "Approved + pending lists, additional application", data: "real" }, [DESK_EN_L, { ...MOB_AR_D, fullPage: true }]);
  await capture(page, "/b2b", { area: AREA, name: "16-workspace-switcher", persona: "multi-org owner", state: "Workspace switcher open: only approved orgs + personal; pending never listed", data: "real" }, [DESK_EN_L], async (p) => {
    const trigger = p.getByTestId("workspace-switcher").or(p.getByRole("button", { name: /workspace|switch/i })).first();
    if (await trigger.count()) await trigger.click().catch(() => undefined);
    await p.waitForTimeout(300);
  });
});

test("M2-6 an individual consumer: no organization, add-a-business entry", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, "consumer@example.test", /\/(home|b2b|onboarding)(\/|$)/);
  await capture(page, "/business/new", { area: AREA, name: "17-consumer-business-new", persona: "Personal consumer", state: "What a consumer sees at /business/new", data: "real" }, [DESK_EN_L]);
  await capture(page, "/home", { area: AREA, name: "18-consumer-home", persona: "Personal consumer", state: "Personal home", data: "real" }, [DESK_EN_L, MOB_AR_D]);
});

test("M2-7 Contractor / Engineer registration entry is Coming Soon (account-type list opened)", async ({ page }) => {
  for (const c of [DESK_EN_L, MOB_AR_D]) {
    await prefs(page, { locale: c.locale, theme: c.theme });
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.goto("/auth/sign-up");
    await page.waitForLoadState("load");
    await page.getByRole("combobox").first().click();
    await page.waitForTimeout(300);
    const options = await page.getByRole("option").allInnerTexts();
    console.log("SIGNUP_OPTIONS", c.locale, JSON.stringify(options));
    await shot(page, { area: AREA, name: "19-signup-account-types-open", locale: c.locale, theme: c.theme, persona: "anonymous", state: "Sign-up account-type list opened: Contractor/Engineer must be Coming Soon", data: "real" });
  }
  void MOB_EN_L;
});
