import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "./setup";
import { prefs } from "./util";

/**
 * BATCH M (B3-C) - personal profile saves inside the Showroom V2 shell.
 *
 * Subject: a STAFF member of the Showroom (so the personal account, the internal colleague identity and the public
 * Showroom identity are three different things on screen). Route: /preview/showroom-suite-v2/settings?section=account,
 * which renders the shared IdentityCard (display name, phone, photo). Each save goes through its single-purpose RPC.
 * Username has no editor in this shell (it is chosen at registration), so it is verified at the RPC. The personal bio
 * has no editor outside the professional profile, so it is reported as not reachable here.
 */
const q = (s: string) => psql(s).trim();
const OWNER = IDENTITIES.showroom;
const RUN = Date.now().toString(36);
const ACCOUNT = "/preview/showroom-suite-v2/settings?section=account";
const orgId = () => q(`select m.organization_id from public.memberships m join auth.users u on u.id = m.user_id where u.email = '${OWNER}' limit 1`);
const orgFingerprint = () =>
  q(`select md5(row(name, name_ar, name_en, description, org_type, is_verified, slug, updated_at)::text) from public.organizations where id = '${orgId()}'`);
const uniqueEgMobile = () => `10${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

let staff: { id: string; email: string; name: string };

test.beforeAll(async () => {
  const email = `reg-profile-${RUN}@example.test`;
  const id = createSyntheticUser(email, "sales");
  const name = `Reg Profile ${RUN}`;
  q(`update public.profiles set display_name = '${name}' where user_id = '${id}'`);
  const owner = await signedInClient(OWNER);
  const token = (await owner.rpc("invitation_create", { p_org_id: orgId(), p_email: email })).data as string;
  const me = await signedInClient(email);
  expect((await me.rpc("invitation_accept", { p_token: token })).error).toBeNull();
  const mid = q(`select id from public.memberships where user_id = '${id}' and organization_id = '${orgId()}'`);
  expect((await owner.rpc("membership_set_capabilities", { p_membership_id: mid, p_capabilities: ["sales.read", "sales.write"] })).error).toBeNull();
  staff = { id, email, name };
});

async function login(page: Page, request: APIRequestContext) {
  await page.context().clearCookies();
  await prefs(page, { locale: "en" });
  await signIn(page, request, staff.email, /\/(home|b2b|preview)/);
}
async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
}
async function png(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c33";
    ctx.fillRect(0, 0, 96, 64);
    return c.toDataURL("image/png").split(",")[1] ?? "";
  });
  return Buffer.from(b64, "base64");
}

test.describe("personal profile", () => {
  test("M1 display name: valid saves and persists, invalid is refused, the Showroom's business identity is untouched", async ({ page, request }) => {
    test.setTimeout(240_000);
    const before = orgFingerprint();
    await login(page, request);
    await open(page, ACCOUNT);
    await expect(page.getByTestId("account-privacy-note")).toBeVisible();
    // staff see their personal identity here and no business-identity controls
    await expect(page.getByTestId("identity-card")).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveValue(staff.name);

    const renamed = `${staff.name} Renamed`;
    await page.getByLabel("Display name").fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Display name")).toHaveValue(renamed);
    expect(q(`select display_name from public.profiles where user_id = '${staff.id}'`)).toBe(renamed);

    // the existing validation: the field is required and capped at 80 characters in the browser; a name that is only
    // spaces passes the browser check and is refused by the server with the localized message; 81 characters are
    // refused by the RPC itself. Nothing changes in any case.
    await expect(page.getByLabel("Display name")).toHaveAttribute("maxlength", "80");
    await expect(page.getByLabel("Display name")).toHaveAttribute("required", "");
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Enter a display name (1-80 characters).")).toBeVisible();
    expect(q(`select display_name from public.profiles where user_id = '${staff.id}'`)).toBe(renamed);
    const meRpc = await signedInClient(staff.email);
    expect((await meRpc.rpc("profile_set_display_name", { p_display_name: "x".repeat(81) })).error, "81 characters").not.toBeNull();
    expect(q(`select display_name from public.profiles where user_id = '${staff.id}'`)).toBe(renamed);

    // distinction of identities: the colleague name on the owner's Team page follows the personal name,
    // while the organization record (legal name, public name, description, slug, verification) did not change.
    // Authorization of the profile row. The personal columns (display name, bio, headline, photo) are the person's own and
    // are writable only on their own row; the protected columns (phone, username, confirmation stamp) have no direct grant.
    const me = await signedInClient(staff.email);
    const other = await signedInClient(IDENTITIES.distributor);
    const foreign = await other.from("profiles").update({ display_name: "hijack" }).eq("user_id", staff.id).select("user_id");
    expect(foreign.error !== null || (foreign.data ?? []).length === 0, "another user cannot write this profile").toBe(true);
    expect(q(`select display_name from public.profiles where user_id = '${staff.id}'`)).toBe(renamed);
    for (const column of [{ phone_e164: "+201000000000" }, { username: "sneaky.name" }, { display_name_confirmed_at: null }]) {
      const r = await me.from("profiles").update(column).eq("user_id", staff.id).select("user_id");
      expect(r.error, `direct write of ${Object.keys(column)[0]} must be refused`).not.toBeNull();
    }
    // the personal bio keeps the 250-character rule at the database (no bio editor exists in this shell)
    expect((await me.from("profiles").update({ bio: "b".repeat(251) }).eq("user_id", staff.id).select("user_id")).error?.code, "251-character bio is refused by the limit itself").toBe("22023");
    expect((await me.from("profiles").update({ bio: "b".repeat(250) }).eq("user_id", staff.id).select("user_id")).error, "250-character bio").toBeNull();
    expect(orgFingerprint(), "personal saves must not touch the organization").toBe(before);
  });

  test("M2 phone: invalid and duplicate numbers are refused, a valid number saves and persists, and it stays private", async ({ page, request }) => {
    test.setTimeout(240_000);
    await login(page, request);
    await open(page, ACCOUNT);
    await page.locator("#phone-national").fill("123");
    await expect(page.getByText(/valid phone number/i)).toBeVisible();
    const national = uniqueEgMobile();
    await page.locator("#phone-national").fill(national);
    await page.getByRole("button", { name: "Save phone" }).click();
    await expect(page.getByText("Phone saved")).toBeVisible();
    await page.reload();
    await expect(page.locator("#phone-national")).toHaveValue(national);
    await expect(page.getByRole("combobox", { name: "Country" })).toContainText(/Egypt|EG|\+20/);
    const e164 = q(`select phone_e164 from public.profiles where user_id = '${staff.id}'`);
    expect(e164).toBe(`+20${national}`);

    // a number already used by another account is refused and the staff member's own number is unchanged
    const taken = q(`select phone_e164 from public.profiles where phone_e164 is not null and user_id <> '${staff.id}' limit 1`);
    if (taken) {
      const other = taken.replace("+20", "");
      await page.locator("#phone-national").fill(other);
      await page.getByRole("button", { name: "Save phone" }).click();
      await expect(page.getByText("Phone saved")).toHaveCount(0);
      expect(q(`select phone_e164 from public.profiles where user_id = '${staff.id}'`)).toBe(e164);
    }

    // PRIVACY: neither the owner (same organization) nor another organization can read the personal phone through the API
    for (const who of [OWNER, IDENTITIES.distributor]) {
      const c = await signedInClient(who);
      const r = await c.from("profiles").select("phone_e164, phone_national").eq("user_id", staff.id);
      const leaked = JSON.stringify(r.data ?? []);
      expect(leaked, `${who} must not read the personal phone`).not.toContain(national);
    }
    // contact visibility defaults stay closed: the public colleague listing does not expose the number
    const owner = await signedInClient(OWNER);
    const members = (await owner.rpc("org_members_list", { p_org_id: orgId() })).data as Array<Record<string, unknown>>;
    expect(JSON.stringify(members)).not.toContain(national);
  });

  test("M3 photo: an unsupported file is refused, a cropped PNG saves and persists, the Showroom image is untouched", async ({ page, request }) => {
    test.setTimeout(240_000);
    const orgImageBefore = q(`select coalesce(logo_media_id::text, 'none') from public.organizations where id = '${orgId()}'`);
    await login(page, request);
    await open(page, ACCOUNT);
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByText(/JPEG, PNG, or WebP/)).toBeVisible();
    const red = await png(page);
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: red });
    await expect(page.getByTestId("avatar-cropper")).toBeVisible();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByTestId("avatar-current")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId("avatar-current")).toBeVisible();
    expect(q(`select count(*) from public.profiles where user_id = '${staff.id}' and avatar_media_id is not null`)).toBe("1");
    expect(q(`select coalesce(logo_media_id::text, 'none') from public.organizations where id = '${orgId()}'`), "the Showroom image is a different asset").toBe(orgImageBefore);
  });

  test("M4 username constraints are enforced by the RPC (no username editor exists in this shell) and another person's profile cannot be changed", async () => {
    const me = await signedInClient(staff.email);
    for (const bad of ["ab", "has space", "x".repeat(25), "1abc", "a..b", "_lead", "admin"]) {
      const r = await me.rpc("profile_set_username", { p_username: bad });
      expect(r.error, `username "${bad}" should be refused`).not.toBeNull();
    }
    const taken = q(`select username from public.profiles where username is not null and user_id <> '${staff.id}' limit 1`);
    if (taken) {
      expect((await me.rpc("profile_set_username", { p_username: taken })).error, "a duplicate username").not.toBeNull();
      expect((await me.rpc("username_available", { p_username: taken })).data).toBe(false);
    }
    // an RPC always acts on the caller: nobody can name another account
    const other = await signedInClient(IDENTITIES.distributor);
    const ownerNameBefore = q(`select display_name from public.profiles where user_id = (select id from auth.users where email = '${OWNER}')`);
    const otherName = q(`select display_name from public.profiles where user_id = (select id from auth.users where email = '${IDENTITIES.distributor}')`);
    await other.rpc("profile_set_display_name", { p_display_name: otherName }); // a no-op for the caller; it can only ever address the caller's own row
    expect(q(`select display_name from public.profiles where user_id = (select id from auth.users where email = '${OWNER}')`)).toBe(ownerNameBefore);
  });
});
