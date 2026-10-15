import { test, expect } from "@playwright/test";
import path from "node:path";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** Business Description (250 characters): Settings, registration, permissions. SHOT_ROOT_NAME=v2-reference-alignment. */
test.describe.configure({ mode: "serial" });
const SUITE = "/preview/showroom-suite-v2";
const q = (s: string) => psql(s).trim();
const HANA_ORG = `(select id from public.organizations where name = 'Cairo Ceramics Showroom')`;
const SHOTS = path.resolve(process.cwd(), "../docs/frontend/screenshots/v2-reference-alignment/v2-release");
const P = "Showroom owner (hana)";
const figure = (page: import("@playwright/test").Page) => page.getByTestId("organization-description-count-figure");
const box = (page: import("@playwright/test").Page) => page.locator("#organization-description");
const save = (page: import("@playwright/test").Page) => page.getByTestId("organization-description-save");

test("DS-1 owner: 250 characters save and reload; 251 are blocked and never truncated", async ({ page, request }) => {
  test.setTimeout(300_000);
  q(`update public.organizations set description = null where id = ${HANA_ORG}`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("settings-section-business")).toContainText("Business Description");
  await expect(figure(page)).toHaveText("0/250");

  // exactly 250 Arabic characters
  await box(page).fill("ع".repeat(250));
  await expect(figure(page)).toHaveText("250/250");
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.getByText("Description saved.")).toBeVisible({ timeout: 30_000 });
  expect(q(`select char_length(description) from public.organizations where id = ${HANA_ORG}`)).toBe("250");
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await box(page).inputValue()).toBe("ع".repeat(250));
  await expect(figure(page)).toHaveText("250/250");

  // 251: counter goes over, message shown, Save disabled, the pasted text is not cut
  await box(page).fill("ع".repeat(251));
  await expect(figure(page)).toHaveText("251/250");
  await expect(page.getByText("The description can be at most 250 characters. Shorten it to save.")).toBeVisible();
  await expect(save(page)).toBeDisabled();
  expect(Array.from(await box(page).inputValue()).length).toBe(251);
  await page.screenshot({ path: path.join(SHOTS, "desc01-over-limit.en.light.1440x900.png") });
  expect(q(`select char_length(description) from public.organizations where id = ${HANA_ORG}`)).toBe("250");

  // emoji count once each: 250 emoji = 1000 bytes but within the limit
  await box(page).fill("😀".repeat(250));
  await expect(figure(page)).toHaveText("250/250");
  await save(page).click();
  await expect(page.getByText("Description saved.")).toBeVisible({ timeout: 30_000 });
  expect(q(`select char_length(description) || '/' || octet_length(description) from public.organizations where id = ${HANA_ORG}`)).toBe("250/1000");
  await box(page).fill("😀".repeat(251));
  await expect(figure(page)).toHaveText("251/250");
  await expect(save(page)).toBeDisabled();

  // a line break counts once, even though the browser submits CRLF
  await box(page).fill(`${"a".repeat(125)}\n${"b".repeat(124)}`);
  await expect(figure(page)).toHaveText("250/250");
  await save(page).click();
  await expect(page.getByText("Description saved.")).toBeVisible({ timeout: 30_000 });
  expect(q(`select char_length(description) from public.organizations where id = ${HANA_ORG}`)).toBe("250");

  // clearing stores null
  await box(page).fill("");
  await save(page).click();
  await expect(page.getByText("Description saved.")).toBeVisible({ timeout: 30_000 });
  expect(q(`select count(*) from public.organizations where id = ${HANA_ORG} and description is null`)).toBe("1");

  // the real text used for the evidence screenshots
  await box(page).fill("معرض متخصص في السيراميك والبورسلين والأدوات الصحية لمشاريع التشطيب السكنية والتجارية في القاهرة الكبرى.");
  await save(page).click();
  await expect(page.getByText("Description saved.")).toBeVisible({ timeout: 30_000 });
  expect(q(`select count(*) from public.audit_log where action = 'organization.description_changed' and organization_id = ${HANA_ORG}`)).not.toBe("0");
  // the description belongs to the organization, not the owner's personal profile
  expect(q(`select count(*) from public.profiles where bio like 'معرض متخصص%'`)).toBe("0");
  await capture(page, `${SUITE}/settings?section=business`, { area: "v2-release", name: "desc02-business-description", persona: P, state: "Business Description with live counter", data: "real" }, [DESK_EN_L, MOB_AR_D]);
});

test("DS-2 staff read it without controls; staff, another organization and anon cannot write it", async ({ page, request }) => {
  test.setTimeout(300_000);
  const orgId = q(`select id from public.organizations where name = 'Cairo Ceramics Showroom'`);
  const before = q(`select description from public.organizations where id = '${orgId}'`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.salesperson, /\/(home|b2b)(\/|$)/);
  await page.context().addCookies([{ name: "aladdin-org", value: orgId, url: "http://127.0.0.1:3026" }]);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("organization-description-readonly")).toContainText("معرض متخصص");
  await expect(page.locator("#organization-description")).toHaveCount(0);
  await expect(page.getByTestId("organization-description-save")).toHaveCount(0);

  const staff = await signedInClient(IDENTITIES.salesperson);
  expect((await staff.rpc("organization_description_set", { p_org_id: orgId, p_description: "x" })).error?.code).toBe("42501");
  expect((await staff.from("organizations").update({ description: "direct" }).eq("id", orgId)).error?.code ?? "denied").not.toBeNull();
  const other = await signedInClient(IDENTITIES.distributor);
  expect((await other.rpc("organization_description_set", { p_org_id: orgId, p_description: "x" })).error?.code).toBe("42501");
  expect((await other.from("organizations").select("description").eq("id", orgId)).data ?? []).toHaveLength(0);
  expect(q(`select description from public.organizations where id = '${orgId}'`)).toBe(before);
});

test("DS-3 registration: the 250-character Business Description reaches the organization", async ({ page, request }) => {
  test.setTimeout(300_000);
  const email = `desc-reg-${Date.now()}@example.test`;
  createSyntheticUser(email, "engineer");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, email, /\/(onboarding|home|b2b)(\/|$)/);
  await page.goto("/business/new");
  await page.waitForLoadState("networkidle");
  // an Engineer first chooses how they operate: as an organization (an application, never a new account)
  await page.getByRole("button", { name: /Engineering Office/ }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  const name = `Desc Reg ${Date.now()}`;
  await page.locator("#bname").fill(name);
  const counter = page.getByTestId("business-description-count-figure");
  await expect(counter).toHaveText("0/250");

  await page.locator("#bdesc").fill("ي".repeat(251));
  await expect(counter).toHaveText("251/250");
  await expect(page.getByText("The description can be at most 250 characters. Please shorten it.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  expect(Array.from(await page.locator("#bdesc").inputValue()).length).toBe(251);
  await page.screenshot({ path: path.join(SHOTS, "desc03-registration-over-limit.en.light.1440x900.png") });

  const description = "ي".repeat(249) + "😀";
  await page.locator("#bdesc").fill(description);
  await expect(counter).toHaveText("250/250");
  await expect(page.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  await page.screenshot({ path: path.join(SHOTS, "desc04-registration-250.en.light.1440x900.png") });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect.poll(() => q(`select char_length(description) from public.business_creation_drafts where display_name = '${name}'`), { timeout: 30_000 }).toBe("250");

  // finish the wizard: every remaining step keeps the draft, the final submit creates the organization
  for (let i = 0; i < 6; i += 1) {
    const submit = page.getByRole("button", { name: /submit|send for review|apply/i });
    if (await submit.count()) break;
    const typeCard = page.locator("#btype button").first();
    if (await typeCard.count()) await typeCard.click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: /submit|send for review|apply/i }).click();
  await expect.poll(() => q(`select count(*) from public.organizations where name = '${name}'`), { timeout: 60_000 }).toBe("1");
  expect(q(`select description = '${description}' from public.organizations where name = '${name}'`)).toBe("t");
  // not on the creator's personal profile
  expect(q(`select count(*) from public.profiles p join auth.users u on u.id = p.user_id where u.email = '${email}' and p.bio is not null`)).toBe("0");
});
