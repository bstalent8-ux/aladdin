import { execFileSync } from "node:child_process";
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { E2E_PASSWORD, registerWithPassword, signIn } from "./helpers/auth";

/**
 * MANDATORY FIRST BUSINESS for a business registration, end to end against the REAL local Supabase + Mailpit, through the
 * canonical `/auth/sign-up` (Turnstile-gated like every Create Account; run where challenges.cloudflare.com loads).
 *
 *   Sign Up -> Email OTP -> /onboarding/business (type preset, never asked again) -> the organization is created with that
 *   exact org_type, its creator becomes the owner, it becomes the active workspace -> /b2b.
 *
 * There is no /home and no "you have no workspace" page in between, the registration resumes after sign-out / sign-in,
 * and a business registration never writes `users.primary_account_type` (the registered type is INTENT; the organization
 * carries `org_type`). A Salesperson and a Tradesperson are untouched.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const BUSINESS_SETUP = /\/onboarding\/business(\/|$|\?)/;

function sql(query: string): string {
  // No shell: the container name and psql flags are separate arguments, the SQL goes in on stdin.
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At"], { input: query }).toString().trim();
}

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e5)}`;
}

async function english(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" }]);
}

/** Registration choices that create a business, with the organization_type each must be created as. */
const BUSINESS_CHOICES = [
  { label: /^showroom$/i, tag: "show", orgType: "showroom_dealer" },
  { label: /^supplier$/i, tag: "supp", orgType: "supplier" },
  { label: /^manufacturer/i, tag: "manu", orgType: "manufacturer" },
  { label: /^importer/i, tag: "impo", orgType: "importer" },
] as const;

type Registered = { email: string; visited: string[] };

/** Register through the real sign-up and stop at wherever the verified account is sent. */
async function register(
  page: Page,
  request: APIRequestContext,
  choice: RegExp,
  tag: string,
  landing: RegExp,
): Promise<Registered> {
  const visited: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
  });
  const email = `mb-${tag}-${uniq()}@example.test`;
  const username = `mb${tag}${uniq()}`.slice(0, 24);
  await registerWithPassword(page, request, { email, username, accountType: choice, displayName: `E2E ${tag}`, landing });
  return { email, visited };
}

/** The wizard for a PRESET type: identity -> location -> branch -> review. There is no type step to find. */
async function fillIdentity(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
  await page.locator("#bname").fill(name);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("heading", { name: /where are you based/i })).toBeVisible();
}

async function finishWizardFromLocation(page: Page, branch = "Cairo HQ"): Promise<void> {
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("heading", { name: /your primary branch/i })).toBeVisible();
  await page.locator("#bbranch").fill(branch);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("heading", { name: /review and create your business/i })).toBeVisible();
  await page.getByRole("button", { name: /^create business$/i }).click();
  await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit", timeout: 30_000 });
}

function userId(email: string): string {
  return sql(`select id from auth.users where email = '${email}'`);
}

test.describe("Business registration: the first business is mandatory", () => {
  test.setTimeout(150_000);

  for (const { label, tag, orgType } of BUSINESS_CHOICES) {
    test(`${orgType}: sign up -> OTP -> business onboarding -> organization created -> /b2b`, async ({ page, request, context }) => {
      await english(context);
      const { email, visited } = await register(page, request, label, tag, BUSINESS_SETUP);

      // Straight from the OTP into the business onboarding: no /home, no "no workspace" page in between.
      expect(visited.filter((p) => p === "/home" || p.startsWith("/home/")), `visited: ${visited.join(" > ")}`).toEqual([]);
      await expect(page).toHaveURL(BUSINESS_SETUP);
      await expect(page.getByText(/you don.?t have a workspace yet/i)).toHaveCount(0);

      // The registered type is preset: the wizard never asks for it, at any step.
      await expect(page.getByRole("heading", { name: /what kind of business/i })).toHaveCount(0);
      await fillIdentity(page, `Nile ${tag} Co`);
      await expect(page.getByRole("heading", { name: /what kind of business/i })).toHaveCount(0);
      await finishWizardFromLocation(page);
      await expect(page).toHaveURL(/\/b2b(\/|$)/);

      // The organization carries that exact org_type; the creator is its active owner (full capabilities).
      const uid = userId(email);
      expect(sql(`select org_type::text || '|' || status::text from public.organizations where created_by = '${uid}'`)).toBe(`${orgType}|pending_verification`);
      expect(sql(`select count(*) from public.memberships m join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage' where m.user_id = '${uid}' and m.status = 'active'`)).toBe("1");

      // Identity is not conflated: choosing a business NEVER writes a persona onto the user.
      expect(sql(`select coalesce(primary_account_type::text, 'NULL') from public.users where id = '${uid}'`)).toBe("NULL");
      expect(sql(`select selected_track::text || '|' || coalesce(selected_org_type::text, '') from public.onboarding_progress where user_id = '${uid}'`)).toBe(`business|${orgType}`);

      // The new organization is the ACTIVE work context.
      const orgId = sql(`select id from public.organizations where created_by = '${uid}'`);
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "aladdin-org")?.value).toBe(orgId);

      // /b2b is canonical from now on: the resume funnel and /home both lead there, never to a generic Personal landing.
      await page.goto("/onboarding");
      await expect(page).toHaveURL(/\/b2b(\/|$)/);
      await page.goto("/home");
      await expect(page).toHaveURL(/\/b2b(\/|$)/);
    });
  }

  test("showroom: closing the browser mid-setup, then signing in, resumes the SAME business onboarding (not /home)", async ({ page, request, context }) => {
    await english(context);
    const { email } = await register(page, request, /^showroom$/i, "resume", BUSINESS_SETUP);

    // Save a draft (Continue persists it), then abandon the session.
    await fillIdentity(page, "Resume Showroom Co");
    await context.clearCookies();
    await english(context);

    await signIn(page, request, email, BUSINESS_SETUP, E2E_PASSWORD);
    await expect(page).toHaveURL(BUSINESS_SETUP);
    // Same draft: the wizard reopens at the review step with the saved name, and never at /home.
    await expect(page.getByRole("heading", { name: /review and create your business/i })).toBeVisible();
    await expect(page.getByText("Resume Showroom Co").first()).toBeVisible();
    expect(sql(`select count(*) from public.business_creation_drafts where user_id = '${userId(email)}' and completed_at is null`)).toBe("1");

    await page.getByRole("button", { name: /^create business$/i }).click();
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit", timeout: 30_000 });
    expect(sql(`select count(*) from public.organizations where created_by = '${userId(email)}'`)).toBe("1");
  });

  test("importer: signing out and in BEFORE any draft exists also resumes the business onboarding", async ({ page, request, context }) => {
    await english(context);
    const { email } = await register(page, request, /^importer/i, "fresh", BUSINESS_SETUP);
    await context.clearCookies();
    await english(context);
    await signIn(page, request, email, BUSINESS_SETUP, E2E_PASSWORD);
    await expect(page).toHaveURL(BUSINESS_SETUP);
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
  });

  test("direct /home, /home/jobs and /b2b while the first business is outstanding go back to the business setup", async ({ page, request, context }) => {
    await english(context);
    await register(page, request, /^manufacturer/i, "direct", BUSINESS_SETUP);

    for (const target of ["/home", "/home/jobs", "/home/settings", "/b2b", "/b2b/jobs"]) {
      await page.goto(target);
      await expect(page, `${target} must not be reachable before the first business exists`).toHaveURL(BUSINESS_SETUP);
      await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    }
    // Still not an organization: nothing was created by merely visiting.
    expect(sql("select count(*) from public.organizations where name like 'E2E manu%'")).toBe("0");
  });

  test("a salesperson is a personal persona: no organization is created, /home is the landing", async ({ page, request, context }) => {
    await english(context);
    const { email } = await register(page, request, /sales team/i, "sales", /\/home(\/|$|\?)/);
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
    expect(sql(`select count(*) from public.organizations where created_by = '${userId(email)}'`)).toBe("0");
    expect(sql(`select count(*) from public.memberships where user_id = '${userId(email)}'`)).toBe("0");
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
  });

  test("a tradesperson (installer) registration is unchanged: /home, no organization", async ({ page, request, context }) => {
    await english(context);
    const { email } = await register(page, request, /craftsmen/i, "trade", /\/home(\/|$|\?)/);
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
    expect(sql(`select count(*) from public.organizations where created_by = '${userId(email)}'`)).toBe("0");
  });
});
