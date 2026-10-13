import { test, expect } from "@playwright/test";
import path from "node:path";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql, signedInClient } from "../regression/setup";
import { prefs, expectNoHorizontalOverflow } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/** Settings corrections: no Business Language / Timezone / address, a business image, stable technical slug. SHOT_ROOT_NAME=v2-reference-alignment. */
test.describe.configure({ mode: "serial" });
const SUITE = "/preview/showroom-suite-v2";
const q = (s: string) => psql(s).trim();
const HANA_ORG = `(select id from public.organizations where name = 'Cairo Ceramics Showroom')`;
const OBJECTS = `select count(*) from storage.objects where bucket_id = 'organization-images' and name like (select id::text from public.organizations where name = 'Cairo Ceramics Showroom') || '/%'`;
const IMAGE = path.resolve(process.cwd(), "public/assets/installer-dashboard/rewards/trophy.png");
const P = "Showroom owner (hana)";

test("S-1 owner: Business Profile has no language, timezone or technical address, and the slug is untouched", async ({ page, request }) => {
  test.setTimeout(300_000);
  const slugBefore = q(`select slug from public.organizations where id = ${HANA_ORG}`);
  const tzBefore = q(`select coalesce(timezone, '<null>') from public.organizations where id = ${HANA_ORG}`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  const section = page.getByTestId("settings-section-business");
  for (const gone of ["Business language", "Timezone", "Workspace address", "cairo-ceramics", "Africa/Cairo"]) await expect(section).not.toContainText(gone);
  await expect(section).toContainText("Business name");
  await expect(section).toContainText("Business type");
  // a verified organization has nothing to edit in the names dialog: the only change path is the Admin-reviewed request
  await expect(section.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("identity-panel").getByRole("button", { name: "Request a name change" })).toBeVisible();
  expect(q(`select slug from public.organizations where id = ${HANA_ORG}`)).toBe(slugBefore);
  expect(q(`select coalesce(timezone, '<null>') from public.organizations where id = ${HANA_ORG}`)).toBe(tzBefore);
  await capture(page, `${SUITE}/settings?section=business`, { area: "v2-release", name: "set01-business-profile", persona: P, state: "Business profile without language, timezone or technical address", data: "real" }, [DESK_EN_L, MOB_AR_D]);
});

test("S-2 owner uploads, previews, replaces and removes the Showroom image; the personal avatar is untouched", async ({ page, request }) => {
  test.setTimeout(300_000);
  const avatarBefore = q(`select coalesce(p.avatar_media_id::text, '<none>') from public.profiles p join auth.users u on u.id = p.user_id where u.email = 'hana@example.test'`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("organization-image-empty")).toBeVisible();
  await page.getByTestId("organization-image-input").setInputFiles(IMAGE);
  await expect(page.getByTestId("organization-image-cropper")).toBeVisible();
  await expect(page.getByTestId("organization-image-save")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("organization-image-save").click();
  await expect(page.getByText("The Showroom image was updated.")).toBeVisible({ timeout: 60_000 });
  const img = page.getByTestId("organization-image-current");
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(q(`select count(*) from public.organizations where id = ${HANA_ORG} and logo_media_id is not null`)).toBe("1");
  expect(q(OBJECTS)).toBe("1");
  expect(q(`select count(*) from public.audit_log where action = 'organization.image_set' and organization_id = ${HANA_ORG}`)).not.toBe("0");
  await capture(page, `${SUITE}/settings?section=business`, { area: "v2-release", name: "set02-business-image", persona: P, state: "Showroom image uploaded", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  // capture() leaves the browser in the last combination (Arabic, dark, phone): go back to English desktop
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  // replace: the previous object is removed, exactly one current image remains
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("organization-image-input").setInputFiles(IMAGE);
  await expect(page.getByTestId("organization-image-save")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("organization-image-save").click();
  await expect(page.getByText("The Showroom image was updated.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => q(OBJECTS), { timeout: 30_000 }).toBe("1");
  // the personal avatar pointer never changed
  expect(q(`select coalesce(p.avatar_media_id::text, '<none>') from public.profiles p join auth.users u on u.id = p.user_id where u.email = 'hana@example.test'`)).toBe(avatarBefore);
});

test("S-3 a staff member sees the image without controls; another organization gets nothing", async ({ page, request }) => {
  test.setTimeout(300_000);
  const orgId = q(`select id from public.organizations where name = 'Cairo Ceramics Showroom'`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.salesperson, /\/(home|b2b)(\/|$)/);
  await page.context().addCookies([{ name: "aladdin-org", value: orgId, url: "http://127.0.0.1:3026" }]);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  const img = page.getByTestId("organization-image-current");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("organization-image-input")).toHaveCount(0);
  await expect(page.getByTestId("organization-image-remove")).toHaveCount(0);
  // backend refusals for identities that must not write or read
  const staff = await signedInClient(IDENTITIES.salesperson);
  const denied = await staff.rpc("organization_image_request_upload", { p_org_id: orgId, p_content_type: "image/png" });
  expect(denied.error?.code).toBe("42501");
  expect((await staff.rpc("organization_image_remove", { p_org_id: orgId })).error?.code).toBe("42501");
  const otherEmail = q(`select u.email from public.organizations o join public.memberships m on m.organization_id = o.id join auth.users u on u.id = m.user_id where o.name like 'Gov Office%' and u.email like 'reg-gov-owner-%' order by o.created_at desc limit 1`);
  const outsider = await signedInClient(otherEmail);
  expect((await outsider.rpc("organization_image_current", { p_org_id: orgId })).data).toBeNull();
  const key = q(`select i.object_key from public.organization_images i join public.organizations o on o.logo_media_id = i.id where o.id = '${orgId}'`);
  const signed = await outsider.storage.from("organization-images").createSignedUrl(key, 60);
  expect(signed.data?.signedUrl ?? null).toBeNull();
  expect((await outsider.rpc("organization_image_request_upload", { p_org_id: orgId, p_content_type: "image/png" })).error?.code).toBe("42501");
});

test("S-4 the owner removes the image", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "ar", theme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/settings?section=business`);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page, "settings business @390 ar dark");
  await page.getByTestId("organization-image-remove").click();
  await page.getByTestId("organization-image-remove-confirm").click();
  await expect(page.getByTestId("organization-image-empty")).toBeVisible({ timeout: 30_000 });
  expect(q(`select count(*) from public.organizations where id = ${HANA_ORG} and logo_media_id is null`)).toBe("1");
  await expect.poll(() => q(OBJECTS), { timeout: 30_000 }).toBe("0");
});
